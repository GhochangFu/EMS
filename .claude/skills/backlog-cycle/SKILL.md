---
name: backlog-cycle
description: Run one build cycle against docs/BACKLOG.md — pick the next unblocked feature, verify its dependencies and ADR gate, then start it or close it out by flipping its status. Use when asked what to work on next, when starting a backlog item, or when finishing one and updating its status.
---

# Backlog Cycle

Drive one iteration of the build loop defined in
[`docs/build-operating-model.md`](../../../docs/build-operating-model.md)
against the single managed backlog,
[`docs/BACKLOG.md`](../../../docs/BACKLOG.md).

The human owns two gates: **step 2 (ADR/scope)** and **step 7 (merge
approval)**. Never flip a status or promote scope on your own authority.

## Modes

Infer the mode from the request; ask only if genuinely ambiguous.

- **`next`** — "what should I work on?" → recommend the next unblocked item.
- **`start <ID>`** — begin an item (ADR gate → plan).
- **`done <ID>`** — close an item out (verify → flip status).
- **`status`** — summarise the board (counts by status/wave, what's unblocked).

## Mode: next

1. Read `docs/BACKLOG.md`. Parse the track tables: `ID · Status · Feature · P ·
   Effort · Wave · Depends`. **Status is the second column, not the last** — it
   moved there on 2026-08-14 because closed items carry their whole record in
   *Feature* and Track F's longest row is ~19.6k characters, which put the
   status off the edge of any rendered view. Read it by position from the left,
   never by taking the last cell.
2. Filter to `⬜ pending` items whose **every** `Depends` entry is `✅ done`.
   An item with an unmet dependency is not eligible — say so rather than
   recommending it.
3. Rank: lowest **Wave** first, then **P** (P0 → P3), then ⭐ enablers ahead of
   ordinary items (enablers unblock the most downstream work).
4. Recommend **one** item (plus any genuinely parallel-safe siblings in the same
   wave). For each, state: what it is, why it's next, what it unblocks, whether
   it's ⭐ (build serially, hands-on — never via a cold subagent), and whether
   it needs an ADR.

## Mode: start <ID>

1. **Re-verify eligibility.** Confirm every `Depends` entry is `✅`. If not,
   stop and report the blocker — do not start it anyway.
2. **ADR gate (human decision).** Check `docs/adr/` for a matching ADR. Under
   AGENTS.md §10 a promotion needs one; new npm dependencies are §9.4-gated.
   If missing, the ADR comes first — offer the `new-adr` skill. Do not write
   implementation code before the human approves scope.
   `docs/BACKLOG.md` §5 lists the decision ADRs already known to be owed.
3. Flip the item's Status to `🟡` (ADR/planned) or `🔵` (in progress) once work
   genuinely begins.
4. Follow the operating model: plan → TDD → build. Fan out to subagents **only**
   for independent, well-specified siblings that touch non-overlapping files,
   each in its own worktree; never for ⭐ enablers.

## Mode: done <ID>

1. **Verify before claiming.** Run the `verify` skill (or `pnpm typecheck` plus
   the relevant tests) and show real output. Never flip a status to `✅` on
   assumption — evidence first.
1b. **Then verify against the running Docker stack** — database, API, browser,
   whichever the change touches (AGENTS.md §4.6). A green suite is not a
   deployment. Record the result in the closure row and name the **N/A** layers
   explicitly, so a reader can tell "not applicable" from "not checked".
   - `docker compose build` restarts nothing; `up -d <service>` does. Prove the
     new code is in the container before reading anything from it.
   - Hard-reload the browser and confirm the served bundle hash changed — a
     cached page looks exactly like a failed fix.
   - Check both directions: the defect is gone, *and* the fix does not fire when
     it should not.
2. Run the review agents as applicable: `agents-compliance-reviewer`,
   `security-reviewer`, and `migration-reviewer` for anything under
   `packages/db`.
3. Flip Status to `✅ done` in `docs/BACKLOG.md`.
4. **Cascade check.** Report which items this newly unblocks (any item listing
   this ID in `Depends` whose other deps are now all `✅`) — that is the input
   to the next cycle.
5. Mirror the promotion into `docs/roadmap.md`, and soften the matching
   `AGENTS.md` §6 line in a **separate** `chore(agents):` commit (§9.10) —
   never as a side effect of the feature commit.

## Editing rules for BACKLOG.md

- Edit only the **Status** cell for an existing item, unless explicitly adding
  or removing scope.
- **Adding scope:** append a row with the next free id (`F`/`E` per origin), set
  Wave from its dependencies, note the source.
- **Removing scope:** mark `⛔ dropped` — never delete the row; provenance
  matters.
- Keep §1 "Wave plan at a glance", the §3 Mermaid map, and the tables mutually
  consistent. If a status change contradicts the wave plan, say so rather than
  quietly editing around it.
- If you change the Mermaid diagram, validate it renders:
  `npx --yes @mermaid-js/mermaid-cli -i docs/BACKLOG.md -o <scratch>/b.svg`

## Report

State the mode, the item(s), the evidence (command output for `done`), what
changed in `docs/BACKLOG.md`, and the single recommended next action. Flag any
gate still owed by the human — ADR approval or merge approval.
