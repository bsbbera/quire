// Installing ComfyUI, because it is the one dependency we are allowed to.
//
// Affinity is licensed and the agent CLIs are the user's own accounts, so those
// can only ever be detected. ComfyUI is a public portable build plus three
// public checkpoints, so InkDesk fetches them itself rather than handing the
// user a shopping list. ~2GB of runtime and ~9GB of weights, so this is never
// automatic — it runs when the setup panel's button is pressed.
//
// ponytail: no installer framework. fetch + the bsdtar already in System32,
// which reads .7z through libarchive. Add a real one if a second dependency
// ever needs installing.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODELS } from "./comfy.mjs";

const REPO = "https://api.github.com/repos/comfyanonymous/ComfyUI/releases/latest";
const HF = "https://huggingface.co";

/** Model file -> where ComfyUI's loaders look for it, and where to fetch it. */
const WEIGHTS = [
  {
    sub: "diffusion_models",
    file: MODELS.unet,
    url: HF + "/Kijai/Z-Image_comfy_fp8_scaled/resolve/main/" + MODELS.unet,
  },
  {
    sub: "text_encoders",
    file: MODELS.clip,
    url: HF + "/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/" + MODELS.clip,
  },
  {
    sub: "vae",
    file: MODELS.vae,
    url: HF + "/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/" + MODELS.vae,
  },
];

/* --------------------------------------------------------------- progress */
// One install at a time, and its state is read back through /comfy/status
// rather than a second SSE channel the panel would have to subscribe to.
let JOB = null;
export const installState = () => (JOB ? { ...JOB } : null);
const set = (p) => { if (JOB) Object.assign(JOB, p); };

/* ------------------------------------------------------------------ probe */
function ps(command) {
  return new Promise((res) => {
    const p = spawn("powershell", ["-NoProfile", "-Command", command], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(String(out).trim()));
    p.on("error", () => res(""));
  });
}

async function gpuVendor() {
  const names = (await ps("(Get-CimInstance Win32_VideoController).Name -join ';'")).toLowerCase();
  if (/nvidia|geforce|quadro|rtx|gtx/.test(names)) return "nvidia";
  if (/radeon|amd/.test(names)) return "amd";
  if (/intel|arc/.test(names)) return "intel";
  return "nvidia";                                    // the build most people want
}

async function freeBytes(drive) {
  const out = await ps("(Get-PSDrive " + drive + " -ErrorAction SilentlyContinue).Free");
  return Number(out) || 0;
}

/** Default somewhere with room: the workspace's drive, else the user profile. */
function defaultDir(magRoot) {
  const drive = (magRoot || homedir()).slice(0, 2);
  return /^[A-Za-z]:$/.test(drive) ? drive + "\\ComfyUI" : join(homedir(), "ComfyUI");
}

/** What an install would do, so the panel can show it before anything is fetched. */
export async function plan({ magRoot, dir } = {}) {
  const vendor = await gpuVendor();
  const rel = await (await fetch(REPO, { headers: { accept: "application/vnd.github+json" } })).json();
  const want = "ComfyUI_windows_portable_" + vendor + ".7z";
  const assets = rel.assets || [];
  const asset = assets.find((a) => a.name === want) || assets.find((a) => a.name.includes(vendor));
  if (!asset) throw new Error("no portable build for " + vendor + " in release " + rel.tag_name);

  const target = dir || defaultDir(magRoot);
  const free = await freeBytes(target.slice(0, 1));
  // HEAD each weight so the panel quotes a real number rather than a guess.
  const weights = await Promise.all(WEIGHTS.map(async (w) => {
    const r = await fetch(w.url, { method: "HEAD", redirect: "follow" });
    return { file: w.file, bytes: Number(r.headers.get("content-length")) || 0 };
  }));
  const bytes = asset.size + weights.reduce((n, w) => n + w.bytes, 0);
  // Extraction needs room for the archive and its contents at the same time.
  const needed = bytes + asset.size * 2;
  return {
    vendor,
    dir: target,
    version: rel.tag_name,
    runtime: { name: asset.name, url: asset.browser_download_url, bytes: asset.size },
    weights,
    bytes,
    needed,
    free,
    enoughSpace: free === 0 || free > needed,          // 0 means we could not tell
  };
}

/* --------------------------------------------------------------- download */
/**
 * Fetch to `dest`, resuming a part-file if one is there. A 9GB pull over a
 * home connection will get interrupted; restarting from zero every time is
 * how a setup step becomes one the user gives up on.
 */
async function download(url, dest, label) {
  const part = dest + ".part";
  let from = existsSync(part) ? statSync(part).size : 0;
  const headers = from ? { range: "bytes=" + from + "-" } : {};
  const r = await fetch(url, { headers, redirect: "follow" });
  if (r.status === 416) { renameSync(part, dest); return; }   // already complete
  if (!r.ok) throw new Error(label + ": HTTP " + r.status);
  if (from && r.status !== 206) from = 0;                     // server ignored the range
  const total = from + (Number(r.headers.get("content-length")) || 0);

  let got = from;
  let tick = 0;
  const body = Readable.fromWeb(r.body);
  body.on("data", (c) => {
    got += c.length;
    // Throttled: a set() per chunk is thousands of writes a second for nothing.
    if (Date.now() - tick > 500) { tick = Date.now(); set({ step: label, got, total }); }
  });
  await pipeline(body, createWriteStream(part, { flags: from ? "a" : "w" }));
  renameSync(part, dest);
  set({ step: label, got: total, total });
}

/** bsdtar in System32 reads 7z through libarchive — no 7-Zip install needed. */
function extract(archive, into) {
  return new Promise((res, rej) => {
    const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    const p = spawn(tar, ["-xf", archive, "-C", into], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res() : rej(new Error("extract failed: " + err.slice(0, 300)))));
    p.on("error", rej);
  });
}

/* ---------------------------------------------------------------- install */
export async function install({ magRoot, dir } = {}) {
  if (JOB && !JOB.done) throw new Error("an install is already running");
  const p = await plan({ magRoot, dir });
  if (!p.enoughSpace) {
    throw new Error("needs about " + (p.needed / 1e9).toFixed(1) + "GB free on "
      + p.dir.slice(0, 2) + ", " + (p.free / 1e9).toFixed(1) + "GB available");
  }
  JOB = {
    started: Date.now(), dir: p.dir, step: "starting",
    got: 0, total: p.bytes, done: false, error: null, root: null,
  };

  (async () => {
    mkdirSync(p.dir, { recursive: true });
    const archive = join(p.dir, p.runtime.name);

    // The archive unpacks into its own folder; if that is already there from a
    // half-finished run, extraction is the step to skip, not to repeat.
    const unpacked = join(p.dir, p.runtime.name.replace(/\.7z$/, ""));
    if (!existsSync(join(unpacked, "run_nvidia_gpu.bat"))) {
      await download(p.runtime.url, archive, "runtime");
      set({ step: "extracting", got: 0, total: 0 });
      await extract(archive, p.dir);
      rmSync(archive, { force: true });
    }

    const models = join(unpacked, "ComfyUI", "models");
    for (const w of WEIGHTS) {
      const out = join(models, w.sub, w.file);
      if (existsSync(out)) continue;
      mkdirSync(join(models, w.sub), { recursive: true });
      await download(w.url, out, w.file);
    }
    set({ step: "done", done: true, root: unpacked });
  })().catch((e) => set({ step: "failed", error: e.message, done: true }));

  return { started: true, plan: p };
}
