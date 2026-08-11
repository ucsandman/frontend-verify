import { test } from "node:test";
import assert from "node:assert/strict";
import { withFixture, countOf } from "./helpers.mjs";

test("flags horizontal document overflow", async () => {
  await withFixture("defects.html", 375, 700, (r) => {
    assert.equal(countOf(r, "h-overflow"), 1);
  });
});

test("flags an image that failed to load", async () => {
  await withFixture("defects.html", 375, 700, (r) => {
    assert.equal(countOf(r, "broken-image"), 1);
  });
});

test("flags text cut off by overflow hidden", async () => {
  await withFixture("defects.html", 375, 700, (r) => {
    assert.equal(countOf(r, "clipped-text"), 1);
  });
});

test("returns viewport and scanned count", async () => {
  await withFixture("defects.html", 375, 700, (r) => {
    assert.deepEqual(r.viewport, [375, 700]);
    assert.ok(r.scanned > 0, "scanned must be greater than zero");
  });
});

test("NEVER fires on the clean fixture", async () => {
  await withFixture("clean.html", 1440, 900, (r) => {
    assert.deepEqual(r.findings, [], "clean fixture must produce zero findings");
  });
});
