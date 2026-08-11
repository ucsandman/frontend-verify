import { test } from "node:test";
import assert from "node:assert/strict";
import { withFixture } from "./helpers.mjs";

const rule = (r, name) => r.findings.filter((f) => f.rule === name);

/* Measured on DashClaw: 45 of 45 contrast findings were one token, and a large share of
   them were <span aria-hidden="true">&middot;</span> separators. WCAG 1.4.3 exempts
   incidental/decorative content, so aria-hidden text must never be a contrast finding. */

test("SKIPS aria-hidden text for contrast", async () => {
  await withFixture("exemptions.html", 1440, 900, (r) => {
    const sels = rule(r, "contrast").map((f) => f.sel);
    assert.ok(!sels.includes("#deco"), "a decorative aria-hidden separator is not a defect");
  });
});

test("SKIPS text inside an aria-hidden subtree for contrast", async () => {
  await withFixture("exemptions.html", 1440, 900, (r) => {
    const sels = rule(r, "contrast").map((f) => f.sel);
    assert.ok(!sels.includes("#deco-child"), "aria-hidden must apply to descendants too");
  });
});

test("STILL flags low-contrast text that is not aria-hidden", async () => {
  await withFixture("exemptions.html", 1440, 900, (r) => {
    const sels = rule(r, "contrast").map((f) => f.sel);
    assert.deepEqual(sels, ["#real-low"], "exactly the one real defect");
  });
});

/* Measured on DashClaw: 145 of 145 tap-target findings were <a> elements sized 20-23px,
   i.e. height set by the text line. WCAG 2.2 target-size exempts a target whose size is
   "constrained by the line-height of non-target text". 99 came from one nav link class. */

test("EXEMPTS text links whose height is line-height driven", async () => {
  await withFixture("exemptions.html", 1440, 900, (r) => {
    const sels = rule(r, "tap-target").map((f) => f.sel);
    assert.ok(!sels.includes("#nav1"), "a nav text link is not a tap-target defect");
    assert.ok(!sels.includes("#nav2"));
    assert.ok(!sels.includes("#nav3"));
  });
});

test("STILL flags an icon-only link with no text to constrain it", async () => {
  await withFixture("exemptions.html", 1440, 900, (r) => {
    const sels = rule(r, "tap-target").map((f) => f.sel);
    assert.deepEqual(sels, ["#icon-link"], "exactly the 16x16 icon link");
  });
});
