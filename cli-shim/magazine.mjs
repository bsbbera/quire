// The magazine pipeline: subject -> research -> flatplan -> pages -> art -> PDF.
//
// This is a *section* of InkOS, not a book: InkOS writes chapters that run in
// sequence, a magazine is spreads that must each stand alone when opened at
// random. So it keeps its own state file rather than reusing books/.
//
// Editorial law lives in Magazine/EDITORIAL-METHOD.md (written by the user
// after a real critique of real pages). The prompts below quote its
// load-bearing rules; when the method changes, change them here too.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as affinity from "./affinity.mjs";
import * as comfy from "./comfy.mjs";
import * as styles from "./styles.mjs";

const HOME = homedir();
const SHIM = process.env.SHIM_SELF || `http://127.0.0.1:${process.env.SHIM_PORT || 8787}`;

// Prefer the magazine folder the user already works in; fall back to the
// InkDesk workspace so a fresh machine still has somewhere to write.
export const MAG_ROOT = process.env.MAG_ROOT
  || [join(HOME, "IDEAVERSE", "Magazine"), join(process.env.INKDESK_WORKSPACE || join(HOME, "InkDesk"), "Magazine")]
    .find(existsSync) || join(HOME, "InkDesk", "Magazine");

const issuesDir = () => join(MAG_ROOT, "issues");
const dirOf = (id) => join(issuesDir(), id);
const fileOf = (id) => join(dirOf(id), "issue.json");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// -------------------------------------------------------------------- events
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type, data = {}) => {
  const ev = { type, at: Date.now(), ...data };
  for (const fn of listeners) { try { fn(ev); } catch {} }
};

// ----------------------------------------------------------------- llm calls
/**
 * Extract JSON from a model reply. Agent CLIs wrap output in prose and fences
 * far too often to trust a bare JSON.parse.
 */
export function parseJson(text) {
  const src = typeof text === "string" ? text : JSON.stringify(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(src);
  const body = fenced ? fenced[1] : src;
  const a = body.search(/[[{]/);
  if (a < 0) throw new Error("model returned no JSON:\n" + text.slice(0, 400));
  const close = body[a] === "{" ? "}" : "]";
  const b = body.lastIndexOf(close);
  if (b <= a) throw new Error("model returned truncated JSON:\n" + text.slice(0, 400));
  try { return JSON.parse(body.slice(a, b + 1)); }
  catch (e) { throw new Error("model returned invalid JSON (" + e.message + "):\n" + body.slice(a, a + 400)); }
}

// An agent CLI that wedges takes the whole stage with it: without a deadline a
// run sits at status "designing" for ever, with no way back except editing the
// state file by hand. Generous, because a 60-page plan is a real request.
const ASK_TIMEOUT_MS = Number(process.env.MAG_LLM_TIMEOUT_MS || 900000);

async function ask(prompt, { tag = "llm", timeoutMs = ASK_TIMEOUT_MS } = {}) {
  emit("mag:llm", { tag, state: "start" });
  let r;
  try {
    r = await fetch(`${SHIM}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why = e.name === "TimeoutError"
      ? `the model did not answer within ${Math.round(timeoutMs / 60000)} minutes`
      : e.message;
    emit("mag:llm", { tag, state: "error", error: why });
    throw new Error(`llm (${tag}): ${why}`);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("llm: " + (data.error?.message || r.status));
  // Not every provider returns a plain string: some hand back content blocks,
  // and parseJson then died on "body.search is not a function" - an error that
  // says nothing at all about the actual shape.
  const raw = data.choices?.[0]?.message?.content ?? "";
  const text = typeof raw === "string" ? raw
    : Array.isArray(raw) ? raw.map((b) => (typeof b === "string" ? b : b?.text || "")).join("")
    : String(raw);
  emit("mag:llm", { tag, state: "done", chars: text.length });
  return parseJson(text);
}

// ------------------------------------------------------------------- storage
export function list() {
  if (!existsSync(issuesDir())) return [];
  return readdirSync(issuesDir())
    .map((id) => { try { return JSON.parse(readFileSync(fileOf(id), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .map((i) => ({
      id: i.id, title: i.title, subject: i.subject, angle: i.angle, status: i.status,
      extent: i.extent,
      pages: i.pages?.length || 0,
      written: i.pages?.filter((p) => p.body !== null && p.body !== undefined).length || 0,
      art: i.pages?.filter((p) => p.image).length || 0,
      pdf: i.build?.pdf || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function read(id) {
  if (!existsSync(fileOf(id))) throw new Error("no such issue: " + id);
  return JSON.parse(readFileSync(fileOf(id), "utf8"));
}

function save(issue) {
  issue.updatedAt = new Date().toISOString();
  mkdirSync(dirOf(issue.id), { recursive: true });
  writeFileSync(fileOf(issue.id), JSON.stringify(issue, null, 2));
  emit("mag:issue", { id: issue.id, status: issue.status });
  return issue;
}

export function create({ subject, angle = "", extent = 40, series = "" }) {
  if (!subject) throw new Error("subject required");
  const id = slug(`${subject}${angle ? "-" + angle : ""}`) || "issue-" + Date.now();
  if (existsSync(fileOf(id))) throw new Error("issue already exists: " + id);
  // Every section plate must land on a recto, so sections are even-length and
  // the extent has to be even too (EDITORIAL-METHOD section 5).
  const pages = Math.max(16, Math.round(Number(extent) / 2) * 2);
  return save({
    id, series: series || slug(subject), subject, angle, title: "", thesis: "",
    extent: pages, status: "new", createdAt: new Date().toISOString(),
    research: null, sections: [], pages: [],
  });
}

/**
 * The user's own material for an issue: notes, angles, sources, corrections,
 * things only they know. Fed into every stage, and weighted above the model's
 * own research — it is the one input that cannot be regenerated.
 */
export function setNotes(id, notes) {
  const issue = read(id);
  issue.notes = String(notes || "");
  return save(issue);
}

const notesBlock = (issue) => (issue.notes || "").trim() ? `
THE EDITOR'S OWN MATERIAL — this outranks anything you would otherwise choose.
Where it contradicts you, it is right. Where it names something specific, use it.
${issue.notes.trim()}
` : "";

export function remove(id) {
  const d = dirOf(id);
  if (!existsSync(d)) return false;
  // Never delete a user's work outright: park it under _trash.
  const trash = join(MAG_ROOT, "_trash");
  mkdirSync(trash, { recursive: true });
  renameSync(d, join(trash, id + "-" + Date.now()));
  return true;
}

// ------------------------------------------------------------------- prompts
const VOICE = `
YOU ARE WRITING A PREMIUM MAGAZINE, in the register of OYLA, VOGUE and DESIGNARTMAG.
Premium means *effortless to read and impossible to put down* - never dense, never
academic. A clever twelve-year-old and a bored expert must both finish the page.

ABSOLUTE RULES OF VOICE
- Tell a STORY. Never teach, never define, never explain "what X is" as a topic.
  Wrong: "Film photography is a process in which..."  Right: "In 1826 a man left a
  pewter plate in a window for eight hours and came back with a picture of his roof."
- Open on a person, a moment, an object or a number. Never on the subject's name.
- Concrete over abstract. Named people, real dates, real places, real quantities.
- Short sentences carry the weight. Vary length. No adverb pile-ups, and never
  "delve", "moreover", "in today's world", "it is important to note", "journey",
  "tapestry", "testament to", "at the end of the day".
- No bullet-point thinking dressed up as prose. No summary paragraph at the end.
- If a fact is uncertain, or you are not confident it is real, say so plainly in the
  text or leave it out. Never invent a citation, a quote, a date or a statistic.
`.trim();

const PILLARS = `
The issue as a whole must cover all six of these. Individual pages pick one or two.
1. ORIGIN - how it came about, who had the idea, what problem or obsession drove them,
   the first breakthrough and what it actually looked like on the day.
2. EVOLUTION - what it became, the forks it took, what died, what survived.
3. TODAY - why it still matters, who uses it now and why, honestly.
4. STRANGE FACTS - did-you-know, the counter-intuitive, the numbers nobody expects.
5. THE UNDERLYING - the science, the mathematics, the philosophy, the psychology,
   and where real survey or study data exists, the data.
6. REAL WORK - actual practitioners, actual artefacts, actual output, shown and named.
`.trim();

const ARCHETYPES = "plate, cover, contents, statement, feature, infographic, timeline, "
  + "numbers, person, thing, photo-spread, quote, diagram, data, interview, how-it-works";

// ------------------------------------------------------------------- stages
export async function research(id) {
  const issue = read(id);
  issue.status = "researching"; save(issue);
  emit("mag:stage", { id, stage: "research", state: "start" });

  const out = await ask(`${VOICE}

SUBJECT: ${issue.subject}
${issue.angle ? "ANGLE: " + issue.angle : ""}
${notesBlock(issue)}

${PILLARS}

Do the editorial research for one magazine issue on this subject. Go for the specific
and the surprising, not the encyclopaedic. Anything a reader could have guessed is
worthless here.

Return ONLY JSON:
{
  "title": "the issue title - evocative, not descriptive, max 6 words",
  "thesis": "one sentence, the idea the whole issue sits on. Never stated as a lesson.",
  "origin":    [{"fact":"...","who":"...","when":"...","why_it_matters":"..."}],
  "evolution": [{"fact":"...","when":"...","why_it_matters":"..."}],
  "today":     [{"fact":"...","why_it_matters":"..."}],
  "strange":   [{"fact":"...","source_kind":"study|record|measurement|account"}],
  "underlying":[{"field":"physics|maths|chemistry|philosophy|psychology|economics",
                 "idea":"...","the_number":"a real figure if one exists, else empty"}],
  "real_work": [{"who":"...","what":"...","where_to_see_it":"..."}],
  "uncertain": ["anything above you are not confident is accurate"]
}
6-10 entries per array. "uncertain" may be empty but must be honest.`, { tag: "research" });

  issue.research = out;
  issue.title = out.title || issue.title || issue.subject;
  issue.thesis = out.thesis || "";
  issue.status = "researched";
  emit("mag:stage", { id, stage: "research", state: "done" });
  return save(issue);
}

export async function plan(id) {
  const issue = read(id);
  if (!issue.research) throw new Error("run research first");
  issue.status = "planning"; save(issue);
  emit("mag:stage", { id, stage: "plan", state: "start" });

  const out = await ask(`${VOICE}

ISSUE: "${issue.title}" - ${issue.subject}${issue.angle ? " / " + issue.angle : ""}
THESIS: ${issue.thesis}
EXTENT: exactly ${issue.extent} pages.
${notesBlock(issue)}

RESEARCH:
${JSON.stringify(issue.research).slice(0, 12000)}

Build the flatplan.

STRUCTURE LAW (non-negotiable):
- Front matter: p1 cover, p2 statement, p3 imprint, p4-5 contents.
- Then sections. Each section OPENS WITH A PLATE: one full-page image on a RECTO
  (odd page number), no folio, no caption, one line of type that asks a question
  rather than naming a category. Section names never appear on any page.
- Because every plate is on a recto, EVERY SECTION HAS AN EVEN PAGE COUNT.
- The last page is the back cover.
- Density: D = design-heavy, M = mixed, C = content-heavy. Aim for roughly 30% D,
  40% M, 30% C, and NEVER more than two C pages in a row - that rhythm is what
  makes an issue readable rather than exhausting.
- Vary feature length as a real magazine does: 1pp, 2pp, and 4-14pp runs.
- Across the issue, all six research pillars must be represented.

Page types available: ${ARCHETYPES}

Return ONLY JSON:
{
  "sections":[{"n":1,"label":"working label, never printed","question":"the plate line",
               "colour":"the section's colour world in words","from":7,"to":18}],
  "pages":[{"n":1,"title":"the page's own title","type":"one of the types above",
            "density":"D|M|C","section":0,
            "pillar":"origin|evolution|today|strange|underlying|real_work|none",
            "premise":"one sentence: what THIS page does that no other page does"}]
}
Exactly ${issue.extent} page entries, n from 1 to ${issue.extent}, in order.
section 0 = front and back matter.`, { tag: "plan" });

  issue.sections = out.sections || [];
  issue.pages = (out.pages || []).map((p) => ({
    n: Number(p.n), title: p.title || "", type: p.type || "feature",
    density: p.density || "M", section: Number(p.section) || 0,
    pillar: p.pillar || "none", premise: p.premise || "",
    body: null, brief: null, image: null,
  })).filter((p) => p.n).sort((a, b) => a.n - b.n);
  issue.warnings = checkPlan(issue);
  issue.status = "planned";
  emit("mag:stage", { id, stage: "plan", state: "done", pages: issue.pages.length });
  return save(issue);
}

/**
 * Check the flatplan against the structure law. The model follows it well but
 * not perfectly, and a silently-broken plan only shows up as a bad PDF forty
 * minutes of writing later — so the breaks are reported, not corrected.
 */
export function checkPlan(issue) {
  const w = [];
  const pages = issue.pages || [];
  if (pages.length !== issue.extent) w.push(`${pages.length} pages planned, ${issue.extent} asked for`);

  const verso = pages.filter((p) => p.type === "plate" && p.section > 0 && p.n % 2 === 0);
  if (verso.length) w.push("section plate on a left-hand page: p" + verso.map((p) => p.n).join(", p"));

  let run = 0, worst = 0;
  for (const p of pages) { run = p.density === "C" ? run + 1 : 0; worst = Math.max(worst, run); }
  if (worst > 2) w.push(`${worst} content-heavy pages in a row — the law is two`);

  for (const s of issue.sections || []) {
    const n = (s.to - s.from + 1);
    if (n % 2) w.push(`section "${s.label}" is ${n} pages — sections must be even`);
  }

  const used = new Set(pages.map((p) => p.pillar));
  const missing = ["origin", "evolution", "today", "strange", "underlying", "real_work"]
    .filter((p) => !used.has(p));
  if (missing.length) w.push("no page covers: " + missing.join(", "));

  const share = (d) => Math.round(100 * pages.filter((p) => p.density === d).length / (pages.length || 1));
  w.push(`density D/M/C = ${share("D")}/${share("M")}/${share("C")}%`);
  return w;
}

/** Words a page of this density can actually hold at the method's grid. */
const WORDS = { D: [25, 70], M: [180, 320], C: [380, 560] };

export async function writePage(id, n) {
  const issue = read(id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error("no page " + n + " in " + id);
  emit("mag:stage", { id, stage: "write", state: "start", page: page.n, title: page.title });

  const [lo, hi] = WORDS[page.density] || WORDS.M;
  const section = issue.sections.find((s) => s.n === page.section);
  const neighbours = issue.pages
    .filter((p) => Math.abs(p.n - page.n) <= 2 && p.n !== page.n)
    .map((p) => `p${p.n} ${p.type}: ${p.title}`).join(" | ");

  // Pages are written independently, so without this every one of them opens
  // on the single best anecdote in the research and the issue reads as a loop.
  // Showing the openings already used is what stops that.
  const taken = issue.pages
    .filter((p) => p.n !== page.n && p.body)
    .map((p) => `p${p.n}: "${String(p.body).slice(0, 140).replace(/\s+/g, " ")}…"`);

  const out = await ask(`${VOICE}

You are writing ONE page of "${issue.title}".
THESIS OF THE ISSUE: ${issue.thesis}
${notesBlock(issue)}
${section ? `THIS SECTION: ${section.question} - colour world: ${section.colour}` : ""}
${(() => {
  const w = worldFor(issue, page.n);
  if (!w) return "";
  // The visual brief has to be writable in the register the section is already
  // committed to. Told afterwards, the brief and the design fight each other.
  return `THIS SECTION IS PRINTED IN: ${w.register}${w.technique ? " x " + w.technique : ""} - `
    + `${w.idiom}. Paper ${w.paper}, ink ${w.ink}, accent ${w.hue}.`
    + (w.devices?.length ? ` Devices in play: ${w.devices.join(", ")}.` : "")
    + ` Write the visual brief so it belongs in that register.`;
})()}

PAGE ${page.n} - "${page.title}"
type: ${page.type} - density: ${page.density} - pillar: ${page.pillar}
premise: ${page.premise}
pages either side: ${neighbours || "none"}

RESEARCH YOU MAY DRAW ON:
${JSON.stringify(issue.research?.[page.pillar] || issue.research).slice(0, 6000)}
${taken.length ? `
ALREADY USED ON OTHER PAGES - do not open the same way, do not retell these:
${taken.join("\n")}

The reader is holding one object. If two pages open on the same anecdote the issue
reads as a loop. Find a different door into this page: a different person, a different
year, an object, a number, a consequence, a dissenting voice.
` : ""}
LENGTH: the body must be ${lo}-${hi} words. This is a hard constraint - the page is a
fixed physical area and overset copy cannot be placed.${page.type === "plate"
  ? " A PLATE has NO body at all: body must be empty, and the deck is the single question line."
  : ""}

Also write the VISUAL BRIEF. It is handed to an image generator verbatim, so it must
describe a picture, not a concept: subject, framing, light, palette, medium, mood.
No text or lettering anywhere in the image - the type is set separately.

Return ONLY JSON:
{
  "title": "final page title, may differ from the working one",
  "deck":  "the standfirst - one sentence that makes the reader stay. Or the plate question.",
  "body":  "the page copy, plain prose, blank line between paragraphs",
  "pull_quote": "the one line worth setting large, taken from the body, or empty",
  "furniture": [{"kind":"caption|sidebar|stat|did-you-know|margin-note","text":"..."}],
  "image_prompt": "the visual brief, one paragraph, for the image generator",
  "image_orientation": "landscape|portrait|square",
  "sources": ["what this page's facts rest on - real, or empty if none"],
  "uncertain": ["anything here you are not confident is accurate"]
}`, { tag: "page-" + page.n });

  Object.assign(page, {
    title: out.title || page.title,
    deck: out.deck || "",
    body: out.body ?? "",
    pullQuote: out.pull_quote || "",
    furniture: out.furniture || [],
    brief: { prompt: out.image_prompt || "", orientation: out.image_orientation || "landscape" },
    sources: out.sources || [],
    uncertain: out.uncertain || [],
    words: String(out.body || "").split(/\s+/).filter(Boolean).length,
  });

  // Also write the page as markdown - the user's existing issues are markdown,
  // and a JSON blob is not something anyone can edit by hand.
  const dir = join(dirOf(id), "pages");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, String(page.n).padStart(2, "0") + "-" + slug(page.title || "page") + ".md"),
    `# ${page.title}\n\n> ${page.deck}\n\n${page.body}\n\n`
    + (page.pullQuote ? `**"${page.pullQuote}"**\n\n` : "")
    + (page.furniture || []).map((f) => `- *${f.kind}* - ${f.text}`).join("\n")
    + `\n\n---\n*visual brief:* ${page.brief.prompt}\n`);

  // Approval is of specific copy. Rewriting a page — from the run loop or the
  // single-page button — means the sign-off no longer describes what is set.
  if (issue.approved) { issue.approved = null; emit("mag:issue", { id, approved: false }); }
  issue.status = "writing";
  emit("mag:stage", { id, stage: "write", state: "done", page: page.n, words: page.words });
  save(issue);
  return page;
}

export async function artPage(id, n) {
  const issue = read(id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error("no page " + n);
  if (!page.brief?.prompt) throw new Error("page " + n + " has no visual brief - write it first");
  requireApproval(issue, "Rendering art");
  emit("mag:stage", { id, stage: "art", state: "start", page: page.n });

  // A cover or a plate is a full-bleed A4 page. Rendering it landscape means
  // throwing away a third of the frame at crop time, so the page type decides
  // the shape and the brief only gets a say where the page is not full-bleed.
  const FULL_BLEED = new Set(["cover", "plate"]);
  const o = FULL_BLEED.has(page.type) ? "portrait" : page.brief.orientation;
  const file = join(dirOf(id), "_assets", String(page.n).padStart(2, "0") + ".png");

  // Pages are rendered independently, so without a house style and the
  // section's colour world every spread looks like it came from a different
  // magazine — the flatplan's pacing then reads as noise instead of rhythm.
  const section = issue.sections.find((s) => s.n === page.section);
  // The idiom is the whole point of the design stage reaching this far: it says
  // how the mark is made, which is what actually separates two sections in a
  // model's output. A colour world alone gives you the same picture twice.
  const w = worldFor(issue, page.n);
  const prompt = [
    page.brief.prompt,
    w?.idiom,
    w?.technique && `${w.technique} figure treatment`,
    section?.colour && `colour world: ${section.colour}`,
    w && `palette anchored on ${w.paper} paper, ${w.hue} accents`,
    "editorial magazine illustration, printed page, considered composition, "
    + "single clear subject, restrained palette, no lettering",
  ].filter(Boolean).join(". ");

  const r = await comfy.generate({
    prompt,
    width: o === "square" ? 1280 : o === "portrait" ? 1024 : 1536,
    height: o === "square" ? 1280 : o === "portrait" ? 1536 : 1024,
    outFile: file,
    prefix: `${id}-p${page.n}`,
  });

  page.image = { file, seed: r.seed, at: new Date().toISOString() };
  emit("mag:stage", { id, stage: "art", state: "done", page: page.n });
  save(issue);
  return page;
}

/**
 * Lay out one page inside an open build session and keep its findings.
 * `p.built` is what makes the queue resumable: it is on disk, so stopping and
 * restarting picks up at the first page without it.
 */
export async function buildPage(id, n) {
  const issue = read(id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error("no page " + n);
  requireApproval(issue, "Building pages");
  emit("mag:stage", { id, stage: "build", state: "start", page: page.n });

  const r = await affinity.buildPage(issue, page);
  page.built = {
    at: new Date().toISOString(),
    findings: r.findings || [],
    errors: r.errors || 0,
    warnings: r.warnings || [],
  };
  save(issue);
  emit("mag:stage", {
    id, stage: "build", state: "done", page: page.n,
    errors: page.built.errors, findings: page.built.findings.length,
  });
  return page.built;
}

// -------------------------------------------------------------------- build
/**
 * Hand the finished issue to Affinity and export the PDF.
 *
 * The connector runs generated scripts rather than a tool call per element:
 * the Affinity MCP exposes execute_script, and a hundred round-trips to place
 * a hundred text frames would take longer than the writing did.
 */
export async function build(id) {
  const issue = read(id);
  if (!issue.pages.some((p) => p.body !== null && p.body !== undefined)) {
    throw new Error("nothing written yet");
  }
  requireApproval(issue, "Building the PDF");
  emit("mag:stage", { id, stage: "build", state: "start" });

  const out = join(dirOf(id), "build");
  mkdirSync(out, { recursive: true });
  const pdf = join(out, id + ".pdf");

  const r = await affinity.build(issue, { pdf, issueDir: dirOf(id) });
  emit("mag:stage", { id, stage: "build", state: "done" });

  issue.status = "built";
  // A failed export is not a failed build: the pages are laid out in the open
  // Affinity document either way, and the reason belongs where the user sees it.
  issue.build = { pdf: r.exported ? pdf : null, at: new Date().toISOString(), ...r };
  save(issue);
  return issue.build;
}

// ------------------------------------------------------------------- runner
// One issue at a time: the pipeline is LLM- and GPU-bound, and two concurrent
// runs would interleave their events into one unreadable progress stream.
let running = null;
export const busy = () => running;

/**
 * Record a stage failure. A stage that throws used to leave `status` naming the
 * stage it never finished, so the UI showed work in progress that had already
 * died — and the reason was nowhere at all.
 */
export function failStage(id, stage, err) {
  const message = err?.message || String(err);
  emit("mag:stage", { id, stage, state: "error", error: message });
  try {
    const issue = read(id);
    issue.lastError = { stage, error: message, at: new Date().toISOString() };
    // Fall back to what the issue actually has, not to what it was attempting.
    issue.status = issue.approved ? "approved"
      : issue.pages?.every((p) => p.body != null) ? "written"
      : issue.design ? "designed"
      : issue.pages?.length ? "planned"
      : issue.research ? "researched" : "new";
    save(issue);
  } catch {}
  return { ok: false, error: message };
}

/* -------------------------------------------------------------- page queue */
// ComfyUI holds a model in VRAM and Affinity holds a document open, so the two
// expensive stages run one page at a time and stop the moment they are asked to.
// Progress lives in issue.json (a page has art, or it does not), so "resume"
// is just "start again and skip what is done" — nothing to reconcile after a
// crash, a quit, or a machine that went to sleep mid-issue.
let queue = null;

export const queueState = () => queue && { ...queue, pages: undefined };

export function stopQueue() {
  if (!queue) return { stopped: false };
  queue.stopping = true;
  emit("mag:queue", { ...queueState(), state: "stopping" });
  return { stopped: true, after: queue.current };
}

/** Pages still needing `kind` done, in reading order. */
function outstanding(issue, kind, redo) {
  return issue.pages
    .filter((p) => {
      if (kind === "art") return p.brief?.prompt && (redo || !p.image);
      return redo || !p.built;                     // build: every page is laid out
    })
    .map((p) => p.n);
}

/**
 * Run one expensive stage page by page. Returns immediately; progress and the
 * stop are both observed over SSE.
 */
export async function startQueue(id, { kind = "art", redo = false, only = null } = {}) {
  if (queue && !queue.done) throw new Error(`already running ${queue.kind} for ${queue.id}`);
  const issue = read(id);
  requireApproval(issue, kind === "art" ? "Rendering art" : "Building pages");

  // A stopped run leaves its remaining pages on the issue, so resuming continues
  // exactly that list. Without it, a re-render run that was stopped resumed as
  // "nothing to do" — every page still had its old art, so nothing looked
  // outstanding even though fourteen were waiting to be replaced.
  const pending = issue.pending?.kind === kind ? issue.pending.pages : null;
  const pages = only ? [Number(only)]
    : (!redo && pending?.length) ? pending
    : outstanding(issue, kind, redo);
  if (!pages.length) return { ok: true, nothing: true };

  queue = {
    id, kind, pages, total: pages.length, done: false, stopping: false,
    current: null, completed: 0, failed: [], startedAt: Date.now(),
  };
  emit("mag:queue", { ...queueState(), state: "start" });

  (async () => {
    // Pressing the button IS the request to start ComfyUI — it is not launched
    // by anything else, and the whole point of the queue is that the GPU only
    // wakes when a person asks for pages.
    if (kind === "art" && !(await comfy.status()).up) await comfy.start();
    // Affinity's document is opened once for a build run and closed after, so
    // the memory is held for the run rather than for the session.
    if (kind === "build") await affinity.openIssue(read(id), { issueDir: dirOf(id) });
    let left = pages.slice();
    try {
      let sameInARow = 0;
      let lastError = null;
      for (const n of pages) {
        if (queue.stopping) break;
        left = left.filter((x) => x !== n);
        queue.current = n;
        emit("mag:queue", { ...queueState(), state: "page" });
        try {
          if (kind === "art") await artPage(id, n);
          else await buildPage(id, n);
          queue.completed++;
          sameInARow = 0;
        } catch (e) {
          // One bad page must not cost the other fifty-nine — but the same
          // error three times running is the environment, not the page, and
          // grinding through sixty of them just buries the real cause.
          queue.failed.push({ n, error: e.message });
          emit("mag:stage", { id, stage: kind, state: "error", page: n, error: e.message });
          sameInARow = e.message === lastError ? sameInARow + 1 : 1;
          lastError = e.message;
          if (sameInARow >= 3) {
            queue.aborted = `stopped after 3 pages failed the same way: ${e.message}`;
            break;
          }
        }
      }
    } finally {
      if (kind === "build") await affinity.closeIssue().catch(() => {});
      // Record what is left before anything else, so a crash here still leaves
      // a resumable issue on disk.
      try {
        const i = read(id);
        i.pending = left.length ? { kind, pages: left } : null;
        save(i);
      } catch {}
      queue.current = null;
      queue.remaining = left.length;
      queue.done = true;
      emit("mag:queue", {
        ...queueState(),
        state: queue.aborted ? "aborted" : queue.stopping ? "stopped" : "done",
      });
    }
  })();

  return { ok: true, started: kind, pages: pages.length };
}

/* ------------------------------------------------------------------ design */
// The design decisions are part of the content stage, not the build stage.
// By the time anything is rendered or laid out, the editor has already approved
// not just the words but the register each section is printed in — which is what
// the image prompts and the Affinity build both read from.

/** Sections whose worlds share a typeface family, which the law forbids. */
function sharedFaces(worlds) {
  const seen = new Map();
  const clashes = [];
  for (const w of worlds) {
    for (const f of Object.values(w.typefaces || {})) {
      const key = String(f).toLowerCase().trim();
      if (!key) continue;
      if (seen.has(key) && seen.get(key) !== w.n) clashes.push(`${f} used by sections ${seen.get(key)} and ${w.n}`);
      else seen.set(key, w.n);
    }
  }
  return clashes;
}

/**
 * Judge a design system against the law in styles.mjs. Returns violations, so a
 * bad register is caught before it reaches a page rather than after 60 of them.
 */
export function checkDesign(design) {
  const bad = [];
  const worlds = design?.sections || [];
  if (!worlds.length) return ["no section worlds"];

  for (const w of worlds) {
    const reg = styles.byName(w.register);
    if (!reg) bad.push(`s${w.n}: "${w.register}" is not one of the 50`);
    else if (reg.tier !== 1) bad.push(`s${w.n}: ${reg.name} is tier ${reg.tier} - only a tier 1 system may run a section`);
    else if (reg.screenOnly) bad.push(`s${w.n}: ${reg.name} is a screen register and leaves no legible ink on paper`);

    if (w.technique) {
      const t = styles.byName(w.technique);
      if (!t) bad.push(`s${w.n}: "${w.technique}" is not one of the 50`);
      else if (t.tier !== 2) bad.push(`s${w.n}: ${t.name} is tier ${t.tier} - the figure technique must be tier 2`);
    }

    // Print wants more separation than a screen does; 7:1 is the working floor
    // for body copy on paper, not the 4.5:1 WCAG allows for backlit text.
    const cp = styles.contrast(w.paper, w.ink);
    if (cp === null) bad.push(`s${w.n}: paper or ink is not a hex colour`);
    else if (cp < 7) bad.push(`s${w.n}: ink on paper is only ${cp.toFixed(1)}:1 - body copy needs 7:1`);

    // A saturated field usually carries REVERSED type, not ink — a deep green
    // ground is set in the paper colour. So the test is whether *either* of the
    // section's two type colours reads on it, not specifically the ink.
    const cf = Math.max(styles.contrast(w.field, w.ink) || 0, styles.contrast(w.field, w.paper) || 0);
    if (w.field && cf && cf < 4.5) {
      bad.push(`s${w.n}: nothing reads on the field - best is ${cf.toFixed(1)}:1 against ink or paper`);
    }
    if (!w.idiom) bad.push(`s${w.n}: no named idiom - the image prompts have nothing to hold`);
  }
  bad.push(...sharedFaces(worlds));
  if (!design.fixed?.folio) bad.push("no folio spec - the folio is what makes N worlds one object");
  return bad;
}

/**
 * The editor's design preference, set before the design stage runs.
 *
 * A register chosen here is a constraint, not a suggestion: the model picks the
 * rest of the system around it. Left empty, the model chooses everything — which
 * is fine for a subject with no house history and wrong for a series that has one.
 */
export function setDesignPrefs(id, prefs = {}) {
  const issue = read(id);
  const reg = prefs.register ? styles.byName(prefs.register) : null;
  if (prefs.register && !reg) throw new Error(`"${prefs.register}" is not one of the 50`);
  if (reg && reg.tier !== 1) throw new Error(`${reg.name} is tier ${reg.tier} - only a tier 1 system may run a section`);
  const tech = prefs.technique ? styles.byName(prefs.technique) : null;
  if (prefs.technique && !tech) throw new Error(`"${prefs.technique}" is not one of the 50`);
  if (tech && tech.tier !== 2) throw new Error(`${tech.name} is tier ${tech.tier} - the figure technique must be tier 2`);

  issue.designPrefs = {
    register: reg?.name || "",
    technique: tech?.name || "",
    note: String(prefs.note || ""),
    // One register for the whole issue, rather than one per section. A book
    // wants this; a magazine with real section doors usually does not.
    single: !!prefs.single,
  };
  save(issue);
  return issue.designPrefs;
}

const prefsBlock = (issue) => {
  const p = issue.designPrefs;
  if (!p || (!p.register && !p.technique && !p.note && !p.single)) return "";
  return `
THE EDITOR HAS ALREADY DECIDED SOME OF THIS. These are constraints, not suggestions.
${p.register ? `- Register: ${p.register}. Use it${p.single ? " for every section" : " for at least the opening section"}.` : ""}
${p.technique ? `- Figure technique: ${p.technique}.` : ""}
${p.single ? "- ONE register for the whole issue. Sections differ by palette and figure treatment only, never by system." : ""}
${p.note ? `- ${p.note}` : ""}
`;
};

export async function design(id) {
  const issue = read(id);
  if (!issue.pages?.length) throw new Error("run plan first");
  issue.status = "designing"; save(issue);
  emit("mag:stage", { id, stage: "design", state: "start" });

  const sections = (issue.sections || []).map((s) =>
    `s${s.n} pp${s.from}-${s.to}: ${s.label} — plate line "${s.question}" — colour world: ${s.colour}`).join("\n");

  const out = await ask(`${VOICE}

You are setting the DESIGN SYSTEM for this issue. No artwork is generated yet and no page is
laid out yet — this is the decision that governs both, and an editor will read it before
either happens.

ISSUE: "${issue.title}" — ${issue.subject}
THESIS: ${issue.thesis}
${notesBlock(issue)}

SECTIONS:
${sections}
${prefsBlock(issue)}
${styles.LAW}

TIER 1 SYSTEMS (a section register must be one of these):
${styles.catalogue(1)}

TIER 2 TECHNIQUES (the figure language inside a register):
${styles.catalogue(2)}

For every section, choose a register and a figure technique that argue for THIS subject —
not a mood board. Say why in one sentence a sceptical art director would accept.

The idiom is the phrase handed verbatim to the image generator. It must describe how the
mark is made, not what the picture shows: "linocut relief print, hand carved, visible gouge
marks, chipped ink" and "flat vector silkscreen riso, three flat colours, hard edges" produce
genuinely different objects from the same model. Vague idioms produce house-style sludge.

Colours are hex. PAPER is the light ground most pages sit on. FIELD is the saturated one, for
the plate and one feature only. INK must read on PAPER at 7:1 or better.

Return ONLY JSON:
{
  "register_note": "one paragraph: what this issue looks like as one object, and why",
  "fixed": {
    "folio": "where the page number sits and how it is set, same on every non-plate page",
    "grid": "columns, gutter, baseline",
    "margins": "top/outer/bottom/inner in mm",
    "divider": "what announces a section change — the plate spec"
  },
  "sections": [{
    "n": 1,
    "register": "a Tier 1 name, exactly as spelled above",
    "technique": "a Tier 2 name, exactly as spelled above",
    "idiom": "the phrase handed to the image generator",
    "paper": "#RRGGBB", "field": "#RRGGBB", "ink": "#RRGGBB", "hue": "#RRGGBB",
    "typefaces": {"display":"...", "text":"...", "label":"..."},
    "devices": ["what document a page in this section might pretend to be — 4 to 6, all different"],
    "why": "one sentence a sceptical art director would accept"
  }]
}`, { tag: "design" });

  const d = parseJson(out);
  d.violations = checkDesign(d);
  issue.design = d;
  issue.status = "designed";
  // Design is half of what gets approved, so changing it withdraws the sign-off
  // exactly as rewriting a page does.
  if (issue.approved) { issue.approved = null; emit("mag:issue", { id, approved: false }); }
  save(issue);
  emit("mag:stage", { id, stage: "design", state: "done", violations: d.violations.length });
  return d;
}

/** The world a given page is printed in, for prompts and for the build. */
export function worldFor(issue, n) {
  const sec = (issue.sections || []).find((s) => n >= s.from && n <= s.to);
  const w = (issue.design?.sections || []).find((x) => x.n === (sec?.n ?? -1));
  return w || (issue.design?.sections || [])[0] || null;
}

/* ---------------------------------------------------------------- approval */
// Art and layout are the expensive, irreversible half of the pipeline: a GPU
// render per page and a PDF built out of a live Affinity document. Neither
// should ever run against copy the editor has not read. Writing stops at the
// end of the write stage and waits here.

/** Every page has a body — there is something to approve. */
const fullyWritten = (issue) =>
  issue.pages.length > 0 && issue.pages.every((p) => p.body !== null && p.body !== undefined);

export function approve(id) {
  const issue = read(id);
  if (!fullyWritten(issue)) {
    const left = issue.pages.filter((p) => p.body === null || p.body === undefined).length;
    throw new Error(`${left} page(s) still unwritten - approve once the copy is complete`);
  }
  issue.approved = { at: new Date().toISOString() };
  issue.status = "approved";
  save(issue);
  emit("mag:issue", { id, approved: true });
  return issue;
}

export function unapprove(id) {
  const issue = read(id);
  issue.approved = null;
  if (issue.status === "approved") issue.status = "written";
  save(issue);
  emit("mag:issue", { id, approved: false });
  return issue;
}

/** Throw unless the copy has been signed off. */
function requireApproval(issue, what) {
  if (!issue.approved) {
    throw new Error(`${what} needs approved content - review the pages and approve the issue first`);
  }
}

const ORDER = ["research", "plan", "design", "write", "art", "build"];

/**
 * Run the content stages. Stops at `write` by default and waits for approval:
 * everything up to here is text this shim generated and can regenerate, while
 * art and build spend GPU time and drive a live Affinity document.
 */
export async function run(id, { from = "research", art = true, stopAt = "write", redo = false } = {}) {
  if (running) throw new Error("already running: " + running.id);
  const lo = ORDER.indexOf(from), hi = ORDER.indexOf(stopAt);
  if (lo < 0 || hi < 0) throw new Error("bad stage range");
  running = { id, from, stopAt, startedAt: Date.now() };
  const want = (s) => ORDER.indexOf(s) >= lo && ORDER.indexOf(s) <= hi;
  try {
    emit("mag:run", { id, state: "start", from, stopAt });

    if (want("research") && (from === "research" || !read(id).research)) await research(id);
    if (want("plan") && (from === "plan" || !read(id).pages.length)) await plan(id);
    if (want("design") && (from === "design" || !read(id).design)) await design(id);

    // Resume, don't restart: a run interrupted at page 9 of 16 should cost the
    // remaining seven, not all sixteen again. `redo` is the explicit override.
    if (want("write")) {
      for (const p of read(id).pages) {
        if (!redo && p.body !== null && p.body !== undefined) continue;
        await writePage(id, p.n);
      }
      // writePage clears any approval itself, so nothing to do here.
      if (fullyWritten(read(id))) {
        const i = read(id);
        if (i.status !== "approved") { i.status = "written"; save(i); }
      }
    }
    if (want("art") && art) {
      if (!(await comfy.status()).up) await comfy.start();
      for (const p of read(id).pages) {
        if (p.image || !p.brief?.prompt) continue;
        // One dud render must not cost the whole issue - record it and go on.
        try { await artPage(id, p.n); }
        catch (e) { emit("mag:stage", { id, stage: "art", state: "error", page: p.n, error: e.message }); }
      }
    }
    if (want("build")) await build(id);

    emit("mag:run", { id, state: "done" });
    return read(id);
  } catch (e) {
    emit("mag:run", { id, state: "error", error: e.message });
    throw e;
  } finally { running = null; }
}
