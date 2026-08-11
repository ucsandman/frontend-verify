import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const IGNORE = new Set([".next", "node_modules", ".claude", ".worktrees", ".git", "dist", "build", "out"]);
const PAGE = /^page\.(tsx|ts|jsx|js)$/;

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (IGNORE.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (PAGE.test(name)) acc.push(full);
  }
  return acc;
}

/** Map a Next.js app-router tree to URL paths. */
export function discoverRoutes(rootDir) {
  const appDirs = [join(rootDir, "app"), join(rootDir, "src", "app")];
  const files = [];
  for (const d of appDirs) walk(d, files);

  const routes = [];
  const skipped = [];
  for (const file of files) {
    const base = appDirs.find((d) => file.startsWith(d + sep));
    if (!base) continue;
    const rel = file.slice(base.length + 1);
    const segs = rel.split(sep).slice(0, -1);            // drop page.tsx
    const url = "/" + segs
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")))  // route groups are not URL segments
      .join("/");
    const clean = url.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
    if (segs.some((s) => s.includes("[")))
      skipped.push({ path: clean, reason: "dynamic segment needs a param value" });
    else if (!routes.includes(clean))
      routes.push(clean);
  }
  return { routes, skipped };
}
