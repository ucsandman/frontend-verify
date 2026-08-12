// Drives candidate interactions from actions.js within a time budget.
// Resetting by re-navigation is the only reliable way back to first paint, which is why
// each interaction costs roughly one page load.

const label = (c) => `${c.kind}:${c.label || c.path}`;

/**
 * Explore one route at one viewport width.
 * @param {{readActions:Function, reset:Function, click:Function, fillForm:Function, scan:Function, now:Function}} deps
 * @param {{budgetMs:number, mutate:string[], skip:string[], invalidPass?:boolean}} opts
 * @returns {Promise<{states:Array, findings:Array, noops:string[], failed:Array}>}
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
  const failed = [];

  for (const c of first.candidates) {
    if (now() >= deadline) break;
    if (skip.has(c.path)) continue;
    if (c.mutating && !allow.has(c.path)) continue;

    const modes =
      c.kind === "form" || c.kind === "field"
        ? (opts.invalidPass === false ? ["valid"] : ["invalid", "valid"])
        : [null];

    for (const mode of modes) {
      if (now() >= deadline) break;

      // Task 4's survival guarantee, preserved: a vanished element skips this one
      // interaction, it never aborts the rest of the route.
      let after;
      try {
        await reset();
        if (mode) await deps.fillForm(c.path, mode);
        else await click(c.path);
        after = await readActions();
      } catch (e) {
        // Never swallow silently. A systemically broken reset() would otherwise return an
        // empty result set that is indistinguishable from 'explored, found nothing' --
        // the exact silent-failure shape this project has been bitten by repeatedly.
        failed.push({ path: c.path, error: String((e && e.message) || e) });
        continue;
      }

      if (after.sig === first.sig) { noops.push(c.path); continue; }
      if (seenSigs.has(after.sig)) continue;
      seenSigs.add(after.sig);

      const l = mode ? `${label(c)}:${mode}` : label(c);
      const found = await scan(l);
      for (const f of found) findings.push({ ...f, state: l });
      states.push({ label: l, kind: c.kind, scanned: found.length, noop: false });
    }
  }

  return { states, findings, noops, failed };
}
