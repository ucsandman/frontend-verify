import { test } from "node:test";
import assert from "node:assert/strict";
import { withExplore } from "./helpers.mjs";

const OPTS = { budgetMs: 60000, invalidPass: true, mutate: [], skip: [] };

test("NEVER clicks a destructive control", async () => {
  await withExplore("interactive.html", 1440, 900, OPTS, (r) => {
    assert.notEqual(r.title, "BOOM", "Delete account was clicked");
    assert.notEqual(r.title, "SUBMITTED", "the form was submitted");
  });
});

test("discovers at least four distinct states", async () => {
  await withExplore("interactive.html", 1440, 900, OPTS, (r) => {
    assert.ok(r.states.length >= 4, `only found ${r.states.length}: ${r.states.map((s) => s.label)}`);
  });
});

test("finds the low-contrast text hidden inside the second tab panel", async () => {
  await withExplore("interactive.html", 1440, 900, OPTS, (r) => {
    const hit = r.findings.find((f) => f.rule === "contrast" && f.sel === "span.low");
    assert.ok(hit, "the billing panel defect was never reached");
    assert.ok(hit.state.startsWith("tab:"), `wrong state label: ${hit.state}`);
  });
});

test("finds the broken image behind the disclosure", async () => {
  await withExplore("interactive.html", 1440, 900, OPTS, (r) => {
    assert.ok(r.findings.some((f) => f.rule === "broken-image"), "details content never opened");
  });
});

test("records the do-nothing button as a no-op and not a finding", async () => {
  await withExplore("interactive.html", 1440, 900, OPTS, (r) => {
    assert.ok(r.noops.includes("#noop"), "no-op not recorded");
    assert.ok(!r.findings.some((f) => f.sel === "#noop"), "a no-op must never be a finding");
  });
});

test("a 1ms budget produces no exploration at all", async () => {
  await withExplore("interactive.html", 1440, 900, { ...OPTS, budgetMs: 1 }, (r) => {
    assert.deepEqual(r.states, []);
  });
});
