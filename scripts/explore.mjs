// Drives candidate interactions from actions.js within a time budget.
// Resetting by re-navigation is the only reliable way back to first paint, which is why
// each interaction costs roughly one page load.

const label = (c) => `${c.kind}:${c.label || c.path}`;

/**
 * Explore one route at one viewport width.
 * @param {{readActions:Function, reset:Function, click:Function, scan:Function, now:Function}} deps
 * @param {{budgetMs:number, mutate:string[], skip:string[]}} opts
 * @returns {Promise<{states:Array, findings:Array, noops:string[]}>}
 */
export async function exploreWidth(deps, opts) {
  const { readActions, reset, click, scan, now } = deps;
  const skip = new Set(opts.skip || []);
  const allow = new Set(opts.mutate || []);
  const deadline = now() + (opts.budgetMs || 0);

  const first = await readActions();
  const seenSigs = new Set([first.sig]);
  const states = [];
  const findings = [];
  const noops = [];

  for (const c of first.candidates) {
    if (now() >= deadline) break;
    if (skip.has(c.path)) continue;
    if (c.mutating && !allow.has(c.path)) continue;

    // A candidate's element can vanish between the readActions() that found it and this
    // click() -- a re-navigation race, or the app re-rendering on its own. A rejected click
    // must not abort exploration of every remaining candidate on the route: skip this one
    // and let the next iteration's reset() restore a clean baseline.
    let after;
    try {
      await reset();
      await click(c.path);
      after = await readActions();
    } catch {
      continue;
    }

    if (after.sig === first.sig) {
      noops.push(c.path);
      continue;
    }
    if (seenSigs.has(after.sig)) continue;
    seenSigs.add(after.sig);

    const l = label(c);
    const found = await scan(l);
    for (const f of found) findings.push({ ...f, state: l });
    states.push({ label: l, kind: c.kind, scanned: found.length, noop: false });
  }

  return { states, findings, noops };
}
