import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeInto, seedInitial, maybeExplore } from "../scripts/verify-routes.mjs";

test("a defect seen in two states is one finding with alsoIn", () => {
  const seen = new Map();
  const a = dedupeInto(seen, [{ rule: "contrast", sel: "span.st", state: "initial" }], 1440);
  const b = dedupeInto(seen, [{ rule: "contrast", sel: "span.st", state: "tab:Billing" }], 1440);
  assert.equal(a.length, 1, "first sighting is a finding");
  assert.equal(b.length, 0, "second sighting is not a new finding");
  assert.deepEqual(a[0].alsoIn, ["tab:Billing"]);
});

test("the same selector at a different width is a separate finding", () => {
  const seen = new Map();
  dedupeInto(seen, [{ rule: "contrast", sel: "span.st", state: "initial" }], 1440);
  const out = dedupeInto(seen, [{ rule: "contrast", sel: "span.st", state: "initial" }], 375);
  assert.equal(out.length, 1, "width is part of the key");
});

test("a genuinely new element in a state is a new finding", () => {
  const seen = new Map();
  dedupeInto(seen, [{ rule: "contrast", sel: "span.a", state: "initial" }], 1440);
  const out = dedupeInto(seen, [{ rule: "contrast", sel: "span.b", state: "tab:Billing" }], 1440);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, "tab:Billing");
});

// Narrow unit test of dedupeInto's OWN behaviour, renamed to say exactly that: dedupeInto
// never synthesizes a state key on its own, regardless of who calls it or why. This does
// NOT cover the opt-out path through main() -- deleting the "if (ex.enabled)" gate would
// leave this test passing, because dedupeInto was never what added state in the first
// place. The real opt-out guarantee is covered below, by "maybeExplore: disabled ...".
test("dedupeInto itself never invents a state key -- only a caller that sets one can add it", () => {
  const seen = new Map();
  const out = dedupeInto(seen, [{ rule: "contrast", sel: "span.st" }], 1440);
  assert.equal("state" in out[0], false);
  assert.equal("alsoIn" in out[0], false);
});

// The headline guarantee, pinned directly: seedInitial must mutate its inputs IN PLACE, not
// copy them. A spread copy here (`{ ...f, state: "initial" }`) would make the whole feature
// a silent no-op -- alsoIn would land on a throwaway object nobody ever reads, instead of
// the object that actually reaches detail.json / report.json. assert.strictEqual on object
// identity is the only thing a copy cannot fake.
test("seedInitial mutates in place: a later alsoIn append lands on the SAME object", () => {
  const seen = new Map();
  const original = { rule: "contrast", sel: "span.st" };
  const out = seedInitial(seen, [original], 1440);
  assert.strictEqual(out[0], original, "seedInitial must return the identical object, not a copy");
  dedupeInto(seen, [{ rule: "contrast", sel: "span.st", state: "tab:Billing" }], 1440);
  assert.deepEqual(original.alsoIn, ["tab:Billing"], "alsoIn must be visible on the caller's own object");
});

// The real opt-out guarantee, tested against the exact function main() calls -- not a
// parallel copy of its logic. Deleting/inverting maybeExplore's own "if (!ex.enabled)"
// check is exactly the regression this test exists to catch.
test("maybeExplore: disabled/absent config never seeds, never runs, never touches findings", async () => {
  const seen = new Map();
  const f = { rule: "contrast", sel: "span.st", width: 1440 };
  let ran = false;
  const result = await maybeExplore({}, seen, [f], 1440, async () => {
    ran = true;
    return { states: [], findings: [], noops: [], failed: [] };
  });
  assert.equal(ran, false, "run() (the real exploreWidth call) must never be invoked when explore is off");
  assert.equal("state" in f, false, "the raw finding must be untouched -- byte-identical opt-out");
  assert.equal(seen.size, 0, "seen must never be seeded when explore is off");
  assert.deepEqual(result, { states: [], noops: [], failed: [] });
});

// exploreWidth never sets width on the findings it returns (that's IMPORTANT 1 from the fix
// round: without this, report.json findings from interaction had width undefined, breaking
// both the report-server.mjs render and mute-store.mjs's fingerprint). Also pins the
// copy-array bug found and fixed in the same round: passing a filtered array into
// maybeExplore instead of the route's real array silently swallowed every finding
// interaction discovered.
test("maybeExplore: enabled config tags new findings with width and pushes them into the real array", async () => {
  const seen = new Map();
  const findings = [{ rule: "contrast", sel: "span.st", width: 1440 }];
  const result = await maybeExplore({ enabled: true }, seen, findings, 1440, async () => ({
    states: [{ label: "tab:Billing", kind: "tab", scanned: 1, noop: false }],
    findings: [{ rule: "tap-target", sel: "button.new", state: "tab:Billing" }], // no width, as exploreWidth really returns it
    noops: [],
    failed: [],
  }));
  const added = findings.find((x) => x.sel === "button.new");
  assert.ok(added, "the new finding must land in the SAME array passed in, not a filtered copy");
  assert.equal(added.width, 1440, "exploreWidth findings must be tagged with width before they reach the report");
  assert.equal(result.states.length, 1);
});
