// ComfyUI adapter: one fixed editorial-illustration workflow.
//
// The saved workflow (EDITORIAL_SPREAD_VN.json) is in ComfyUI's *UI* format —
// a node/link graph the /prompt API does not accept. Rather than ship a
// general UI->API converter for a graph that never changes, the eleven nodes
// are transcribed here directly, with prompt/size/seed as the only inputs.
// ponytail: hardcoded graph. Write a converter only if a second workflow lands.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const COMFY_URL = process.env.COMFY_URL || "http://127.0.0.1:8188";
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
      // run_nvidia_gpu.bat is what start() launches, so its presence is the
      // only definition of "installed" that matters here.
      if (existsSync(join(dir, "run_nvidia_gpu.bat"))) return dir.replaceAll("\\", "/");
    }
  }
  return process.env.COMFY_DIR || "";
}
const COMFY_DIR = findComfy();

export const MODELS = {
  unet: "z-image-turbo_fp8_scaled_e4m3fn_KJ.safetensors",
  clip: "qwen_3_4b.safetensors",
  vae: "ae.safetensors",
};

/** The workflow, in the API shape /prompt wants. */
function graph({ prompt, negative, width, height, seed, prefix }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    2: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    3: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "lumina2", device: "default" } },
    4: { class_type: "CLIPTextEncode", inputs: { clip: ["3", 0], text: prompt } },
    5: { class_type: "CLIPTextEncode", inputs: { clip: ["3", 0], text: negative } },
    6: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    7: { class_type: "KSampler", inputs: {
      model: ["2", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      seed, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1,
    } },
    8: { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } },
    9: { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["8", 0] } },
    // A trace of noise keeps the flat turbo output from looking plasticky in print.
    10: { class_type: "ImageAddNoise", inputs: { image: ["9", 0], seed, strength: 0.06 } },
    11: { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: prefix } },
  };
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
  const dir = existsSync(COMFY_DIR) ? COMFY_DIR : findComfy();
  const { installState } = await import("./comfy-install.mjs");
  return { up, url: COMFY_URL, dir, installed: !!dir && existsSync(dir), install: installState() };
}

/** Launch ComfyUI's own portable runner and wait for the API to answer. */
export async function start({ timeoutMs = 180000 } = {}) {
  if (await ping()) return { ok: true, already: true };
  const bat = join(COMFY_DIR, "run_nvidia_gpu.bat");
  if (!existsSync(bat)) throw new Error("ComfyUI not found at " + COMFY_DIR);
  spawn("cmd", ["/c", "start", "", "/min", bat], { cwd: COMFY_DIR, detached: true, stdio: "ignore" })
    .unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await ping()) return { ok: true, already: false };
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("ComfyUI did not come up within " + Math.round(timeoutMs / 1000) + "s");
}

const NEGATIVE = "text, watermark, signature, logo, letters, words, caption, ugly, blurry, "
  + "lowres, jpeg artifacts, deformed, extra limbs, stock photo, 3d render";

/**
 * Render one image and write it to `outFile`. Blocks until ComfyUI is done —
 * callers that want progress should watch the SSE stream the pipeline emits.
 */
export async function generate({
  prompt, negative = NEGATIVE, width = 1536, height = 1024,
  seed = Math.floor(Math.random() * 2 ** 32), outFile, prefix = "quire", timeoutMs = 600000,
}) {
  if (!prompt) throw new Error("prompt required");
  if (!(await ping())) throw new Error("ComfyUI is not running — start it first");

  const body = { prompt: graph({ prompt, negative, width, height, seed, prefix }) };
  const r = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const queued = await r.json();
  if (!r.ok || !queued.prompt_id) {
    throw new Error("ComfyUI rejected the job: " + JSON.stringify(queued.error || queued).slice(0, 400));
  }

  const id = queued.prompt_id;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 1200));
    const h = await (await fetch(`${COMFY_URL}/history/${id}`)).json().catch(() => ({}));
    const entry = h[id];
    if (!entry) continue;
    const st = entry.status || {};
    if (st.status_str === "error") {
      const m = (st.messages || []).find((x) => x[0] === "execution_error");
      throw new Error("ComfyUI execution failed: " + (m ? JSON.stringify(m[1]).slice(0, 400) : "unknown"));
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
    return { ok: true, seed, file: outFile, bytes: buf.length, comfyFile: img.filename };
  }
  throw new Error("ComfyUI render timed out after " + Math.round(timeoutMs / 1000) + "s");
}
