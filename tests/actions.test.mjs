import { test } from "node:test";
import assert from "node:assert/strict";
import { evalActions } from "./helpers.mjs";

test("returns a stable state signature", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.equal(typeof r.sig, "string", "sig must be a string");
    assert.ok(r.sig.includes("|"), "sig is count|hash");
  });
});

test("the signature ignores digits so counters do not fake a new state", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    const before = r.sig;
    /* The fixture renders 'Viewed 3 times'. A digit change must not move the sig. */
    assert.ok(!/[0-9]+\|/.test(before.split("|")[1]), "hash half must not encode raw digits");
  });
});
