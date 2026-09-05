// ComfyUI adapter: runs whichever workflow is selected.
//
// The graph used to be hardcoded here. It lives in workflows/*.json now, so
// this file is only the machine half — finding the install, launching the
// right runner for the hardware, filling a graph and waiting on a render.
import * as events from "./events.mjs";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import * as wf from "./workflows.mjs";

export const COMFY_URL = process.env.COMFY_URL || "http://127.0.0.1:8188";

// The runner scripts the portable build ships. Which one exists is also how we
// tell a GPU build from a CPU-only one.
const RUNNERS = { gpu: "run_nvidia_gpu.bat", cpu: "run_cpu.bat" };

// A fresh machine will not have ComfyUI where this one does, so look for it
// rather than hardcoding a drive. COMFY_DIR still wins if the user sets it.
function findComfy() {
  if (process.env.COMFY_DIR) return process.env.COMFY_DIR;
  const roots = ["C:", "D:", "E:"].flatMap((d) => [
    `${d}/comfy`, `${d}/ComfyUI`, `${d}`,
  ]).concat([join(homedir(), "comfy"), join(homedir(), "ComfyUI"), join(homedir(), "Documents")]);
  const names = [
    "ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable",
    "ComfyUI_windows_portable",
    "ComfyUI",
    "",
  ];
  for (const r of roots) {
    for (const n of names) {
      const dir = n ? join(r, n) : r;
      // Either runner counts: a CPU-only machine gets the same portable build
      // without run_nvidia_gpu.bat, and treating that as "not installed" sent
      // it back to the installer forever.
      if (Object.values(RUNNERS).some((b) => existsSync(join(dir, b)))) return dir.replaceAll("\\", "/");
    }
  }
  return process.env.COMFY_DIR || "";
}
const COMFY_DIR = findComfy();
const dirNow = () => (existsSync(COMFY_DIR) ? COMFY_DIR : findComfy());

/** Model file names of the workflow in force. Kept for preflight's model check. */
export const models = () => Object.fromEntries(
  (wf.selected()?.models || []).map((m) => [m.slot, m.file]),
);

/* ------------------------------------------------------------------ device */
function ps(command) {
  return new Promise((res) => {
    const p = spawn("powershell", ["-NoProfile", "-Command", command], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(String(out).trim()));
    p.on("error", () => res(""));
  });
}

/**
 * What this machine can actually run.
 *
 * nvidia-smi is asked first because Win32_VideoController.AdapterRAM is a
 * 32-bit field and reports 4GB for every card above it — picking settings off
 * that number puts a 24GB card on the low-VRAM path.
 */
export async function probe() {
  const smi = await ps("try { nvidia-smi --query-gpu=name,memory.total --format=csv,noheader } catch { '' }");
  if (smi && smi.includes(",")) {
    const [name, mem] = smi.split("\n")[0].split(",").map((s) => s.trim());
    const vramGb = Number(/(\d+)/.exec(mem)?.[1] || 0) / 1024;
    return {
      gpu: name,
      vramGb: Math.round(vramGb * 10) / 10,
      device: vramGb && vramGb < 6.5 ? "lowvram" : "gpu",
    };
  }
  const names = (await ps("(Get-CimInstance Win32_VideoController).Name -join ';'")).toLowerCase();
  // No NVIDIA card means no CUDA runner in the portable build, whatever else
  // is present, so the honest answer is CPU rather than an OOM ten minutes in.
  if (/nvidia|geforce|quadro|rtx|gtx/.test(names)) return { gpu: names, vramGb: 0, device: "lowvram" };
  return { gpu: names || "none", vramGb: 0, device: "cpu" };
}

/** The device to launch and render with: the locked choice, else a fresh probe. */
export async function device() {
  const locked = wf.config().device;
  if (locked) return locked;
  const dir = dirNow();
  const p = await probe();
  // Ask for a GPU runner the install does not have and start() fails on a
  // missing .bat rather than falling back to something that works.
  if (p.device !== "cpu" && dir && !existsSync(join(dir, RUNNERS.gpu))) return "cpu";
  return p.device;
}

const ping = async (ms = 1500) => {
  try {
    const c = AbortSignal.timeout(ms);
    return (await fetch(`${COMFY_URL}/system_stats`, { signal: c })).ok;
  } catch { return false; }
};

export async function status() {
  const up = await ping();
  // findComfy() ran at import, so a directory that appeared since (an install
  // finishing) is only seen after a restart — re-look here so the panel goes
  // green the moment the download does.
  const dir = dirNow();
  const { installState } = await import("./comfy-install.mjs");
  const cfg = wf.config();
  const current = wf.selected();
  const installed = !!dir && existsSync(dir);
  return {
    up,
    url: COMFY_URL,
    dir,
    installed,
    install: installState(),
    device: await device(),
    workflow: current ? { id: current.id, label: current.label, builtin: current.builtin } : null,
    benchmark: cfg.benchmark || null,
    // The one flag the first-run step reads: not installed, and not declined.
    firstRun: !installed && !cfg.skipped,
  };
}

/** Launch ComfyUI's own portable runner and wait for the API to answer. */
export async function start({ timeoutMs = 180000 } = {}) {
  if (await ping()) return { ok: true, already: true };
  const dir = dirNow();
  const dev = await device();
  const bat = join(dir, dev === "cpu" ? RUNNERS.cpu : RUNNERS.gpu);
  if (existsSync(bat)) return startBat(bat, timeoutMs);
  // Fall back rather than refuse: a GPU-less machine that ended up with the
  // NVIDIA build still renders, just slowly, and the reverse is free speed.
  const other = join(dir, dev === "cpu" ? RUNNERS.gpu : RUNNERS.cpu);
  if (!existsSync(other)) throw new Error("ComfyUI not found at " + dir);
  return startBat(other, timeoutMs);
}

async function startBat(bat, timeoutMs) {
  spawn("cmd", ["/c", "start", "", "/min", bat], { cwd: dirname(bat), detached: true, stdio: "ignore" })
    .unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await ping()) return { ok: true, already: false, runner: bat };
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("ComfyUI did not come up within " + Math.round(timeoutMs / 1000) + "s");
}

/**
 * Render one image. Writes to `outFile` when given, and always returns the
 * bytes as base64 so a caller that wants the image in hand (cover generation)
 * does not have to read a file back off disk.
 */
export async function generate({
  prompt, negative, width, height, steps,
  seed = Math.floor(Math.random() * 2 ** 32), outFile, prefix = "quire",
  workflow: workflowId, timeoutMs = 600000,
}) {
  if (!prompt) throw new Error("prompt required");
  if (!(await ping())) throw new Error("ComfyUI is not running — start it first");

  const w = workflowId ? wf.find(workflowId) : wf.selected();
  if (!w) throw new Error(workflowId ? "no workflow " + workflowId : "no workflow installed");
  const dev = await device();
  const s = wf.settingsFor(w, dev);
  const values = {
    prompt,
    negative: negative ?? w.negative ?? "",
    width: width ?? s.width ?? 1024,
    height: height ?? s.height ?? 1024,
    steps: steps ?? s.steps ?? 8,
    seed,
    prefix,
    ...wf.modelsBySlot(w),
  };

  const started = Date.now();
  const r = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: wf.fill(w.graph, values) }),
  });
  const queued = await r.json();
  if (!r.ok || !queued.prompt_id) {
    throw new Error("ComfyUI rejected the job: " + JSON.stringify(queued.error || queued).slice(0, 400));
  }

  const id = queued.prompt_id;
  const until = Date.now() + timeoutMs;
  /* The poll loop already runs; it simply never told anyone. Emitting from
     inside it is free and turns a silent five-minute wait into a line that
     moves. */
  events.emit("comfy:generate:start", { id, width: values.width, height: values.height });
  let polls = 0;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 1200));
    polls += 1;
    const h = await (await fetch(`${COMFY_URL}/history/${id}`)).json().catch(() => ({}));
    const entry = h[id];
    if (!entry) {
      events.emit("comfy:generate:progress", { id, waited: polls * 1.2 });
      continue;
    }
    const st = entry.status || {};
    if (st.status_str === "error") {
      const m = (st.messages || []).find((x) => x[0] === "execution_error");
      const why = "ComfyUI execution failed: " + (m ? JSON.stringify(m[1]).slice(0, 400) : "unknown");
      events.emit("comfy:generate:fail", { id, error: why });
      throw new Error(why);
    }
    const images = Object.values(entry.outputs || {}).flatMap((o) => o.images || []);
    if (!images.length) continue;

    const img = images[0];
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type });
    const buf = Buffer.from(await (await fetch(`${COMFY_URL}/view?${q}`)).arrayBuffer());
    if (outFile) {
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, buf);
    }
    events.emit("comfy:generate:done", { id, bytes: buf.length, outFile: outFile || null });
    return {
      ok: true, seed, file: outFile, bytes: buf.length, comfyFile: img.filename,
      workflow: w.id, device: dev, ms: Date.now() - started,
      width: values.width, height: values.height,
      b64: buf.toString("base64"),
    };
  }
  throw new Error("ComfyUI render timed out after " + Math.round(timeoutMs / 1000) + "s");
}

/**
 * Time one small render on this machine and lock the result in.
 *
 * The settings tiers are a guess from VRAM; this is the measurement. A machine
 * that takes minutes on a 512px four-step render will not finish a 1536px page
 * in any tolerable time, so it drops a tier — and the number is kept so the UI
 * can be honest about what a page will cost.
 */
export async function benchmark({ timeoutMs = 900000 } = {}) {
  const w = wf.selected();
  if (!w) throw new Error("no workflow installed");
  if (!(await ping())) await start();
  const dev = await device();
  const started = Date.now();
  await generate({
    prompt: "a plain grey square, flat lighting",
    width: 512, height: 512, steps: 4, seed: 1, prefix: "quire-bench", timeoutMs,
  });
  const ms = Date.now() - started;
  // 512x512x4 is about a twentieth of a page. Past 90s here a full page is
  // half an hour, which is where a smaller tier is the kinder answer.
  const chosen = ms > 90000 && dev !== "cpu" ? "lowvram" : dev;
  const probed = await probe();
  const benchmark = {
    at: new Date().toISOString(), ms, device: chosen,
    gpu: probed.gpu, vramGb: probed.vramGb, workflow: w.id,
    settings: wf.settingsFor(w, chosen),
  };
  wf.saveConfig({ device: chosen, benchmark });
  return benchmark;
}
