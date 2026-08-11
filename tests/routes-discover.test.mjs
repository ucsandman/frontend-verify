import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRoutes } from "../scripts/routes-discover.mjs";

function scaffold(paths) {
  const root = mkdtempSync(join(tmpdir(), "fv-"));
  for (const p of paths) {
    const full = join(root, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "export default function Page(){return null}");
  }
  return root;
}

test("maps app-router pages to url paths", () => {
  const root = scaffold(["app/page.tsx", "app/pricing/page.tsx", "app/blog/post/page.tsx"]);
  const { routes } = discoverRoutes(root);
  assert.deepEqual(routes.sort(), ["/", "/blog/post", "/pricing"]);
});

test("skips dynamic segments with a reason instead of dropping them", () => {
  const root = scaffold(["app/page.tsx", "app/user/[id]/page.tsx"]);
  const { routes, skipped } = discoverRoutes(root);
  assert.deepEqual(routes, ["/"]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /dynamic/i);
});

test("ignores build and vendor directories", () => {
  const root = scaffold(["app/page.tsx", ".next/app/page.tsx", "node_modules/x/app/page.tsx"]);
  assert.deepEqual(discoverRoutes(root).routes, ["/"]);
});

test("strips route groups from the url", () => {
  const root = scaffold(["app/(marketing)/pricing/page.tsx"]);
  assert.deepEqual(discoverRoutes(root).routes, ["/pricing"]);
});
