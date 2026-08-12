import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeInto } from "../scripts/verify-routes.mjs";

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

test("without explore, no finding carries a state key", () => {
  const seen = new Map();
  const out = dedupeInto(seen, [{ rule: "contrast", sel: "span.st" }], 1440);
  assert.equal("state" in out[0], false, "opt-out output must be byte-identical to today");
  assert.equal("alsoIn" in out[0], false);
});
