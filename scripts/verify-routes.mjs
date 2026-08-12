#!/usr/bin/env node
// frontend-verify / verify-routes.mjs
//
// Token-efficient frontend verification driver built on @playwright/cli.
//
// Why this script exists:
//   Reading a full accessibility snapshot or a screenshot into the model context on
//   every route is expensive. The cheap, high signal checks are console errors,
//   failed network requests, and a few targeted text assertions. This script runs
//   those checks across a set of routes in ONE pass, writes the full detail to disk,
//   and prints a compact summary. The agent then opens detail files only for routes
//   that were flagged, instead of streaming every page state into context.
//
//   The browser runs HEADLESS by default (the playwright-cli default), so no window
//   opens. Set "headed": true in the config to watch it run.
//
// Usage:
//   node verify-routes.mjs <config.json>
//
// Config shape (annotated version lives in SKILL.md):
// {
//   "baseUrl": "http://localhost:3000",
//   "session": "fe-verify",
//   "browser": "chromium",         // optional: chrome | firefox | webkit | msedge
//   "headed": false,               // optional: open a visible window
//   "stateFile": null,             // optional: auth state json saved via "playwright-cli state-save"
//   "settleMs": 800,               // optional: pause after load so client side fetches can fire
//   "checkWarnings": false,        // optional: treat console warnings as WARN status
//   "apiFilter": null,             // optional: regex string, only list requests whose url matches (e.g. "/api/")
//   "outDir": ".frontend-verify",  // optional
//   "routes": [
//     {
//       "path": "/",
//       "expectText": ["Dashboard"],     // substrings that MUST appear in body text
//       "expectNoText": ["NaN"],         // substrings that must NOT appear
//       "waitForText": "Dashboard",      // optional: poll until this text renders (async routes)
//       "canvas": false                  // optional: mark canvas/WebGL route (a11y tree is blind)
//     }
//   ]
// }

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exploreWidth, runFlow } from "./explore.mjs";

const isWin = process.platform === "win32";
const CLI_OVERRIDE = (process.env.FE_VERIFY_CLI || "").trim(); // e.g. "npx --no-install playwright-cli"
const HERE = dirname(fileURLToPath(import.meta.url));
// Flatten a browser-source file to one line: a `//` comment inside a multi-line eval arg
// swallows the rest of its line once the string crosses the shell, including an IIFE's
// closing token. Same fix tests/helpers.mjs applies, for the identical reason.
const oneLine = (src) => src.split("\n").join(" ").replace(/\s+/g, " ").trim();

// Quote one arg for cmd.exe. Node based CLIs parse \" as a literal quote in argv,
// so escaping inner quotes this way is correct for the playwright-cli shim on Windows.
function winQuote(a) {
  return `"${String(a).replace(/"/g, '\\"')}"`;
}

// Run one playwright-cli invocation. Returns { ok, out }. Never throws.
function cli(args) {
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 };
  try {
    let out;
    if (CLI_OVERRIDE) {
      out = execSync(`${CLI_OVERRIDE} ${args.map(winQuote).join(" ")}`, opts);
    } else if (isWin) {
      // The Windows npm bin is a .cmd shim, so it must run through a shell.
      out = execSync(`playwright-cli ${args.map(winQuote).join(" ")}`, opts);
    } else {
      // POSIX: no shell, args passed literally, so urls with & ? = stay intact.
      out = execFileSync("playwright-cli", args, opts);
    }
    return { ok: true, out: (out || "").trim() };
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
    return { ok: false, out };
  }
}

// Blocking sleep inside a synchronous script.
function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Parse a JSON-quoted eval result back to a plain string. --raw eval returns the
// value serialized as JSON (a string comes back wrapped in quotes with \n escapes).
function evalText(args) {
  const raw = cli(args).out;
  try { return JSON.parse(raw); } catch { return raw; }
}

function slug(p) {
  const s = p.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "root";
}

/**
 * Interaction may only ever add genuinely new defects. A token that is low-contrast in five
 * states is ONE finding listing five states, not five findings.
 * @param {Map<string,object>} seen  key -> the finding that first reported it
 * @returns {Array} only the findings whose key was unseen
 */
export function dedupeInto(seen, findings, width) {
  const fresh = [];
  for (const f of findings) {
    const key = `${f.rule}|${f.sel}|${width}`;
    const prior = seen.get(key);
    if (prior) {
      if (f.state && f.state !== prior.state) {
        prior.alsoIn = prior.alsoIn || [];
        if (!prior.alsoIn.includes(f.state)) prior.alsoIn.push(f.state);
      }
      continue;
    }
    seen.set(key, f);
    fresh.push(f);
  }
  return fresh;
}

/**
 * Tag this width's raw findings state:"initial" IN PLACE (never a copy) and seed `seen`
 * with those same object references, so a later dedupeInto call's alsoIn mutation lands on
 * the exact objects that flow into detail.json / report.json. A spread copy here would
 * make the feature a silent no-op: the mutation would land on a throwaway object nobody
 * ever reads.
 * @returns {Array} the findings that were newly seeded (dedupeInto's own return)
 */
export function seedInitial(seen, findings, width) {
  for (const f of findings) f.state = "initial";
  return dedupeInto(seen, findings, width);
}

/**
 * Task 6 gate for one width: whether interaction runs at all. Extracted so the opt-out
 * guarantee is provable against the exact code main() runs, not a parallel copy of it --
 * deleting or inverting this check is exactly the regression this function exists to catch.
 * Disabled/absent config: `findings` is returned completely untouched and `run` (the real
 * exploreWidth call) is never invoked.
 *
 * `findings` must be the route's real, persistent findings array (not a filtered copy):
 * newly-discovered exploration findings are pushed directly onto it, so a `.filter()` result
 * passed in here would silently swallow every finding interaction discovers.
 * @param {{enabled?:boolean}} ex
 * @param {Map<string,object>} seen
 * @param {Array} findings  the route's findings array; filtered to this width internally
 * @param {number} width
 * @param {() => Promise<{states:Array, findings:Array, noops:Array, failed:Array}>} run
 */
export async function maybeExplore(ex, seen, findings, width, run) {
  if (!ex.enabled) return { states: [], noops: [], failed: [] };
  const widthFindings = findings.filter((f) => f.width === width);
  seedInitial(seen, widthFindings, width);
  const out = await run();
  // IMPORTANT: tag in place, not a spread copy -- exploreWidth never sets width on the
  // findings it returns, and report-server.mjs / mute-store.mjs both key off it.
  for (const f of out.findings) f.width = width;
  findings.push(...dedupeInto(seen, out.findings, width));
  return { states: out.states, noops: out.noops, failed: out.failed || [] };
}

// Outline the flagged element in pink, then walk up from it until an ancestor is at
// least 240x48 (capped at 4 hops) and stamp that ancestor with data-rvctx. The crop
// screenshots the ancestor, not the bare element, so a 9px span is not the whole photo.
const ctxExpr = (rv) => `(()=>{const el=document.querySelector('[data-rv="${rv}"]');if(!el)return 0;el.style.outline='2px solid #ff0055';el.style.outlineOffset='1px';let n=el,hops=0;while(n.parentElement&&hops<4){const r=n.getBoundingClientRect();if(r.width>=240&&r.height>=48)break;n=n.parentElement;hops++}n.setAttribute('data-rvctx','${rv}');return 1})()`;

// Undo the outline and the context stamp so the next finding's crop is not polluted.
const clearExpr = (rv) => `(()=>{const el=document.querySelector('[data-rv="${rv}"]');if(el){el.style.outline='';el.style.outlineOffset=''}const c=document.querySelector('[data-rvctx="${rv}"]');if(c)c.removeAttribute('data-rvctx');return 1})()`;

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) { console.error("usage: node verify-routes.mjs <config.json>"); process.exit(2); }

  let cfg;
  try { cfg = JSON.parse(readFileSync(resolve(cfgPath), "utf8")); }
  catch (e) { console.error(`could not read config: ${e.message}`); process.exit(2); }

  const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) { console.error("config.baseUrl is required"); process.exit(2); }
  const session = cfg.session || "fe-verify";
  const settleMs = Number.isFinite(cfg.settleMs) ? cfg.settleMs : 800;
  const outDir = cfg.outDir || ".frontend-verify";
  let routes = [];
  let skippedRoutes = [];
  if (cfg.routes === "auto") {
    const { routes: found, skipped } = await import("./routes-discover.mjs")
      .then((m) => m.discoverRoutes(cfg.rootDir || process.cwd()));
    routes = found.map((p) => ({ path: p }));
    skippedRoutes = skipped;
  } else {
    routes = Array.isArray(cfg.routes) ? cfg.routes : [];
  }
  if (!routes.length) { console.error("config.routes is empty (and auto-discovery found nothing)"); process.exit(2); }

  const widths = Array.isArray(cfg.widths) && cfg.widths.length ? cfg.widths : [1440];
  const occlusion = cfg.occlusion === true;
  // Flatten to one line: a `//` comment inside a multi-line eval arg swallows the rest of
  // its line once the string crosses the shell, including the IIFE's closing token, which
  // turns every probe run into "SyntaxError: Unexpected token ')'" instead of a result.
  // Same fix tests/helpers.mjs already applies for the identical reason.
  const PROBE_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "probe.js"), "utf8")
    .split("\n").join(" ").replace(/\s+/g, " ").trim();

  // Interaction (Task 6). Hoisted once here, not recomputed per route: cfg.explore doesn't
  // change mid-run. ACTIONS_SRC/FILL_SRC are read only when explore is actually on, so an
  // opt-out run has no dependency on these files existing at all.
  const ex = cfg.explore || {};
  let ACTIONS_SRC = null;
  let FILL_SRC = null;
  if (ex.enabled) {
    // Same flattening as PROBE_SRC above, same reason.
    ACTIONS_SRC = oneLine(readFileSync(join(HERE, "actions.js"), "utf8"));
    FILL_SRC = oneLine(readFileSync(join(HERE, "fill.js"), "utf8"));
  }

  // axe-core is opt-in (config "axe": true), default OFF. See the MEASURED COST comment
  // above the injection loop below for why. Resolved from the TARGET repo's node_modules,
  // not this skill's. Absent is normal (most repos verified here never installed it) so
  // skip quietly, never fail.
  let AXE_SRC = null;
  if (cfg.axe === true) {
    try {
      AXE_SRC = readFileSync(join(cfg.rootDir || process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");
    } catch {
      console.log("axe-core not found in the target repo. Skipping accessibility rules. Fix: npm i -D axe-core");
    }
  } else {
    console.log('axe: skipped (set "axe": true to enable; costs about 70s per route on Windows)');
  }

  // axe.min.js is ~560KB, far past the ~8000 char Windows cmd.exe command-line limit a
  // single eval argument can carry (confirmed: "The command line is too long."). A local
  // HTTP server does not route around this either: the target is HTTPS, and browsers
  // block an HTTPS page from loading an HTTP script as mixed content (confirmed: fetch
  // and <script src> both threw "Failed to fetch" against http://127.0.0.1). So instead,
  // base64-encode it once here and send it to the page in small chunks (see AXE_CHUNK
  // below), which is well within the command-line limit per call.
  const AXE_B64 = AXE_SRC ? Buffer.from(AXE_SRC, "utf8").toString("base64") : null;
  const AXE_CHUNK = 7000;

  const S = `-s=${session}`;
  mkdirSync(outDir, { recursive: true });

  // Open one headless browser for the whole run (the daemon stays warm across routes).
  const openArgs = [S, "open"];
  if (cfg.browser) openArgs.push(`--browser=${cfg.browser}`);
  if (cfg.headed) openArgs.push("--headed");
  const opened = cli(openArgs);
  if (!opened.ok && !/already/i.test(opened.out)) {
    console.error("failed to open browser:\n" + opened.out);
    console.error('\nIf the browser binary is missing, run: playwright-cli install-browser chrome-for-testing');
    process.exit(2);
  }
  if (cfg.stateFile) cli([S, "state-load", cfg.stateFile]); // restore auth, if provided

  const results = [];
  try {
    for (const r of routes) {
      const path = r.path || "/";
      const url = baseUrl + (path.startsWith("/") ? path : "/" + path);
      const dir = join(outDir, slug(path));
      mkdirSync(dir, { recursive: true });

      // Navigate. goto exits 0 even on a network error, so scan the output for markers.
      const nav = cli([S, "goto", url]);
      const navFailed = !nav.ok || /###\s*Error|net::ERR_|\bERR_[A-Z_]+\b/.test(nav.out);
      sleep(settleMs); // let client side fetches fire so failed API calls register

      // Optional: wait until expected content renders (covers async / client rendered routes).
      let bodyText = null;
      if (r.waitForText) {
        for (let i = 0; i < 15; i++) {
          bodyText = evalText([S, "--raw", "eval", "document.body.innerText"]);
          if (bodyText.includes(r.waitForText)) break;
          sleep(300);
        }
      }

      // Console: one call, all levels, then clear so the next route starts clean.
      // Do NOT use --raw here: --raw strips the very message lines we need.
      const consoleText = cli([S, "console", "--clear"]).out;
      const jsErrors = [];       // genuine JS / console errors
      const resourceErrors = []; // "Failed to load resource" lines (network, also in requests)
      const warnings = [];
      for (const line of consoleText.split("\n")) {
        const t = line.trim();
        if (t.startsWith("[ERROR]")) (/(Failed to load resource)/i.test(t) ? resourceErrors : jsErrors).push(t);
        else if (t.startsWith("[WARNING]")) warnings.push(t);
      }

      // Requests: authoritative network list. Static assets are hidden by default,
      // which keeps favicon and bundle noise out. Parse the "=> [status]" suffix.
      const reqArgs = [S, "requests", "--clear"];
      if (cfg.apiFilter) reqArgs.push(`--filter=${cfg.apiFilter}`);
      const requestsText = cli(reqArgs).out;
      const netFailures = [];
      for (const line of requestsText.split("\n")) {
        const m = line.match(/=>\s*\[([^\]]+)\]/);
        if (!m) continue;
        const status = m[1].trim();
        const code = parseInt(status, 10);
        if ((Number.isFinite(code) && code >= 400) || /fail|abort|refus|block|timeout|error/i.test(status)) {
          netFailures.push(line.trim());
        }
      }

      // Text assertions. Pull body text once (reuse the waitForText fetch if present),
      // then test substrings in Node so no user text reaches the shell.
      const wantsText = (r.expectText && r.expectText.length) || (r.expectNoText && r.expectNoText.length);
      if (wantsText && bodyText === null) bodyText = evalText([S, "--raw", "eval", "document.body.innerText"]);
      const body = bodyText || "";
      const missingText = (r.expectText || []).filter((t) => !body.includes(t));
      const forbiddenText = (r.expectNoText || []).filter((t) => body.includes(t));

      const title = evalText([S, "--raw", "eval", "document.title"]);

      // Decide status.
      let status = "PASS";
      const reasons = [];

      // Defect probe, once per width. resize is cheap; the browser stays warm.
      const findings = [];
      // Interaction (Task 6). maybeExplore's own gate handles enabled/disabled -- `findings`
      // is only ever pushed to by the probe below when disabled, so output stays
      // byte-identical to before this feature existed. `seen` is declared fresh per route
      // (right here, alongside `findings`) so a finding on one route can never suppress the
      // same selector on another route.
      const seen = new Map(); // rule|sel|width -> the finding that first reported it
      const routeStates = [];
      const routeNoops = [];
      const routeFailed = [];
      for (const w of widths) {
        cli([S, "resize", String(w), String(cfg.viewportHeight || 900)]);
        sleep(250); // let responsive layout settle before measuring geometry
        if (occlusion) cli([S, "--raw", "eval", "window.__FV_OCCLUSION = true"]);
        const raw = cli([S, "--raw", "eval", PROBE_SRC]).out;
        let probed = null;
        try { probed = JSON.parse(raw); } catch { /* probe failed on this width */ }
        if (probed && Array.isArray(probed.findings)) {
          for (const f of probed.findings) findings.push({ ...f, width: w });
          // The probe stamped data-rv on every flagged element, so the selector is unique.
          // Crop immediately, same page/width the probe just ran on — any navigation or
          // resize before this point invalidates the stamp.
          for (const f of probed.findings) {
            const name = `${slug(path)}-w${w}-rv${f.rv}.png`;
            cli([S, "--raw", "eval", ctxExpr(f.rv)]);
            const shot = cli([S, "screenshot", `[data-rvctx="${f.rv}"]`, "--filename", join(dir, name)]);
            cli([S, "--raw", "eval", clearExpr(f.rv)]);
            const rec = findings.find((x) => x.rv === f.rv && x.width === w);
            if (rec) rec.crop = shot.ok ? join(slug(path), name) : null;
          }
        } else {
          reasons.push(`probe failed at width ${w}`);
        }

        // Interaction: click/fill through the route's controls and probe again after each
        // one. maybeExplore is the single gate (opt-out proven against this exact call in
        // dedupe.test.mjs, not a parallel copy of it); mutating is decided once, inside
        // exploreWidth -- nothing here re-checks kind or adds a second gate around it.
        // Pass the real `findings` array, not a filtered copy -- see maybeExplore's own doc.
        const explored = await maybeExplore(ex, seen, findings, w, () => {
          const per = Math.floor((ex.budgetMs || 60000) / widths.length);
          return exploreWidth(
            {
              readActions: async () => JSON.parse(cli([S, "--raw", "eval", ACTIONS_SRC]).out),
              reset: async () => {
                cli([S, "goto", url]);
                cli([S, "resize", String(w), String(cfg.viewportHeight || 900)]);
              },
              click: async (p) => { cli([S, "click", p]); },
              fillForm: async (p, mode) => {
                cli([S, "--raw", "eval", FILL_SRC.split("__PATH__").join(p).split("__MODE__").join(mode)]);
              },
              scan: async () => JSON.parse(cli([S, "--raw", "eval", PROBE_SRC]).out).findings || [],
              now: () => Date.now(),
            },
            { budgetMs: per, invalidPass: ex.invalidPass !== false, mutate: ex.mutate || [], skip: ex.skip || [] },
          );
        });
        routeStates.push(...explored.states);
        routeNoops.push(...explored.noops);
        routeFailed.push(...explored.failed);

        // Declared flows reach depth that auto-exploration deliberately does not attempt.
        // They run independently of explore.enabled -- the author wrote these steps by
        // hand, so they are not gated by the safety classifier or by budgetMs.
        const steps = (cfg.flows || {})[path];
        if (steps && steps.length) {
          cli([S, "goto", url]);
          cli([S, "resize", String(w), String(cfg.viewportHeight || 900)]);
          const fout = await runFlow(
            {
              click: async (p) => { cli([S, "click", p]); },
              fillOne: async (p, v) => { cli([S, "fill", p, v]); },
              scan: async () => JSON.parse(cli([S, "--raw", "eval", PROBE_SRC]).out).findings || [],
            },
            steps,
          );
          // Same in-place width tagging as explore findings: a spread copy here would send
          // alsoIn to a throwaway object and it would never reach report.json.
          for (const f of fout.findings) f.width = w;
          findings.push(...dedupeInto(seen, fout.findings, w));
          routeStates.push(...fout.states);
          routeFailed.push(...fout.failed);
        }
      }

      // axe-core, once per route at the widest viewport. wcag22aa is REQUIRED in the tag
      // list below: without it target-size (WCAG 2.2) never runs, even with axe loaded.
      //
      // MEASURED COST (2026-08-11, Windows): +72s per route (17s -> 89s measured on one
      // route), roughly an hour of pure overhead across DashClaw's 49 routes. Root cause:
      // axe.min.js is 560KB, base64-encodes to ~747KB, and cmd.exe's ~8000-char command-line
      // limit forces that through ~110 chunked eval round-trips below -- once per route,
      // because each `goto` reloads the page and the chunks cannot survive that. On the
      // route this was measured against, axe returned exactly one finding
      // (axe:color-contrast) that our own `contrast` rule already reports, and target-size
      // (its main unique value) did not fire. That is why axe defaults OFF (config
      // "axe": true to enable, gated above) -- do not collapse the chunk loop back into one
      // eval call to "optimise" it, it will fail with "The command line is too long."
      if (AXE_SRC) {
        cli([S, "resize", String(Math.max(...widths)), String(cfg.viewportHeight || 900)]);
        // Send axe.min.js to the page in AXE_CHUNK-sized base64 pieces (each call is one
        // eval argument, so each must stay under the command-line limit), then decode and
        // run the reassembled source with an indirect eval so it executes in true global
        // scope — same as a <script> tag would — and axe-core's UMD bundle attaches
        // window.axe the normal way.
        cli([S, "--raw", "eval", "window.__axeB64=[]"]);
        for (let i = 0; i < AXE_B64.length; i += AXE_CHUNK) {
          const chunk = AXE_B64.slice(i, i + AXE_CHUNK);
          cli([S, "--raw", "eval", `window.__axeB64.push("${chunk}")`]);
        }
        // A single expression, not statements: playwright-cli's eval wraps the argument in
        // a return-expression context, and a bare top-level `;` there is a syntax error.
        cli([S, "--raw", "eval", "(()=>{(0,eval)(atob(window.__axeB64.join('')));window.__axeB64=null;return 1})()"]); // defines window.axe
        const axeExpr = `axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,3).map(n=>n.target.join(' '))}))))`;
        const axeRaw = cli([S, "--raw", "eval", axeExpr]).out;
        // Double JSON.parse is intentional: --raw serializes the resolved promise value,
        // and the expression itself already returned a JSON string.
        try {
          for (const v of JSON.parse(JSON.parse(axeRaw))) {
            findings.push({
              rv: null, rule: `axe:${v.id}`, msg: `${v.help} (${v.impact})`,
              sel: v.nodes[0] || null, box: null, crop: null, width: Math.max(...widths),
            });
          }
        } catch { reasons.push("axe run failed"); }
      }

      if (navFailed) { status = "FAIL"; reasons.push("navigation failed (" + (nav.out.match(/ERR_[A-Z_]+/)?.[0] || "see detail") + ")"); }
      if (jsErrors.length) { status = "FAIL"; reasons.push(`${jsErrors.length} JS console error(s)`); }
      if (netFailures.length) { status = "FAIL"; reasons.push(`${netFailures.length} request failure(s)`); }
      if (missingText.length) { status = "FAIL"; reasons.push(`missing text: ${missingText.map((t) => JSON.stringify(t)).join(", ")}`); }
      if (forbiddenText.length) { status = "FAIL"; reasons.push(`forbidden text present: ${forbiddenText.map((t) => JSON.stringify(t)).join(", ")}`); }
      if (status === "PASS" && r.canvas) { status = "WARN"; reasons.push("canvas route: accessibility tree is blind, screenshot or eval app state if the visual matters"); }
      if (status === "PASS" && cfg.checkWarnings && warnings.length) { status = "WARN"; reasons.push(`${warnings.length} console warning(s)`); }
      if (findings.length && status === "PASS") { status = "WARN"; reasons.push(`${findings.length} visual finding(s)`); }
      // routeFailed is always [] when explore is off, so this never fires for an opt-out
      // run. A route where every interaction failed must not print [PASS] with the only
      // evidence buried in a detail.json nobody opens for a passing route.
      if (status === "PASS" && routeFailed.length) { status = "WARN"; reasons.push(`${routeFailed.length} interaction(s) failed`); }

      // Write full detail to disk. The agent reads these only for flagged routes.
      const detail = {
        path, url, status, title, reasons,
        jsErrors: jsErrors.length ? jsErrors : "(none)",
        requestFailures: netFailures.length ? netFailures : "(none)",
        warnings: warnings.length ? warnings : "(none)",
        resourceErrors: resourceErrors.length ? resourceErrors : "(none)",
        navOk: !navFailed,
        findings,
        // Explore is opt-in: these keys exist only when cfg.explore.enabled is true, so a
        // disabled/absent run writes the exact same detail.json shape as before this feature.
        ...(ex.enabled ? { states: routeStates, noops: routeNoops, failed: routeFailed } : {}),
      };
      writeFileSync(join(dir, "detail.json"), JSON.stringify(detail, null, 2));
      if (consoleText) writeFileSync(join(dir, "console.txt"), consoleText);
      if (requestsText) writeFileSync(join(dir, "requests.txt"), requestsText);

      results.push({
        path, status, reasons, jsErr: jsErrors.length, netFail: netFailures.length, findings,
        // Same opt-in-only shape rule as detail.json above.
        ...(ex.enabled ? { failed: routeFailed.length } : {}),
      });
    }
  } finally {
    cli([S, "close"]); // always release the browser
  }

  // Read the PREVIOUS report and the mute list before report.json gets overwritten below —
  // read-then-write in the other order means every finding looks "not new", every time.
  const { fingerprint, loadMutes, markNew } = await import("./mute-store.mjs");
  const muteFile = cfg.mutePath || join(outDir, "muted.json");
  const muted = loadMutes(muteFile);
  let prev = new Set();
  try { prev = new Set((JSON.parse(readFileSync(join(outDir, "report.json"), "utf8")).results || [])
    .flatMap((r) => r.findings || []).map(fingerprint)); } catch { /* first run */ }

  for (const r of results) {
    r.findings = markNew(r.findings || [], prev).filter((f) => !muted.has(fingerprint(f)));
  }

  const coverage = { tested: results.length, skipped: skippedRoutes.length, total: results.length + skippedRoutes.length };
  writeFileSync(join(outDir, "report.json"), JSON.stringify({
    baseUrl, when: new Date().toISOString(), widths,
    state: cfg.stateFile ? "warm" : "cold",
    coverage, skippedRoutes, results,
  }, null, 2));

  // Compact summary to stdout. This is the only thing the agent needs to read first.
  const pad = Math.min(40, Math.max(12, ...results.map((r) => r.path.length)) + 2);
  console.log(`\nFRONTEND VERIFY  base=${baseUrl}  routes=${results.length}/${coverage.total}  widths=${widths.join(",")}\n`);
  for (const r of results) {
    const extra = r.reasons.length ? "  " + r.reasons.join("; ") : "  console:0  net-fail:0";
    console.log(`[${r.status}] ${r.path.padEnd(pad)}${extra}`);
  }
  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  console.log(`\n${fails} fail, ${warns} warn, ${pass} pass.  Details: ${outDir}/<route>/detail.json   Report: ${join(outDir, "report.json")}`);
  if (skippedRoutes.length) {
    console.log(`${skippedRoutes.length} route(s) skipped: ${skippedRoutes.slice(0, 5).map((s) => s.path).join(", ")}${skippedRoutes.length > 5 ? " ..." : ""}`);
  }
  if (fails > 0) console.log("Open detail.json for any FAIL route to see the exact errors and request log.");

  process.exit(fails > 0 ? 1 : 0);
}

// Guard so a test can `import { dedupeInto } from "./verify-routes.mjs"` without triggering a
// real run: main() used to fire unconditionally on any import, which killed the process with
// "usage: ..." + exit(2) before the importing module's own code ever executed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
