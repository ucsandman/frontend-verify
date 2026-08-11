# frontend-verify

Finds visible frontend defects the way a person would notice them, across viewport widths.
No model calls, no per-repo setup, $0 per run.

It drives a real browser over your routes, measures the rendered page, and returns each
defect with the viewport width it appeared at, a CSS selector, and a cropped screenshot
with the offending element outlined.

Also usable as a Claude Code skill. `SKILL.md` is the full reference.

## Requirements

- Node 20+
- `playwright-cli` on PATH (`npm i -g @playwright/cli`)

## Quick start

Point it at a running dev server or any live URL.

```bash
cat > .frontend-verify.json <<'JSON'
{
  "baseUrl": "http://localhost:3000",
  "rootDir": ".",
  "routes": "auto",
  "widths": [375, 768, 1440],
  "outDir": ".frontend-verify"
}
JSON

node scripts/verify-routes.mjs .frontend-verify.json
node scripts/report-server.mjs .frontend-verify   # then open http://localhost:7788
```

`"routes": "auto"` walks a Next.js app-router tree under `rootDir` and derives the route
list. You can pass an explicit array instead. Dynamic segments are skipped and reported,
never silently dropped. For pages behind a login, add `"stateFile": "auth.json"`.

## What it detects

| Rule | Fires on |
| --- | --- |
| `h-overflow` | the page scrolls sideways |
| `broken-image` | an `img` finished loading with no pixels |
| `clipped-text` | real text cut off, with no ellipsis opted in |
| `tap-target` | a control under 24x24, text links exempt |
| `no-accessible-name` | a control with no name, honours `label[for]` |
| `contrast` | text below its WCAG AA ratio, skips `aria-hidden` |
| `occluded-control` | a control covered by another element (opt-in, unproven) |

Set `"axe": true` to add axe-core's WCAG ruleset. It is off by default because it costs
about 70 seconds per route on Windows.

## Known limits

- Findings are `WARN`, never `FAIL`. Cosmetic defects do not block CI by design.
- `occluded-control` is unproven. Sticky headers and custom dropdowns are its expected
  false-positive source.
- `h-overflow`, `broken-image` and `occluded-control` have never fired on a real production
  page. The other four have, and all four needed fixing after they did.

## Contributing to the probe

`scripts/probe.js` runs inside the browser. Two rules are enforced by
`tests/probe-source.test.mjs` because both failure modes are silent, exiting 0 with every
finding lost:

1. Block comments only. The source is flattened to one line before evaluation, so a `//`
   comment swallows the rest of the file.
2. No double quotes, comments included. The source is passed as one double-quoted shell
   argument, so a quote ends the argument early.

```bash
node --test "tests/*.test.mjs"   # the glob is required on Node 24 Windows
```
