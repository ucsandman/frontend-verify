import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

/** Stable across runs. Message text is excluded so wording changes do not resurrect a mute. */
export function fingerprint(f) {
  return createHash("sha1").update(`${f.rule}|${f.sel || ""}|${f.width || ""}`).digest("hex").slice(0, 12);
}

export function loadMutes(file) {
  try { return new Set(JSON.parse(readFileSync(file, "utf8"))); }
  catch { return new Set(); }
}

export function addMute(file, fp) {
  const s = loadMutes(file);
  s.add(fp);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...s], null, 2));
}

export function markNew(findings, prevFingerprints) {
  return findings.map((f) => ({ ...f, isNew: !prevFingerprints.has(fingerprint(f)) }));
}
