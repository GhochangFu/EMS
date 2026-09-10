// What state one board row is in, and the single list every aggregate reads.
//
// **Extracted from `backlog-dashboard.mjs` by `F3.58` so a suite can reach it,
// and `inProgressIds` is a PARAMETER for the same reason.** The generator is a
// top-level script: importing it reads `backlog-status.json` and writes three
// HTML files, and `inProgressIds` was a module-level `const` derived from git.
// So no test could drive the one input that decides this function's first
// branch, and the defect below shipped with nothing able to catch it. A
// parameter is what a suite can move — the argument `raise-retry.ts` already
// makes for `maxAttempts` and `processStartedAt`.
//
// Generating the board and asserting on the HTML would NOT have gated it
// either: CI's checkout is shallow, so it derives no in-flight set at all, and
// the assertion would pass vacuously on the exact case that broke.

/**
 * One test for a gate's audience (`F4.86`). The WORDING differs by surface —
 * a full-board state chip reads "Awaiting client", the card pill beside it
 * reads "awaiting client" — but the condition behind them must not, and it was
 * written out twice. Flip one and the chip filter selects a different set than
 * the cards show, which is that row's own defect one level down.
 */
export const isClientGate = (it) => it.gate?.kind === "client";

/**
 * The state one row is in: its label, its lamp class and its `stateKey`.
 *
 * **The order of these branches is the whole function.** Each one claims the
 * row, so a branch placed above another silently takes its rows.
 *
 * `inProgressIds` is the set of ids a branch name spells — derived from git by
 * `backlog-status.mjs`, and therefore empty on a shallow checkout.
 */
export const stateOf = (it, inProgressIds) => {
  // `dropped` is excluded here as well as `done`, and `F3.58` is why: it was
  // the first `⛔` row this board ever had, and because a branch spelling its
  // id existed while it was being closed, `inProgressIds` claimed it and the
  // row rendered "In flight" — a deliberately closed decision shown as active
  // work. The `dropped` arm below cannot correct that; it never runs.
  if (inProgressIds.has(it.id) && it.status !== "done" && it.status !== "dropped")
    return { label: "In flight", cls: "lamp-active", key: "flight" };
  if (it.status === "done") return { label: "Done", cls: "lamp-done", key: "done" };
  // Its OWN key and its OWN token, not `waiting`/`--lamp-idle`. This is the
  // same defect `planned` had until 2026-08-23 (see below): a state sharing
  // another's `stateKey` makes every aggregate keyed on it — the legend, the
  // wave lanes, the priority matrix, the track bars, the state chips — count a
  // dropped row as waiting work, and leaves no chip that can filter it.
  if (it.status === "dropped") return { label: "Dropped", cls: "lamp-dropped", key: "dropped" };
  // `it.held`, not `it.gate` (`F4.86`). Reading the gate alone put an item
  // that is gated AND dependency-blocked under the `held` key, so the legend,
  // the wave lanes and the full board's state chips all counted it as held
  // while the stat tile beside them read `counts.gated` and did not.
  if (it.held) return { label: isClientGate(it) ? "Awaiting client" : "Needs ADR", cls: "lamp-gated", key: "held" };
  // `planned` (🟡) gets its OWN key, not `flight`.
  //
  // It shared `flight` until 2026-08-23, which made every aggregate keyed on
  // `stateKey` — the wave lanes, the legend, the state chips — count an
  // ADR-stage row as active work. Wave 0 read "In flight: 2" (F3.8 and E8.1)
  // while `check-backlog-republish.mjs` and the generator's OWN header card
  // and "In flight now" section all read 1, because those three go straight
  // to `inProgress`. `backlog-status.mjs` states the intent this restores —
  // planned "means an ADR is in flight or the item shipped only in part,
  // which is not the same as 'pick this up'".
  if (it.status === "planned") return { label: "Planned", cls: "lamp-planned", key: "planned" };
  if (it.readyToStart) return { label: "Ready", cls: "lamp-ready", key: "ready" };
  return { label: "Waiting", cls: "lamp-idle", key: "waiting" };
};

/**
 * The list driving the legend, the wave lanes, the priority matrix, the track
 * bars, the full board's sort order and the state chips. A `stateOf` key with
 * no entry here is invisible to every one of them; two keys sharing a token
 * render as one indistinguishable band.
 *
 * `dropped` is last so a dropped row sorts to the end of the full board.
 */
export const STATE_KEYS = [
  { key: "done", label: "Done", token: "--lamp-done" },
  { key: "flight", label: "In flight", token: "--lamp-active" },
  { key: "planned", label: "Planned", token: "--lamp-planned" },
  { key: "ready", label: "Ready", token: "--lamp-ready" },
  { key: "held", label: "Held", token: "--lamp-gated" },
  { key: "waiting", label: "Waiting", token: "--lamp-idle" },
  { key: "dropped", label: "Dropped", token: "--lamp-dropped" },
];

/**
 * Tracked rows minus the dropped ones — what "scope" means on this page.
 *
 * `F3.58` made the difference visible: a won't-fix closure is a decision that
 * has been made, not work that remains, so counting it as remaining scope
 * overstates the board by one row and understates completion.
 *
 * **Three totals now coexist, and the boundary is stated here because the first
 * pass moved some of them and not others.** The post-merge review found the
 * page printing a 277-item scope beside a person-week total and eight track
 * bars that still counted the 278th.
 *
 * - **In this meaning** (dropped excluded): the item ring and its label, the
 *   "Total scope" tile, and both person-week aggregates — `pwTotal` and each
 *   track's `pwLeft` — because those measure work, and a dropped row is a
 *   decision rather than work.
 * - **Deliberately outside it** (`counts.total`, 278): the rendered-row counts,
 *   "one square per item" and "The full board — N items", because the dropped
 *   row IS drawn; and each track's `total`, because the track bar draws a
 *   `dropped` segment sized `n / t.total` and the segments have to sum to the
 *   whole. That is why the "Total scope" tile's hint may not say "across N
 *   tracks" — the eight bars and the tile count different populations on
 *   purpose.
 */
export const scopeTotal = (counts) => counts.total - (counts.dropped ?? 0);

/**
 * The rows that are eligible AND not already under way — "ready to start".
 *
 * **One derivation, because this file has now lost the same argument twice.**
 * `counts.ready` is *eligible*: every dependency met and no gate. It says
 * nothing about whether somebody has already begun, so a row that is eligible
 * and in flight is counted by it. The board has always subtracted the in-flight
 * rows before printing "Ready to start"; `check-backlog-republish.mjs` printed
 * `counts.ready` raw, so the hook said **91 ready** against a board showing
 * **90** — differing by exactly the one row that was both.
 *
 * That is the third instance of `F4.86` in this pair of files. The hook's own
 * comment records the second: it reported 16 held against a board showing 15,
 * and the fix was to match the renderer. This is that fix for the next word
 * along, done by sharing the derivation instead of restating it — because
 * restating it is what produced both.
 *
 * `inProgressIds` is the RAW in-progress set, not {@link inFlightRows}' filtered
 * one. It makes no difference today (a dropped row is never eligible, because
 * `readyToStart` requires `pending`), and the raw set is the honest input here:
 * the question is "has anyone begun", not "should the board draw it as active".
 */
export const readyToStartNow = (ready, inProgressIds) =>
  ready.filter((id) => !inProgressIds.has(id));

/**
 * Whether a row counts as work at all.
 *
 * **Added by `F3.58`'s post-merge review**, which found the page printing a
 * 277-item scope beside a person-week total and eight track bars that still
 * counted the 278th. The first pass moved the item ring onto {@link scopeTotal}
 * and left both effort aggregates behind, so "scope" meant two things one line
 * apart — `F4.86` again.
 *
 * A dropped row is a decision that has been made. It is not work remaining, and
 * it is not work that was done either, so it is outside BOTH person-week
 * aggregates rather than being counted as completed. `done` stays inside: the
 * effort was really spent, and `pwDone` is a subset of `pwTotal`.
 */
export const countsAsWork = (it) => it.status !== "dropped";

/**
 * The in-progress rows worth presenting as work under way.
 *
 * **The second half of `F3.58`'s fix, and the half {@link stateOf} cannot
 * reach.** The "In flight" stat tile, the "In flight now" section header and
 * the cards under it all read the in-progress set DIRECTLY rather than
 * `stateKey`, so guarding `stateOf` alone left three surfaces still announcing
 * a dropped row as "Actively being built now.".
 *
 * The set itself is not wrong and is not changed at its source: it answers
 * *which rows have a branch*, and while the branch that closes a row exists,
 * that row does have one. What is wrong is presenting that answer as board
 * state. So this filters at the point of presentation.
 *
 * `lookup` takes an id to its board row, so a suite can supply three rows
 * without building a board.
 */
export const inFlightRows = (inProgress, lookup) =>
  inProgress.filter((p) => lookup(p.id)?.status !== "dropped");
