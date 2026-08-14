# TRINETRA BMS — Build Operating Model (Team of One + Agents)

**Generated:** 2026-07-20
**Purpose:** The standing playbook for *how* we build the pending features when the
team is **one human (decisions + review) + Claude (execution) + subagents
(bounded parallel work)**. It answers "who does what, in what order, and when do
we fan out."
**Companion docs:**
[BACKLOG.md](./BACKLOG.md) (the *what* and the dependency order — the single
managed backlog) · this doc (the *how*). Earlier split analyses are frozen
under [archive/](./archive/).

> Scope is still ADR-gated. Nothing here overrides AGENTS.md §10 — promoting an
> item into active work requires an ADR first; new deps are §9.4-gated.

---

## 1. The core principle

With one human, we do **not** get calendar parallelism (the six tracks in the
sequencing doc assumed six sets of hands). We get **Claude's** parallelism.
Subagents multiply *execution* — they cannot multiply the two things only the
human provides:

1. **Decisions** — scope, ADRs, dependency choices, interface shape, credential/
   security calls.
2. **Review & merge approval** — the final gate.

**The bottleneck is human decision-and-review bandwidth, not coding hands.**
Every rule below exists to spend that bandwidth sparingly and let agents absorb
the rest. **The dependency graph still governs order — parallelism never skips
an enabler.**

---

## 2. The per-feature loop

Every pending-feature item goes through the same cycle (this is AGENTS.md §10 +
the superpowers skills, made concrete):

| Step | Who | Skill / tool | Human touch? |
|------|-----|--------------|--------------|
| 1. **Pick** next *unblocked* item (enablers first) | Claude | sequencing doc | — |
| 2. **Brainstorm + ADR** — scope, deps, interface | Human + Claude | `superpowers:brainstorming`, `new-adr` | ✅ **gate** |
| 3. **Plan** — written, reviewable | Claude | `superpowers:writing-plans` | 👀 skim |
| 4. **Build via TDD** | Claude (+ subagents) | `superpowers:test-driven-development` | — |
| 5. **Review** — 3 passes in parallel | Subagents | `agents-compliance-reviewer`, `security-reviewer`, code review | 👀 batched |
| 6. **Verify against the running Docker stack** | Claude | `docker compose`, psql, browser | — |
| 7. **Approve & merge** | Human | — | ✅ **gate** |

The human owns **steps 2 and 7** only. Everything else Claude carries.

### Step 6 is not optional, and it is not the test suite again

AGENTS.md §4.6 carries the rule; this is why it is a numbered step rather than a
footnote. Verify the layers the change touches — database, API, browser — and
say in the closure record which were **N/A**, so a reader can tell "not
applicable" from "not checked".

The suite tells you the code is right. It cannot tell you what is *deployed*, or
what an operator sees. Every item that has run this step found something the
suite could not — a container still serving pre-change compiled code (`F4.28`),
a defect that was an API-wide outage rather than a dead dashboard (`F4.34`), a
cast that was really suppressing alarms (`F4.36`), and a page rendering leak and
smoke sensors as `DRY`/`NORMAL` after three hours of silence (`F4.38`).

Two traps, both of which have already cost time here:

- **`docker compose build` restarts nothing.** `up -d <service>` does. Confirm
  the new code is actually in the container before reading anything from it.
- **A cached browser bundle is indistinguishable from a failed fix.** Hard-reload
  and check the served asset hash changed. In `F4.38` the first read after a
  correct rebuild showed pre-fix output.

And check **both directions**: that the defect is gone, and that the fix does not
fire when it should not.

---

## 3. When to fan out to subagents (and when NOT)

### ✅ Fan out — work that is *independent + well-specified + non-overlapping in files*

- **Sibling dependents after an enabler is frozen.** Once `F1.1` (adapter
  framework) exists and its interface is locked, `F1.2` Modbus / `F1.3` BACnet /
  `F1.4` OPC-UA are parallel subagent tasks — same interface, separate files.
  Same after `F2.1`/`F2.3`: calc engine, tag-mapping, instantiation.
- **Read-only exploration** (`Explore` agent) running alongside the main build.
- **The three review agents** at step 5, concurrently.

### ⛔ Do NOT fan out — the serial spine

- **The enablers themselves** (`F1.1`, `F2.1`, `F2.3`, `F3.8`, `F3.21`, `F4.4`).
  They define interfaces everything hangs off; a subagent building one **cold**,
  without the conversation context, is the wrong tool. Build these one at a
  time, hands-on.
- **ADR / scope / security decisions.**
- **Anything two agents would edit the same file for** — they will conflict.

### Cost reality

Subagents start **cold** (re-derive context) and are the **expensive path**.
Only spawn them when the fan-out is *real* (2+ genuinely independent units).
Splitting one tightly-coupled feature across agents costs more and produces
worse seams. **Claude will not spawn subagents unless the work clearly warrants
it or the human asks.**

### Isolation: branches & worktrees (how parallel agents avoid collisions)

The base unit is always **one feature → one branch → merge at step 7** (the
human's approval gate). Worktrees are the mechanism that makes the *parallel*
case safe:

- **Serial spine work** (enablers, or any single feature on the main thread):
  work on **one feature branch** directly. No separate worktree needed — it is
  pure overhead when only one line of work is in flight.
- **Parallel fan-out** (2+ independent siblings, e.g. Modbus / BACnet / OPC-UA
  after `F1.1` freezes): give **each subagent its own git worktree**
  (`isolation: "worktree"`). This is what *guarantees* the "non-overlapping in
  files" rule above — each agent has its own checkout and branch, so they cannot
  stomp on each other. Use `superpowers:using-git-worktrees` for the setup.
- Each isolated agent produces its **own branch/diff**; the review agents (step
  5) run against it; the human merges it back at **step 7** (see
  `superpowers:finishing-a-development-branch`). Worktrees **auto-clean if left
  unchanged**.
- **Do not** put dependent work in parallel worktrees. If B needs A's interface,
  A must merge first — the dependency graph, not the worktree, decides order.

---

## 4. Phase 0 is special: build the safety net first

Before fanning out on *anything*, do the Wave-0 enablers **serially, hands-on**.
Order within Phase 0:

1. **`F4.4` real test runner — FIRST, always.** Once tests + coverage gates
   exist, they are what lets the human **trust subagent output without reading
   every diff.** This single item is the precondition for safe delegation.
   **Scope includes CI wiring:** stand up the runner, migrate the existing `tsx`
   specs onto it, **and add a `test` step to `.github/workflows/ci.yml`** (today
   it runs only `typecheck` + `db:migrate` — the `test:onboarding` suite never
   runs on PRs). A runner that CI does not execute is not a gate. See
   the F4.4 row in `BACKLOG.md`.
2. **`F1.1` adapter framework**, **`F2.1` templates**, **`F2.3` calc DSL**,
   **`F3.8` notifications** — the interfaces the later waves hang off.
3. Quick security wins alongside: **`F4.11`** operator RBAC, **`F4.12`** JWT
   fallback (hours-to-days each).

Only after the test net + the frozen enabler interfaces exist do we start
fanning subagents across the sibling dependents.

---

## 5. Protecting the human bottleneck

- **Batch reviews.** Review a wave's parallel siblings together, not one-by-one.
- **Keep ADRs small.** One decision per ADR; faster to approve.
- **Lean on the gates, not line-by-line reading.** Coverage gates (80% line /
  95% for command·alarm·audit·RBAC) + the compliance/security review agents are
  the trust mechanism that makes delegation safe.
- **Spend attention on the critical path.** `F2.1 → F2.2 → F3.22` (templates →
  onboarding agent) is the business headline and the longest chain — it gets
  hands-on treatment. The security/observability long tail (`F4.16`, `F4.17`,
  `F4.25`…) can be delegated more aggressively behind the gates.

---

## 6. Realistic cadence

**One feature — or one small batch of parallel siblings — per cycle.** Not six
tracks at once. The graph says what's eligible; the test suite lets agents move
fast without the human inspecting every line; human time concentrates on ADRs,
the critical path, and merge approvals.

---

## 7. Starting a cycle — the checklist

```
[ ] 1. Confirm the next item is UNBLOCKED (check sequencing doc §2/§3).
[ ] 2. Brainstorm → open an ADR (new-adr). Human approves scope + deps.
[ ] 3. Claude writes the plan. Human skims.
[ ] 4. TDD build. Fan out to subagents ONLY for independent siblings.
[ ] 5. Run: agents-compliance-reviewer + security-reviewer + code review.
[ ] 6. Human approves. Merge. Mirror into docs/roadmap.md. Next item.
```

**First cycle to run:** `F4.4` test runner (Phase 0, step 1). Start with its ADR.
