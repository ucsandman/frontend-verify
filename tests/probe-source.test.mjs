import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "probe.js"),
  "utf8",
);

/* probe.js is flattened to one line and passed as a single double-quoted shell argument.
   Both failure modes below are silent: the CLI still exits 0 and every finding is lost. */

const DQ = String.fromCharCode(34);
const hasDoubleQuote = (s) => s.includes(DQ);
const hasLineComment = (s) =>
  s.split("\n").some((l) => /(^|[^:])\/\//.test(l.replace(/https?:\/\//g, "")));

test("the source guards actually detect a violation", () => {
  assert.ok(hasDoubleQuote(`const a=${DQ}x${DQ}`), "detector must catch a double quote");
  assert.ok(hasLineComment("const a=1 // note"), "detector must catch a line comment");
  assert.ok(!hasLineComment("const u='https://x.dev'"), "a url is not a line comment");
});

test("probe.js contains no double quote", () => {
  /* A double quote ends the shell argument early. Anything after it that cmd.exe treats as
     a metacharacter, such as &&, is then run as a separate command. */
  assert.ok(!hasDoubleQuote(SRC), "use single quotes everywhere, comments included");
});

test("probe.js contains no line comment", () => {
  /* After flattening, a // comment swallows the rest of the file and the whole probe
     throws SyntaxError on every route while still exiting 0. */
  assert.ok(!hasLineComment(SRC), "block comments only");
});
