// Which engine draws a picture, and what happens when it will not.
//
// One rule decides everything here: the picture must arrive. A hosted engine
// is a nice-to-have that can run out of allowance mid-book, so it is never
// allowed to fail a job — when Canva says no, the same job re-renders on
// ComfyUI and the recipe records that it did. The alternative (a failed stage
// the user has to notice, diagnose and retry) is how a paid extra turns into a
// liability.
//
// Capability gating is the other half. Canva cannot take a reference image,
// cannot inpaint, and has no seed, so any brief that needs one of those is
// never offered to it — a routing question, not an error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as canva from "./canva.mjs";
import * as comfy from "./comfy.mjs";
import * as events from "./events.mjs";
import * as postprocess from "./postprocess.mjs";
import { WORKSPACE } from "./workflows.mjs";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PREFS = join(WORKSPACE, ".quire", "engines.json");
const USAGE = join(WORKSPACE, ".quire", "canva-usage.json");

/** The shipped registry: what each engine can do and what it costs. */
export function registry() {
  try { return JSON.parse(readFileSync(join(HERE, "engines.json"), "utf8")); }
  catch { return { version: 1, engines: [], plans: {} }; }
}

export const engineById = (id) => registry().engines.find((e) => e.id === id) || null;

function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback; }
  catch { return fallback; }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** User choices: the plan they are on and the engine they want per surface. */
export const prefs = () => readJson(PREFS, {});
export function savePrefs(patch) {
  const next = { ...prefs(), ...(patch && typeof patch === "object" ? patch : {}) };
  writeJson(PREFS, next);
  return next;
}

/* -------------------------------------------------------------- allowance */

const periodNow = () => new Date().toISOString().slice(0, 7);

/**
 * The local estimate of Canva's monthly premium uses.
 *
 * Canva exposes no remaining-allowance endpoint, so this counter is the only
 * number the UI can show — and it is an estimate, because the same pool is
 * spent by the Affinity AI Studio outside Quire's sight. It exists to stop
 * pointless calls near the limit, not to be authoritative; the error from a
 * real call is what actually switches the engine off.
 */
export function usage() {
  const raw = readJson(USAGE, {});
  const period = periodNow();
  if (raw.period !== period) return { period, used: 0, lastError: null, exhausted: false };
  return { period, used: Number(raw.used) || 0, lastError: raw.lastError ?? null, exhausted: Boolean(raw.exhausted) };
}

export function noteUsage(patch) {
  const next = { ...usage(), ...patch };
  writeJson(USAGE, next);
  return next;
}

export function limitOf() {
  const plan = String(prefs().plan || "pro");
  const plans = registry().plans || {};
  return Number(plans[plan]?.premiumUses ?? engineById("canva")?.quota?.premiumUses ?? 200);
}

/* ------------------------------------------------------------------ router */

/** Every reason a picture can end up somewhere other than the first choice. */
const WHY = {
  refs: "this picture needs a reference image, which Canva cannot take",
  inpaint: "this is a repaint of part of a picture, which Canva cannot do",
  seed: "this picture must be reproducible from a seed, which Canva has no concept of",
  transparent: "this treatment needs a transparent background",
  unconnected: "Canva is not connected",
  surface: "Canva is not used for this kind of picture",
  exhausted: "Canva AI allowance used up",
  disabled: "Canva is switched off for this surface",
};

/**
 * Which engine should draw this, and why.
 *
 * Returns the chosen id plus the reason it is not the other one, so the recipe
 * and the gate card can both say something true. `comfy` is the floor: when
 * nothing else qualifies, it draws.
 */
export function choose({ surface = "illustration", needs = [], engine = null, prefer = null } = {}) {
  const wanted = engine || prefs()?.bySurface?.[surface] || prefer || "comfy";
  if (wanted !== "canva") return { engine: "comfy", reason: null };

  const spec = engineById("canva");
  if (!spec) return { engine: "comfy", reason: WHY.unconnected };
  if (prefs()?.bySurface?.[surface] === "off") return { engine: "comfy", reason: WHY.disabled };
  if (!spec.surfaces.includes(surface)) return { engine: "comfy", reason: WHY.surface };
  if (!canva.connected()) return { engine: "comfy", reason: WHY.unconnected };
  for (const need of needs) {
    if (need === "refs" && !spec.caps.refs) return { engine: "comfy", reason: WHY.refs };
    if (need === "inpaint" && !spec.caps.inpaint) return { engine: "comfy", reason: WHY.inpaint };
    if (need === "seed" && !spec.caps.seed) return { engine: "comfy", reason: WHY.seed };
  }
  const seen = usage();
  if (seen.exhausted || seen.used >= limitOf()) return { engine: "comfy", reason: WHY.exhausted };
  return { engine: "canva", reason: null };
}

/** `art/07.png` → `art/07.recipe.json`, the name every reader of recipes expects. */
const recipeFileOf = (outFile) => outFile.replace(/\.(png|jpe?g|webp)$/i, "") + ".recipe.json";

/**
 * Render through Canva and write the same files a Comfy render would.
 *
 * Kept in this file rather than canva.mjs so the sidecar is written once, the
 * same way, whichever engine drew: a picture with a recipe that does not match
 * its neighbours is a picture the gallery cannot reason about.
 */
async function renderCanva({ prompt, width, height, outFile, recipe, post: ops, transparent, signal, onProgress }) {
  const made = await canva.generate({ prompt, width, height, transparent, signal, onProgress });
  noteUsage({ used: usage().used + 1, lastError: null });
  let recipeFile = null;
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, made.buf);
    let treated = { applied: [], raw: null };
    if (Array.isArray(ops) && ops.length) {
      try { treated = postprocess.apply(outFile, ops); }
      catch (e) { treated = { applied: [], raw: null, error: String(e?.message || e) }; }
    }
    recipeFile = recipeFileOf(outFile);
    writeFileSync(recipeFile, JSON.stringify({
      ...(recipe && typeof recipe === "object" ? recipe : {}),
      engine: "canva", canvaDesignId: made.designId,
      prompt, negative: "",
      reproducible: false,
      width: made.width, height: made.height,
      ...(treated.applied.length ? { postProcess: treated.applied, raw: treated.raw } : {}),
      ...(treated.error ? { postProcessError: treated.error } : {}),
      ms: made.ms, at: new Date().toISOString(),
    }, null, 2) + "\n");
  }
  return {
    ok: true, engine: "canva", seed: null, file: outFile ?? null, recipe: recipeFile,
    bytes: made.buf.length, canvaDesignId: made.designId, reproducible: false,
    width: made.width, height: made.height, ms: made.ms,
    b64: made.buf.toString("base64"),
  };
}

/**
 * The one door every picture now comes through.
 *
 * Body is Comfy's, plus `surface`, `needs` and `engine` — so a caller that
 * knows nothing about engines still gets a picture, and a caller that knows
 * what its brief requires gets the right one.
 */
export async function render(body = {}) {
  const { surface, needs, engine, prefer, ...rest } = body;
  const picked = choose({ surface, needs, engine, prefer });
  const transparent = Array.isArray(rest.post)
    && rest.post.some((op) => op?.op === "cutout");

  if (picked.engine === "canva") {
    try {
      events.emit("image:engine", { engine: "canva" });
      return await renderCanva({ ...rest, transparent });
    } catch (error) {
      const quota = error?.quota || canva.isQuotaError(error?.status, error?.message);
      noteUsage({ lastError: String(error?.message || error), ...(quota ? { exhausted: true } : {}) });
      // A hosted engine that is out of allowance is a routing fact, not a
      // failure: the job keeps going on the local one and says so. Anything
      // else (a bad token, a network fault) is the same decision — the picture
      // still has to arrive — but the notice names the real cause.
      const notice = quota
        ? "Canva AI allowance used up — routed to ComfyUI"
        : `Canva could not draw this (${String(error?.message || error)}) — routed to ComfyUI`;
      events.emit("image:engine", { engine: "comfy", fallbackFrom: "canva", notice });
      const made = await comfy.generate({
        ...rest,
        recipe: { ...(rest.recipe && typeof rest.recipe === "object" ? rest.recipe : {}), fallbackFrom: "canva", fallbackReason: notice },
      });
      return { ...made, engine: "comfy", fallbackFrom: "canva", notice };
    }
  }

  const made = await comfy.generate({
    ...rest,
    recipe: {
      ...(rest.recipe && typeof rest.recipe === "object" ? rest.recipe : {}),
      ...(picked.reason ? { engineReason: picked.reason } : {}),
    },
  });
  return { ...made, engine: "comfy", ...(picked.reason ? { reason: picked.reason } : {}) };
}

/** What the Connections card shows. */
export function status() {
  const seen = usage();
  const limit = limitOf();
  return {
    engines: registry().engines.map((e) => ({
      id: e.id, label: e.label, surfaces: e.surfaces, caps: e.caps,
      connected: e.id === "canva" ? canva.connected() : true,
    })),
    prefs: prefs(),
    canva: {
      connected: canva.connected(),
      plan: String(prefs().plan || "pro"),
      used: seen.used,
      limit,
      exhausted: seen.exhausted || seen.used >= limit,
      lastError: seen.lastError,
      note: "An estimate — Canva does not report remaining allowance, and the Affinity AI Studio spends the same pool.",
    },
  };
}
