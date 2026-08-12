import { test } from "node:test";
import assert from "node:assert/strict";
import { evalActions } from "./helpers.mjs";

test("returns a stable state signature", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.equal(typeof r.sig, "string", "sig must be a string");
    assert.ok(r.sig.includes("|"), "sig is count|hash");
  });
});

/* Three tiny fixtures, identical element counts, differing only in text. This is the only
   honest way to test the signature: compare real signatures against each other. Asserting on
   the shape of the hash string proves nothing, because the hash can never contain a pipe. */
test("a changed counter does NOT move the signature", async () => {
  let a, b;
  await evalActions("sig-a.html", 1440, 900, (r) => { a = r.sig; });
  await evalActions("sig-b.html", 1440, 900, (r) => { b = r.sig; });
  assert.equal(a, b, "3 and 987654 must hash the same once digit runs collapse");
});

test("changed prose DOES move the signature", async () => {
  let a, c;
  await evalActions("sig-a.html", 1440, 900, (r) => { a = r.sig; });
  await evalActions("sig-c.html", 1440, 900, (r) => { c = r.sig; });
  assert.notEqual(a, c, "the hash must not be constant");
});

test("prefers a unique id as the path", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    const tab = r.candidates.find((c) => c.label === "Billing");
    assert.equal(tab.path, "#tab-b");
  });
});

test("every candidate path resolves to exactly one element", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.ok(r.candidates.length > 0, "must find candidates");
    for (const c of r.candidates) {
      assert.equal(typeof c.path, "string");
      assert.ok(c.path.length > 0, "no empty path");
    }
  });
});

const byPath = (r, p) => r.candidates.find((c) => c.path === p);

test("classifies a tab as safe and ranks it first", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    const c = byPath(r, "#tab-b");
    assert.equal(c.kind, "tab");
    assert.equal(c.mutating, false);
    assert.equal(c.rank, 1);
  });
});

test("classifies a submit button as mutating", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.equal(byPath(r, "#go").mutating, true);
  });
});

test("classifies a destructive label as mutating even on type=button", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.equal(byPath(r, "#danger").mutating, true, "Delete account must never be safe");
  });
});

test("finds the disclosure, the dialog trigger and the form", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    assert.equal(byPath(r, "#disc").kind, "disclosure");
    assert.equal(byPath(r, "#opendlg").kind, "dialog");
    assert.equal(byPath(r, "#signup").kind, "form");
  });
});

test("candidates are sorted by rank", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    const ranks = r.candidates.map((c) => c.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  });
});

/* The fail-closed rule is the whole safety story, and without this test deleting `||!k`
   leaves the suite green. This element matches no recognised kind and has a deliberately
   benign name, so ONLY the fail-closed default can make it mutating. */
test("an unrecognised control is mutating even with a harmless name", async () => {
  await evalActions("unknown.html", 1440, 900, (r) => {
    const c = r.candidates.find((x) => x.label === "Hello there");
    assert.ok(c, "the element must be discovered at all");
    assert.equal(c.mutating, true, "fail-closed default is missing");
  });
});

/* Each of these was classified SAFE by the first implementation. */
test("classifies adversarial destructive controls as mutating", async () => {
  await evalActions("adversarial.html", 1440, 900, (r) => {
    const m = (p) => r.candidates.find((c) => c.path === p);
    assert.equal(m("#img-submit").mutating, true, "input type=image is a submit button");
    assert.equal(m("#val-delete").mutating, true, "danger word lives in value=, not text");
    assert.equal(m("#danger-form").mutating, true, "form action names a destructive route");
    assert.equal(m("#radix-switch").mutating, true, "data-state alone is not a disclosure");
    assert.equal(m("#long-confirm").mutating, true, "danger word sits past character 40");
    assert.equal(m("#nbsp-signout").mutating, true, "non-breaking space inside the phrase");
  });
});

/* The regression that round 2 existed to fix had no coverage: the suite stayed green with
   form filling completely disabled. Assert the OUTCOME, not just the kind. */
test("an ordinary form stays fillable", async () => {
  await evalActions("interactive.html", 1440, 900, (r) => {
    const f = r.candidates.find((c) => c.path === "#signup");
    assert.equal(f.mutating, false, "a form containing a Create button must still be fillable");
    const em = r.candidates.find((c) => c.path === "#em");
    assert.equal(em.mutating, false, "a typed field is filled with text and cannot mutate");
  });
});

/* A checkbox or select is TOGGLED, not typed, and many apps auto-save a toggle. */
test("a destructive toggle or select is mutating even though it is a field", async () => {
  await evalActions("adversarial.html", 1440, 900, (r) => {
    const m = (p) => r.candidates.find((c) => c.path === p);
    assert.equal(m("#revoke-switch").mutating, true, "checkbox switch named Revoke all API keys");
    assert.equal(m("#delete-select").mutating, true, "select named Delete workspace");
    assert.equal(m("#wrapped-erase").mutating, true, "checkbox named by a wrapping label");
    assert.equal(m("#pw").mutating, false, "Confirm password must stay fillable");
  });
});
