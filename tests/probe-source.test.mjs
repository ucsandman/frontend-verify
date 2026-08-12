import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

/* Every one of these is flattened to one line and passed as a single double-quoted shell
   argument. All three failure modes below are SILENT: the CLI still exits 0 and every
   finding is lost, so a broken run is indistinguishable from a clean one. Each rule here
   exists because it already broke this repo at least once. */
const BROWSER_SOURCES = ["probe.js", "actions.js", "fill.js"];

const DQ = String.fromCharCode(34);
const hasDoubleQuote = (s) => s.includes(DQ);
const hasLineComment = (s) =>
  s.split("\n").some((l) => /(^|[^:])\/\//.test(l.replace(/https?:\/\//g, "")));
const hasNonAscii = (s) => /[^\x00-\x7F]/.test(s);
const flattenParses = (s) => {
  try {
    new Function("return " + s.split("\n").join(" ").replace(/\s+/g, " ").trim());
    return true;
  } catch {
    return false;
  }
};

test("the source guards actually detect a violation", () => {
  assert.ok(hasDoubleQuote(`const a=${DQ}x${DQ}`), "detector must catch a double quote");
  assert.ok(hasLineComment("const a=1 // note"), "detector must catch a line comment");
  assert.ok(!hasLineComment("const u='https://x.dev'"), "a url is not a line comment");
  assert.ok(hasNonAscii("const a=' '"), "detector must catch a non-ascii byte");
  assert.ok(!hasNonAscii("const a='x'"), "plain ascii must pass");
  assert.ok(!flattenParses("(()=>{ const a= })()"), "detector must catch a syntax error");
  assert.ok(flattenParses("(()=>{ return 1 })()"), "valid source must parse");
});

for (const name of BROWSER_SOURCES) {
  const SRC = readFileSync(join(DIR, name), "utf8");

  test(`${name} contains no double quote`, () => {
    /* A double quote ends the shell argument early. Anything after it that cmd.exe treats
       as a metacharacter, such as &&, is then run as a separate command. */
    assert.ok(!hasDoubleQuote(SRC), `${name}: single quotes everywhere, comments included`);
  });

  test(`${name} contains no line comment`, () => {
    /* After flattening, a // comment swallows the rest of the file and the whole script
       throws SyntaxError on every route while still exiting 0. */
    assert.ok(!hasLineComment(SRC), `${name}: block comments only`);
  });

  test(`${name} contains no non-ascii byte`, () => {
    /* A raw NBSP pasted into a regex once cost a full debugging round, because it is
       invisible in every editor and the failure is silent. */
    assert.ok(!hasNonAscii(SRC), `${name}: ascii only`);
  });

  test(`${name} still parses after flattening`, () => {
    /* The end-to-end guard. Whatever else is wrong, if the flattened source does not
       parse, every finding on every route is silently lost. */
    assert.ok(flattenParses(SRC), `${name}: flattened source must construct`);
  });
}
