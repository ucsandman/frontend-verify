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

test("flags low-contrast text and resolves lab() correctly", async () => {
  await withFixture("defects.html", 1440, 900, (r) => {
    const hits = r.findings.filter((f) => f.rule === "contrast");
    assert.equal(hits.length, 1, "exactly the .muted paragraph");
    // lab(98.26 0 0) is near-WHITE. A naive parser reads 98.26 as dark. Guard that.
    assert.equal(hits[0].fg, "rgb(250,250,250)");
    assert.equal(hits[0].bg, "rgb(255,255,255)");
    assert.ok(hits[0].ratio < 1.2, "near-white on white is about 1:1");
  });
});

test("does not flag readable text (oklch dark on white)", async () => {
  await withFixture("defects.html", 1440, 900, (r) => {
    const sels = r.findings.filter((f) => f.rule === "contrast").map((f) => f.sel);
    assert.ok(!sels.includes("p.ok"), "dark oklch text on white must pass");
  });
});

test("transparent backgrounds resolve to the ancestor, not a stale pixel", async () => {
  // Regression guard: without clearRect, a transparent bg reads back the PREVIOUS
  // measurement and reports fg === bg as a 1.00:1 false positive.
  await withFixture("defects.html", 1440, 900, (r) => {
    for (const f of r.findings.filter((x) => x.rule === "contrast")) {
      assert.notEqual(f.fg, f.bg, `fg and bg identical on ${f.sel} — clearRect is missing`);
    }
  });
});
