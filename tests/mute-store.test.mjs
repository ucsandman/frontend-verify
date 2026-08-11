import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, loadMutes, addMute, markNew } from "../scripts/mute-store.mjs";

const f = (o) => ({ rule: "contrast", sel: "p.a", width: 1440, msg: "x", ...o });

test("fingerprint is stable across runs and ignores the message", () => {
  assert.equal(fingerprint(f()), fingerprint(f({ msg: "different wording" })));
});

test("fingerprint separates rule, selector and width", () => {
  assert.notEqual(fingerprint(f()), fingerprint(f({ rule: "tap-target" })));
  assert.notEqual(fingerprint(f()), fingerprint(f({ sel: "p.b" })));
  assert.notEqual(fingerprint(f()), fingerprint(f({ width: 375 })));
});

test("mutes round-trip through disk", () => {
  const file = join(mkdtempSync(join(tmpdir(), "fv-")), "muted.json");
  assert.equal(loadMutes(file).size, 0);
  addMute(file, "abc");
  assert.ok(loadMutes(file).has("abc"));
});

test("markNew flags only unseen findings", () => {
  const prev = new Set([fingerprint(f())]);
  const out = markNew([f(), f({ sel: "p.new" })], prev);
  assert.equal(out[0].isNew, false);
  assert.equal(out[1].isNew, true);
});
