#!/usr/bin/env node
// frontend-verify / report-server.mjs
//
// The human surface for frontend-verify: a localhost page showing each finding as a
// crop-first evidence card, so a defect is checkable in about 2 seconds instead of by
// reading JSON. Reads report.json (+ muted.json) from one or more outDir paths written by
// verify-routes.mjs. This script never writes report.json -- POST /mute only appends a
// fingerprint to muted.json, and that file is re-applied on every render, so a mute takes
// effect on the next page load without waiting for verify-routes.mjs to run again.
//
// Usage: node report-server.mjs <outDir> [<outDir> ...]
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve, basename, dirname, sep } from "node:path";
import { addMute, fingerprint, loadMutes } from "./mute-store.mjs";

const dirs = process.argv.slice(2).map((d) => resolve(d));
if (!dirs.length) { console.error("usage: node report-server.mjs <outDir> [...]"); process.exit(2); }
const PORT = 7788;

// Every value below came off a page frontend-verify tested, not from us -- a finding's
// selector or message can legitimately contain &, <, >, " or ' (a real class name, an
// attribute selector, quoted text). So every one is escaped before it reaches HTML. Values
// the page needs back as JS (the mute button) travel through data-* attributes and are read
// via .dataset rather than being inlined into onclick="...": HTML-escaping a quote does not
// stop it from closing a JS string literal there, because the browser decodes the entity
// back to a literal character before the JS parser ever runs.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function load(dir) {
  try {
    const rep = { dir, name: basename(dirname(dir)) || basename(dir), ...JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) };
    const muted = loadMutes(join(dir, "muted.json"));
    rep.results = (rep.results || []).map((r) => ({ ...r, findings: (r.findings || []).filter((f) => !muted.has(fingerprint(f))) }));
    return rep;
  } catch { return null; }
}

function render() {
  const reports = dirs.map(load).filter(Boolean);
  const rows = reports.map((rep) => {
    const all = (rep.results || []).flatMap((r) => (r.findings || []).map((f) => ({ ...f, path: r.path })));
    // Evidence order on every card: crop first and large, then the rule, then one short
    // sentence. Never a persuasive paragraph -- the point is a 2-second check, not a pitch.
    const cards = all.map((f) => `
      <article class="card${f.isNew ? " new" : ""}" data-new="${!!f.isNew}">
        ${f.crop ? `<img loading="lazy" src="/crop?d=${encodeURIComponent(rep.dir)}&f=${encodeURIComponent(f.crop)}" alt="${esc(f.rule)} crop">` : `<div class="nocrop">no crop</div>`}
        <div class="meta">
          <span class="rule">${esc(f.rule)}</span>
          <span class="w">${esc(f.width)}px</span>
          ${f.isNew ? `<span class="badge">new</span>` : ""}
        </div>
        ${f.state && f.state !== "initial" ? `<div class="state">only after: ${esc(f.state)}</div>` : ""}
        ${f.alsoIn && f.alsoIn.length ? `<div class="also">also in ${f.alsoIn.length} other state${f.alsoIn.length > 1 ? "s" : ""}: ${esc(f.alsoIn.join(", "))}</div>` : ""}
        <p class="msg">${esc(f.msg)}</p>
        <code>${esc(f.path)} &rsaquo; ${esc(f.sel)}</code>
        <div class="actions">
          <button onclick="copyFix(this)" data-fix="${esc(`In ${f.path}, the element ${f.sel} at viewport width ${f.width}px has this problem: ${f.msg}. Find it and fix it. Do not change anything else.`)}">Copy fix prompt</button>
          <button onclick="mute(this)" data-dir="${esc(rep.dir)}" data-rule="${esc(f.rule)}" data-sel="${esc(f.sel)}" data-width="${Number(f.width) || 0}">Mute</button>
        </div>
      </article>`).join("");
    const cov = rep.coverage || {};
    // Exploration summary. Only rendered when the run actually explored, so an opt-out
    // report is byte-identical to before this feature existed. `failed` is surfaced here
    // because a silently broken driver otherwise looks exactly like a clean empty run.
    const ex = (rep.results || []).reduce((a, r) => ({
      states: a.states + ((r.states || []).length),
      noops: a.noops + ((r.noops || []).length),
      failed: a.failed + ((r.failed || []).length),
    }), { states: 0, noops: 0, failed: 0 });
    const exLine = (ex.states || ex.noops || ex.failed)
      ? `<p class="cov">explored ${ex.states} state(s) &middot; ${ex.noops} interaction(s) changed nothing${ex.failed ? ` &middot; <strong>${ex.failed} failed</strong>` : ""}</p>`
      : "";
    return `<section>
      <h2>${esc(rep.name)}</h2>
      <p class="cov">${all.length} finding(s) &middot; routes ${esc(cov.tested)}/${esc(cov.total)} &middot; widths ${esc((rep.widths || []).join(", "))} &middot; state ${esc(rep.state)}</p>
      ${exLine}
      <div class="grid">${cards || "<p class=empty>Nothing found.</p>"}</div>
    </section>`;
  }).join("");

  return `<!doctype html><meta charset=utf-8><title>frontend verify</title>
<style>
:root{--bg:#fff;--fg:#18181b;--mut:#52525b;--line:#e4e4e7;--acc:#1d4ed8}
@media(prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--mut:#a1a1aa;--line:#27272a;--acc:#2563eb}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 4px}
.cov{color:var(--mut);font-size:13px;margin:0 0 12px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--bg)}
.card.new{border-color:var(--acc)}
.card img{width:100%;max-height:220px;object-fit:contain;background:#71717a22;border-radius:6px;display:block}
.nocrop{height:60px;display:grid;place-items:center;color:var(--mut);background:#71717a22;border-radius:6px;font-size:13px}
.meta{display:flex;gap:8px;align-items:center;margin:10px 0 4px;font-size:12px;color:var(--mut)}
.rule{font-weight:600;color:var(--fg)}
.badge{background:var(--acc);color:#fff;border-radius:4px;padding:1px 6px}
.msg{margin:4px 0}code{font-size:12px;color:var(--mut);word-break:break-all}
.state{font-size:12px;margin:2px 0 0;padding:2px 8px;border-radius:999px;display:inline-block;background:var(--acc);color:#fff}
.also{font-size:12px;color:var(--mut);margin:4px 0 0}
.noops{margin-top:18px;font-size:13px;color:var(--mut)}
.noops li{margin:2px 0}
.actions{display:flex;gap:8px;margin-top:10px}
button{font:inherit;font-size:13px;padding:5px 10px;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:6px;cursor:pointer}
button:hover{border-color:var(--acc)}
.empty{color:var(--mut)}
#filter{margin:12px 0}
</style>
<h1>frontend verify</h1>
<label id=filter><input type=checkbox onchange="document.body.classList.toggle('onlynew',this.checked)" checked> new since last run only</label>
<style>body.onlynew .card[data-new="false"]{display:none}</style>
<script>
document.body.classList.add('onlynew');
function copyFix(b){
  navigator.clipboard.writeText(b.dataset.fix)
    .then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy fix prompt',1200)})
    .catch(()=>{b.textContent='Copy failed';setTimeout(()=>b.textContent='Copy fix prompt',1200)});
}
function mute(b){
  const d=b.dataset;
  fetch('/mute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir:d.dir,rule:d.rule,sel:d.sel,width:Number(d.width)})})
    .then((r)=>{ if(!r.ok) throw new Error('mute failed: '+r.status); location.reload(); })
    .catch((e)=>alert(e.message));
}
</script>
${rows}`;
}

createServer((req, res) => {
  const u = new URL(req.url, "http://x");

  if (u.pathname === "/crop") {
    // SECURITY GUARD, not a nicety: only serve a file whose resolved path sits inside one of
    // the outDir roots this server was started with -- otherwise it would serve arbitrary
    // files off disk. A bare startsWith(dir) is not enough: a sibling directory named
    // "<dir>-evil" shares the same string prefix as "<dir>", so the check also requires the
    // path separator right after the match (or an exact match on the dir itself).
    const file = resolve(join(u.searchParams.get("d") || "", u.searchParams.get("f") || ""));
    const inside = dirs.some((d) => file === d || file.startsWith(d + sep));
    let data = null;
    if (inside) { try { data = readFileSync(file); } catch { /* missing, or not a regular file */ } }
    if (!data) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "image/png" }).end(data);
    return;
  }

  if (u.pathname === "/mute" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { dir, rule, sel, width } = JSON.parse(body);
        if (!dirs.includes(resolve(dir))) { res.writeHead(403).end(); return; }
        addMute(join(dir, "muted.json"), fingerprint({ rule, sel, width }));
        res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(render());
}).listen(PORT, () => console.log(`report: http://localhost:${PORT}`));
