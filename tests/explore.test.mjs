import { test } from "node:test";
import assert from "node:assert/strict";
import { exploreWidth, runFlow } from "../scripts/explore.mjs";

/** Build fake deps whose click() moves through a scripted list of signatures. */
function fakeDeps({ candidates, sigs, findingsByLabel = {} }) {
  let i = 0;
  const clicked = [];
  let t = 0;
  return {
    clicked,
    deps: {
      readActions: async () => ({ sig: sigs[i], candidates }),
      reset: async () => { i = 0; },
      click: async (p) => { clicked.push(p); i = Math.min(i + 1, sigs.length - 1); },
      scan: async (label) => findingsByLabel[label] || [],
      now: () => (t += 100),
    },
  };
}

test("scans a state whose signature is new", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [{ path: "#tab-b", kind: "tab", label: "Billing", mutating: false, rank: 1 }],
    sigs: ["A", "B"],
    findingsByLabel: { "tab:Billing": [{ rule: "contrast", sel: "span.low" }] },
  });
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.deepEqual(clicked, ["#tab-b"]);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].state, "tab:Billing");
});

test("records a no-op when the signature does not move", async () => {
  const { deps } = fakeDeps({
    candidates: [{ path: "#noop", kind: "control", label: "Does nothing", mutating: false, rank: 6 }],
    sigs: ["A", "A"],
  });
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.equal(out.findings.length, 0, "a no-op must never produce a finding");
  assert.deepEqual(out.noops, ["#noop"]);
});

test("skips mutating candidates unless opted in", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [{ path: "#danger", kind: "control", label: "Delete account", mutating: true, rank: 6 }],
    sigs: ["A", "B"],
  });
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.deepEqual(clicked, [], "a mutating candidate must not be clicked");
  assert.equal(out.states.length, 0);
});

test("runs a mutating candidate when its path is in mutate", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [{ path: "#danger", kind: "control", label: "Delete account", mutating: true, rank: 6 }],
    sigs: ["A", "B"],
  });
  await exploreWidth(deps, { budgetMs: 10000, mutate: ["#danger"], skip: [] });
  assert.deepEqual(clicked, ["#danger"]);
});

test("skip wins over mutate", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [{ path: "#danger", kind: "control", label: "Delete account", mutating: true, rank: 6 }],
    sigs: ["A", "B"],
  });
  await exploreWidth(deps, { budgetMs: 10000, mutate: ["#danger"], skip: ["#danger"] });
  assert.deepEqual(clicked, []);
});

test("stops when the budget is spent", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [
      { path: "#a", kind: "tab", label: "A", mutating: false, rank: 1 },
      { path: "#b", kind: "tab", label: "B", mutating: false, rank: 1 },
    ],
    sigs: ["A", "B", "C"],
  });
  await exploreWidth(deps, { budgetMs: 1, mutate: [], skip: [] });
  assert.deepEqual(clicked, [], "a 1ms budget buys no interactions");
});

/* Hazards beyond the brief's own scripted tests: ways the loop could misbehave once it
   meets a route that is not scripted to cooperate. */

test("zero candidates does not throw", async () => {
  const deps = {
    readActions: async () => ({ sig: "A", candidates: [] }),
    reset: async () => {},
    click: async () => {},
    scan: async () => [],
    now: () => 0,
  };
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.deepEqual(out, { states: [], findings: [], noops: [], failed: [] });
});

/* A candidate's element can vanish between the readActions() that found it and the click()
   that targets it -- a re-navigation race, or the app re-rendering on its own. One bad
   candidate must not take down the whole route: the next candidate is still tried, and the
   next iteration's reset() already restores a clean baseline. */
test("a rejected click does not abort the route; later candidates still run", async () => {
  const sigs = ["A", "B"];
  let i = 0;
  const clicked = [];
  const deps = {
    readActions: async () => ({
      sig: sigs[i],
      candidates: [
        { path: "#vanished", kind: "control", label: "Vanished", mutating: false, rank: 6 },
        { path: "#ok", kind: "control", label: "OK", mutating: false, rank: 6 },
      ],
    }),
    reset: async () => { i = 0; },
    click: async (p) => {
      clicked.push(p);
      if (p === "#vanished") throw new Error("element vanished after re-navigation");
      i = Math.min(i + 1, sigs.length - 1);
    },
    scan: async () => [],
    now: () => 0,
  };
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.deepEqual(clicked, ["#vanished", "#ok"], "the failing candidate must not stop the next one from being tried");
  assert.equal(out.states.length, 1, "the surviving candidate still reaches and scans a new state");
});

/* The deadline is checked at the top of every loop iteration, so a slow interaction can only
   ever be the LAST one that runs -- the loop cannot start a second interaction once the
   first alone has spent the budget. */
test("a slow interaction cannot let a second one start past the deadline", async () => {
  let t = 0;
  let i = 0;
  const sigs = ["A", "B", "C"];
  const clicked = [];
  const deps = {
    readActions: async () => ({
      sig: sigs[i],
      candidates: [
        { path: "#a", kind: "tab", label: "A", mutating: false, rank: 1 },
        { path: "#b", kind: "tab", label: "B", mutating: false, rank: 1 },
      ],
    }),
    reset: async () => { i = 0; },
    click: async (p) => { clicked.push(p); t += 5000; i = Math.min(i + 1, sigs.length - 1); },
    scan: async () => [],
    now: () => t,
  };
  await exploreWidth(deps, { budgetMs: 1000, mutate: [], skip: [] });
  assert.deepEqual(clicked, ["#a"], "the first click alone blows the 1000ms budget, so a second interaction must not start");
});

test("a second candidate reaching an already-seen signature is not scanned twice", async () => {
  const { deps, clicked } = fakeDeps({
    candidates: [
      { path: "#a", kind: "tab", label: "A", mutating: false, rank: 1 },
      { path: "#b", kind: "tab", label: "B", mutating: false, rank: 1 },
    ],
    sigs: ["A", "B"],
    findingsByLabel: { "tab:A": [{ rule: "contrast", sel: "x" }], "tab:B": [{ rule: "contrast", sel: "y" }] },
  });
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.deepEqual(clicked, ["#a", "#b"], "both candidates are attempted");
  assert.equal(out.states.length, 1, "the second candidate lands on a signature the first already recorded");
  assert.equal(out.findings.length, 1, "only the first candidate's scan result is kept");
});

test("a form gets an invalid pass and then a valid pass", async () => {
  const modes = [];
  const deps = {
    readActions: async () => ({
      sig: `S${modes.length}`,
      candidates: [{ path: "#signup", kind: "form", label: "signup", mutating: false, rank: 4 }],
    }),
    reset: async () => {},
    click: async () => { throw new Error("a form must be filled, never clicked"); },
    fillForm: async (p, mode) => { modes.push(mode); },
    scan: async () => [],
    now: (() => { let t = 0; return () => (t += 100); })(),
  };
  await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [], invalidPass: true });
  assert.deepEqual(modes, ["invalid", "valid"], "invalid first, then valid");
});

test("a failed interaction is recorded with its path and error", async () => {
  const deps = {
    readActions: async () => ({
      sig: "A",
      candidates: [{ path: "#gone", kind: "tab", label: "Gone", mutating: false, rank: 1 }],
    }),
    reset: async () => {},
    click: async () => { throw new Error("element not found"); },
    scan: async () => [],
    now: (() => { let t = 0; return () => (t += 100); })(),
  };
  const out = await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [] });
  assert.equal(out.failed.length, 1, "the failure must be recorded, not swallowed");
  assert.equal(out.failed[0].path, "#gone");
  assert.match(out.failed[0].error, /element not found/);
});

test("invalidPass false runs only the valid pass", async () => {
  const modes = [];
  const deps = {
    readActions: async () => ({
      sig: `S${modes.length}`,
      candidates: [{ path: "#signup", kind: "form", label: "signup", mutating: false, rank: 4 }],
    }),
    reset: async () => {},
    click: async () => {},
    fillForm: async (p, mode) => { modes.push(mode); },
    scan: async () => [],
    now: (() => { let t = 0; return () => (t += 100); })(),
  };
  await exploreWidth(deps, { budgetMs: 10000, mutate: [], skip: [], invalidPass: false });
  assert.deepEqual(modes, ["valid"]);
});

/* --- Task 8: declared flows, for depth auto-exploration deliberately does not attempt --- */

test("a flow runs its steps in order and scans only where asked", async () => {
  const acts = [];
  const deps = {
    click: async (p) => acts.push(`click:${p}`),
    fillOne: async (p, v) => acts.push(`fill:${p}=${v}`),
    scan: async (l) => { acts.push(`scan:${l}`); return [{ rule: "contrast", sel: "span.x" }]; },
  };
  const out = await runFlow(deps, [
    { click: "#billing-tab" },
    { fill: { "#seats": "25" } },
    { click: "#review", scan: true },
  ]);
  assert.deepEqual(acts, ["click:#billing-tab", "fill:#seats=25", "click:#review", "scan:flow:3"]);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].state, "flow:3");
});

test("a flow stops at a failed step and records why, rather than scanning a wrong state", async () => {
  /* If step 2 of a wizard never happened, scanning step 3 measures the wrong page and
     reports defects against a state the user never reaches. */
  const deps = {
    click: async (p) => { if (p === "#gone") throw new Error("no such element"); },
    fillOne: async () => {},
    scan: async () => [{ rule: "contrast", sel: "span.x" }],
  };
  const out = await runFlow(deps, [
    { click: "#ok" },
    { click: "#gone", scan: true },
    { click: "#never", scan: true },
  ]);
  assert.equal(out.findings.length, 0, "must not scan after a broken step");
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].path, "#gone");
  assert.match(out.failed[0].error, /no such element/);
});

test("an empty or missing flow is a no-op, not a crash", async () => {
  const deps = { click: async () => {}, fillOne: async () => {}, scan: async () => [] };
  const a = await runFlow(deps, []);
  const b = await runFlow(deps, undefined);
  assert.deepEqual(a, { states: [], findings: [], failed: [] });
  assert.deepEqual(b, { states: [], findings: [], failed: [] });
});
