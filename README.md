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

## Interaction (optional, off by default)

The scanner normally measures only each route's first paint. Turn on exploration and it opens
tabs, disclosures and dialogs, fills forms, and runs the same rules on those states too.

```json
"explore": { "enabled": true, "budgetMs": 60000 }
```

Safety is the default. It only clicks controls it can positively identify as safe (tabs,
disclosures, dialog triggers) and fills typed fields; **forms are never submitted**, and
anything else, including a plain `button[type=button]`, is skipped unless you name its
selector in `mutate`. With `explore` absent, output is byte-identical to before.


## Known limits

- Findings are `WARN`, never `FAIL`. Cosmetic defects do not block CI by design.
- `occluded-control` is unproven. Sticky headers and custom dropdowns are its expected
  false-positive source.
- `h-overflow`, `broken-image` and `occluded-control` have never fired on a real production
  page. The other four have, and all four needed fixing after they did.

## Contributing to the probe

`scripts/probe.js`, `scripts/actions.js` and `scripts/fill.js` all run inside the browser.
Four rules are enforced for each of them by
`tests/probe-source.test.mjs`, because every one of these failure modes is silent: the CLI
still exits 0 and every finding is lost, so a broken run looks exactly like a clean one.

1. Block comments only. The source is flattened to one line before evaluation, so a `//`
   comment swallows the rest of the file.
2. No double quotes, comments included. The source is passed as one double-quoted shell
   argument, so a quote ends the argument early.
3. ASCII only. A raw non-breaking space pasted into a regex is invisible in every editor.
4. The flattened source must still parse. This is the backstop for everything above.

```bash
node --test "tests/*.test.mjs"   # the glob is required on Node 24 Windows
```

## Support

If my tools save you time, you can support my work here:

[![Sponsor on GitHub](https://img.shields.io/badge/GitHub%20Sponsors-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ucsandman)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/wes_sander)
