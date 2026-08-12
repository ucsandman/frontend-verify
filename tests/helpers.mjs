import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = readFileSync(join(HERE, "..", "scripts", "probe.js"), "utf8");

// MUST be async. execSync BLOCKS the Node event loop, and the fixture server below runs in
// THIS process — so a synchronous call means the server can never answer the browser, and
// `goto http://localhost:<port>/` hangs until it times out. Measured: execSync produced a
// 30s timeout on every call after `open`; promisified exec completes the cycle in 2.4s.
// exec, not execFile: playwright-cli is a .cmd shim on Windows and Node 20+ refuses to
// spawn a .cmd without a shell (spawn EINVAL).
const pExec = promisify(exec);

/** Flatten to one line so a shell-passed CLI arg cannot be cut short by a line comment. */
const oneLine = (src) => src.split("\n").join(" ").replace(/\s+/g, " ").trim();

// strict=true (used for `open`) rethrows instead of swallowing: a launch race under
// parallel node:test needs to fail loudly right here, with the real stderr, instead of
// surfacing 3 calls later as an opaque "did not return JSON. Got: (empty)".
async function cli(args, strict) {
  const q = (a) => `"${String(a).replace(/"/g, '\\"')}"`;
  const opts = { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
  try {
    const { stdout } = await pExec(`playwright-cli ${args.map(q).join(" ")}`, opts);
    return (stdout || "").trim();
  } catch (e) {
    if (strict) {
      throw new Error(`playwright-cli ${args.join(" ")} failed:\n` + [e.stderr, e.stdout, e.message].filter(Boolean).join("\n"));
    }
    return [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
  }
}

/** Serve one fixture, run the probe at a given size, hand findings to fn. */
export async function withFixture(fileName, width, height, fn) {
  const html = readFileSync(join(HERE, "fixtures", fileName), "utf8");
  const srv = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  // Session name MUST be unique per call. node:test overlaps top-level tests, so a shared
  // name means one test's close() in finally kills another test's live browser.
  const S = `-s=fv-${port}`;
  try {
    await cli([S, "open"], true);
    await cli([S, "goto", `http://localhost:${port}/`]);
    await cli([S, "resize", String(width), String(height)]);
    const raw = await cli([S, "--raw", "eval", oneLine(PROBE)]);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("probe did not return JSON. Got:\n" + raw.slice(0, 400)); }
    await fn(parsed);
  } finally {
    await cli([S, "close"]);
    await new Promise((r) => srv.close(r));
  }
}

const ACTIONS = readFileSync(join(HERE, "..", "scripts", "actions.js"), "utf8");

/** Serve one fixture, evaluate actions.js at a given size, hand the result to fn. */
export async function evalActions(fileName, width, height, fn) {
  const html = readFileSync(join(HERE, "fixtures", fileName), "utf8");
  const srv = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const S = `-s=fv-${port}`;
  try {
    await cli([S, "open"], true);
    await cli([S, "goto", `http://localhost:${port}/`]);
    await cli([S, "resize", String(width), String(height)]);
    const raw = await cli([S, "--raw", "eval", oneLine(ACTIONS)]);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("actions did not return JSON. Got:\n" + raw.slice(0, 400)); }
    await fn(parsed);
  } finally {
    await cli([S, "close"]);
    await new Promise((r) => srv.close(r));
  }
}

export const countOf = (result, rule) => result.findings.filter((f) => f.rule === rule).length;

import { exploreWidth } from "../scripts/explore.mjs";

const FILL = readFileSync(join(HERE, "..", "scripts", "fill.js"), "utf8");

/** Serve a fixture and run the real explore loop against it in a real browser. */
export async function withExplore(fileName, width, height, opts, fn) {
  const html = readFileSync(join(HERE, "fixtures", fileName), "utf8");
  const srv = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const S = `-s=fv-${port}`;
  const url = `http://localhost:${port}/`;
  try {
    await cli([S, "open"], true);
    const goto = async () => {
      await cli([S, "goto", url]);
      await cli([S, "resize", String(width), String(height)]);
    };
    await goto();
    const out = await exploreWidth(
      {
        readActions: async () => JSON.parse(await cli([S, "--raw", "eval", oneLine(ACTIONS)])),
        reset: goto,
        click: async (p) => { await cli([S, "click", p]); },
        fillForm: async (p, mode) => {
          await cli([S, "--raw", "eval",
            oneLine(FILL).split("__PATH__").join(p).split("__MODE__").join(mode)]);
        },
        scan: async () => (JSON.parse(await cli([S, "--raw", "eval", oneLine(PROBE)])).findings || []),
        now: () => Date.now(),
      },
      opts,
    );
    out.title = (await cli([S, "--raw", "eval", "document.title"])).replace(/^"|"$/g, "");
    await fn(out);
  } finally {
    await cli([S, "close"]);
    await new Promise((r) => srv.close(r));
  }
}
