// Archive pictures from Wikimedia Commons, for issues whose brand works with real photographs
// (Ochin 01 was built from them: Niépce, Daguerre, Cameron, Earthrise...). Only free licences pass:
// public domain, CC0, CC BY, CC BY-SA; the credit and licence travel with every file.
import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "Quire/0.1 (magazine layout; https://github.com/bsbbera/quire)";
const FREE = /^(public domain|pd\b|pd-|cc0|cc by(-sa)?( \d(\.\d)?)?\b|cc-by(-sa)?|no restrictions)/i;
const strip = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function api(params) {
  const q = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const res = await fetch(`${API}?${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Commons answered HTTP ${res.status}`);
  return res.json();
}

function infoOf(p) {
  const ii = p.imageinfo?.[0]; if (!ii) return null;
  const m = ii.extmetadata || {};
  const license = strip(m.LicenseShortName?.value) || "unknown";
  return {
    title: p.title, page: ii.descriptionurl, w: ii.width, h: ii.height, mime: ii.mime,
    thumb: ii.thumburl || ii.url, url: ii.url, license, free: FREE.test(license),
    artist: strip(m.Artist?.value).slice(0, 120), date: strip(m.DateTimeOriginal?.value).slice(0, 40),
    desc: strip(m.ImageDescription?.value).slice(0, 240),
  };
}

/** Free pictures on Commons for a query, largest first; thumbnails `thumbW` px wide. */
export async function search(query, { limit = 8, thumbW = 360, minSide = 600 } = {}) {
  const j = await api({ action: "query", generator: "search", gsrnamespace: "6", gsrsearch: String(query), gsrlimit: String(Math.min(30, limit * 3)),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(thumbW) });
  return (j.query?.pages || []).map(infoOf).filter(Boolean)
    .filter((p) => p.free && /jpeg|png/.test(p.mime) && Math.max(p.w, p.h) >= minSide)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).slice(0, limit);
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

/** Thumbnails of candidates into `dir`, for a model to look at. Returns local paths, same order. */
export async function thumbs(list, dir) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const f = join(dir, `cand-${i}.${/png/.test(list[i].mime) ? "png" : "jpg"}`);
    try { await download(list[i].thumb, f); out.push(f); } catch { out.push(null); }
  }
  return out;
}

/**
 * One Commons file into the issue's `_assets` as `name` (no extension), at most `maxW` px wide.
 * Refuses anything not freely licensed. Records the credit in `_assets/sources.json`.
 */
export async function fetchFile(title, assetsDir, name, { maxW = 2400 } = {}) {
  const t = String(title).startsWith("File:") ? String(title) : `File:${title}`;
  const j = await api({ action: "query", titles: t, prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(maxW) });
  const info = infoOf(j.query?.pages?.[0] || {});
  if (!info) throw new Error(`no such file on Commons: ${t}`);
  if (!info.free) throw new Error(`${t} is not freely licensed (${info.license})`);
  mkdirSync(assetsDir, { recursive: true });
  const ext = /png/.test(info.mime) ? "png" : "jpg";
  const file = `${String(name).replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.${ext}`;
  await download(info.w > maxW ? info.thumb : info.url, join(assetsDir, file));
  const ledger = join(assetsDir, "sources.json");
  const all = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf-8")) : [];
  const entry = { file, title: info.title, page: info.page, license: info.license, artist: info.artist, date: info.date, desc: info.desc, w: Math.min(info.w, maxW), h: Math.round(info.h * Math.min(1, maxW / info.w)) };
  writeFileSync(ledger, JSON.stringify([...all.filter((e) => e.file !== file), entry], null, 1));
  return entry;
}
