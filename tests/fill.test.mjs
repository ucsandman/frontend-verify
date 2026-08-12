import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "fill.js"),
  "utf8",
);
const DQ = String.fromCharCode(34);

test("fill.js obeys the browser-source rules", () => {
  assert.ok(!SRC.includes(DQ), "no double quote: the source is a shell argument");
  assert.ok(
    !SRC.split("\n").some((l) => /(^|[^:])\/\//.test(l.replace(/https?:\/\//g, ""))),
    "block comments only",
  );
});

test("fill.js uses the native value setter, not plain assignment", () => {
  /* Assigning el.value directly is ignored by React, so a filled field would look empty
     to the app and no validation or floating-label state would ever render. */
  assert.ok(SRC.includes("getOwnPropertyDescriptor"), "must use the native setter");
  assert.ok(SRC.includes("bubbles"), "must dispatch a bubbling input event");
});

test("fill.js clicks only checkboxes and radios, never anything submittable", () => {
  /* A click is the only way React sees a checkbox change, but a click on the wrong
     element submits the form. Pin the blast radius. */
  const clicks = SRC.match(/\.click\(/g) || [];
  assert.equal(clicks.length, 1, "exactly one click call may exist");
  const guarded = /if\(!el\.checked\)el\.click\(\);/.test(SRC.replace(/\s+/g, ""));
  assert.ok(guarded, "the click must be guarded and sit in the checkbox/radio branch");
  assert.ok(!/submit|requestSubmit/.test(SRC.replace(/type===.submit./g, "")),
    "no submit call anywhere");
});

test("fill.js has both substitution tokens", () => {
  assert.ok(SRC.includes("__PATH__"), "explore.mjs substitutes the form path");
  assert.ok(SRC.includes("__MODE__"), "explore.mjs substitutes invalid or valid");
});
