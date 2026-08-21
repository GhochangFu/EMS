# TRINETRA BMS — Build Operating Model (Team of One + Agents)

**Generated:** 2026-07-20 · **Revised:** 2026-08-21 (model routing made
per-step and session-independent; token discipline added as §6)
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

A second budget sits underneath it: **tokens**. Agents are cheap in human time
and not free in spend. So §2 routes every step to the cheapest model that can
carry it, and §6 keeps the volume down — neither of them by moving work back
onto the human.

---

## 2. The per-feature loop

Every pending-feature item goes through the same cycle (this is AGENTS.md §10 +
the superpowers skills, made concrete):

| Step | Who | Model | Skill / tool | Human touch? |
|------|-----|-------|--------------|--------------|
| 1. **Pick** next *unblocked* item (enablers first) | Claude | **Haiku**, delegated | `backlog-cycle`, `BACKLOG.md` | — |
| 2. **Brainstorm + ADR** — scope, deps, interface | Human + Claude | **Opus**, inline | `superpowers:brainstorming`, `new-adr` — **requires `/model opus` first** | ✅ **gate** |
| 3. **Plan** — written, reviewable | Claude | **Opus**, delegated | `plan-architect` agent (Opus-pinned) | 👀 skim |
| 4. **Build via TDD** | Claude (+ subagents) | **Sonnet** | `implementer` agent (Sonnet-pinned), `superpowers:test-driven-development` | — |
| 5. **Review** — parallel passes | Subagents | **Opus** ×3, **Sonnet** ×1 | `code-reviewer`, `security-reviewer`, `agents-compliance-reviewer`, plus `migration-reviewer` for anything under `packages/db` | 👀 batched |
| 6. **Verify against the running Docker stack** | Claude | **Sonnet** for the evidence, session model for the reading | `docker compose`, psql, browser | — |
| 7. **Approve & merge** | Human | — | — | ✅ **gate** |

The human owns **steps 2 and 7** only. Everything else Claude carries.

### Which model runs which step

Scope and plan are the two places where a cheap model costs the most: a bad plan
is executed faithfully, and a bad scope decision survives the ADR that records
it. The build is the opposite — it is the longest and most token-hungry step,
and it is the one an approved plan has already de-risked.

Until 2026-08-21 this doc assumed the operator's session ran Sonnet, so it named
only the two steps that had to *climb* to Opus. The session now runs Opus. Read
that old rule against this session and the entire build lands on the most
expensive model available. The rule is therefore no longer "these two steps are
special". It is:

> **The model is a property of the work unit, not of the session.** Every step
> names its model, and every dispatch carries an explicit `model:`.

| Model | Gets | Why |
|-------|------|-----|
| **Opus** | Step 2 scope/ADR · step 3 plan · step 5 `code-reviewer`, `security-reviewer`, `migration-reviewer` · root-cause debugging that survived one pass | These either decide, or they gate the human's merge. A weak review does not save money — it moves the cost onto the owner's attention. |
| **Sonnet** | Step 4 build and its tests · refactors · step 5 `agents-compliance-reviewer` · doc writing · step 6 evidence gathering | Well-specified work against an approved plan or a written checklist. |
| **Haiku** | Step 1 pick · locating a file · grepping a symbol · reading a config · summarising one file | Mechanical and verifiable; a wrong answer is cheap to spot. |

**Never let a dispatch inherit.** `Explore` and `general-purpose` declare no model
of their own, so an unpinned fan-out runs on whatever the session is set to —
which is now the *expensive* direction, and silently so. Pass `model:` on every
`Agent` call. `subagent_type: "fork"` ignores the override and always runs the
parent model, so never route build work through a fork.

**A skill has no model of its own.** None of the installed `SKILL.md` files
declares one, so an inline skill runs on whatever the session is set to. There
are exactly two mechanisms for putting inline work on a different model, and
each step below names which one it uses:

- **Delegate to a pinned agent.** The agent's own frontmatter decides, whatever
  the session runs. This is the durable mechanism — it survives the next
  `/model` flip and needs nothing from the operator.
- **Ask the operator to flip the session.** No infrastructure, but it spends the
  bandwidth of the human this doc exists to protect. Use it only where
  delegation is impossible, or does not pay (see the next subsection).

Per step:

- **Step 1 (Pick) — Haiku, delegated.** Reading `BACKLOG.md`, confirming the
  `Depends` row and the ADR gate is a bounded lookup that returns a short
  answer.
- **Step 2 (Brainstorm + ADR) — Opus, inline, enforced by refusal.**
  Brainstorming is a dialogue with the human, and the ADR is the gate artifact
  that comes out of that dialogue — a subagent drafting it would invert the
  gate. So Claude states that Opus is required and stops until the operator runs
  `/model opus`. It does not brainstorm or draft an ADR on a cheaper model.
- **Step 3 (Plan) — Opus, delegated.** `plan-architect` is pinned `model: opus`
  in its own frontmatter, is read-only, and returns the plan text for the caller
  to transcribe. It refuses to plan past the step-2 gate.
- **Step 4 (Build) — Sonnet.** Preferred mechanism: hand the unit to the
  `implementer` agent, pinned `model: sonnet`. Fallback, where the unit is too
  small or too entangled to hand off cold: ask the operator for `/model sonnet`
  for the build stretch, and say when to flip back.
- **Step 5 (Review) — split, and it never routes down.** `code-reviewer`,
  `security-reviewer` and `migration-reviewer` stay pinned `model: opus`.
  `agents-compliance-reviewer` is pinned `model: sonnet` because it matches a
  diff against a written checklist. These four are what let the human trust a
  diff they did not read line by line, so cheapening them defeats the delegation
  they exist to enable.
- **Step 6 (Verify) — Sonnet for the evidence, session model for the reading.**
  Collecting container state, `psql` output and page reads is delegable.
  Deciding what that output *means* is not.

### Step 4 is delegated only when the unit pays for the cold start

§3 already says subagents start **cold** and are the expensive path. That does
not stop being true because the sub-model is cheaper. A cold Sonnet agent that
re-derives context the parent already holds can cost more than staying inline,
and it produces worse seams on tightly-coupled work.

Delegate step 4 when **all** of these hold:

- The unit is described by an approved step-3 plan, so the agent does not have
  to re-derive intent.
- It is self-contained in files no other in-flight unit touches.
- It returns a **summary** — files changed, tests added, what failed — not a
  transcript and not file dumps.

Otherwise build inline and flip the session model instead. The serial-spine rule
in §3 is unchanged: ⭐ enablers are still built hands-on, one at a time, whatever
model is running.

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
- **The review agents** at step 5, concurrently. Three always
  (`code-reviewer`, `security-reviewer`, `agents-compliance-reviewer`), and a
  fourth, `migration-reviewer`, whenever the diff touches `packages/db`. They are
  read-only and touch no files, so they never collide.

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

Two consequences of §2's routing rule land here. First, **pass `model:` on every
spawn** — an agent with no pin inherits the session, so an unpinned fan-out on
this session runs Opus by accident. Second, **a cheaper sub-model does not lower
the bar for fanning out.** The cold-start cost is context, not rate; a Sonnet
agent that has to re-read what the parent already holds is still the expensive
path.

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

## 6. Token discipline

§2 decides the *rate*. This section is about the *volume*, which is the larger
lever, because volume multiplies whatever rate you are paying. Nothing here
trades quality away — each item removes work that was redundant.

1. **Query the graph before you read files.** This repository carries a
   `.codegraph/` index. One `codegraph_explore` call returns the verbatim,
   line-numbered source of the relevant symbols, the call paths between them and
   the blast radius, replacing a grep → read → grep-again loop that costs far
   more for a less complete answer. Its output is `Read`-equivalent: do not
   re-open a file it already printed. This applies while *writing* code, not only
   while answering questions about it.
2. **Make subagents return conclusions, not evidence.** A subagent's own
   transcript is not charged to the parent, but its final message is. Ask for the
   verdict and the `file:line` anchors behind it. Never ask an agent to print a
   file back.
3. **Scope the reviewers to the diff.** Give the step-5 agents the base and head
   refs so each runs one `git diff`. "Review the branch" invites four agents to
   read the repository from scratch, in parallel, three of them on Opus.
4. **Fan the review set out in one message.** Four agents dispatched together
   share the wall clock and land in the human's single batched read. Dispatched
   one at a time, each result re-enters the parent context on its own.
5. **Start each cycle clean.** One feature's context has no value to the next
   one, and carrying it forward re-sends it on every remaining turn. Clear
   between items — the ADR, the plan and `BACKLOG.md` are the hand-off, and they
   are on disk.
6. **Do not verify an edit by re-reading it.** An `Edit` that returns success
   wrote the change. This is separate from step 6, which reads the *running
   system*, never the source.
7. **Keep the Opus stretches short and deliberate.** Steps 2 and 3 are dialogue
   and design, and they are worth their rate. The build that follows is not.
   Routing step 4 down saves more than any prompt-level economy, because it
   applies to every turn of the longest step.

---

## 7. Realistic cadence

**One feature — or one small batch of parallel siblings — per cycle.** Not six
tracks at once. The graph says what's eligible; the test suite lets agents move
fast without the human inspecting every line; human time concentrates on ADRs,
the critical path, and merge approvals.

---

## 8. Starting a cycle — the checklist

```
[ ] 1. Confirm the next item is UNBLOCKED (BACKLOG.md Depends + ADR gate). [Haiku, delegated]
[ ] 2. Brainstorm -> open an ADR (new-adr). Human approves scope + deps.   [Opus, inline]
[ ] 3. plan-architect writes the plan. Human skims.                        [Opus, delegated]
[ ] 4. TDD build. Delegate to implementer, or flip to /model sonnet.       [Sonnet]
       Fan out to worktrees ONLY for independent siblings.
[ ] 5. code-reviewer + security-reviewer + agents-compliance-reviewer,
       + migration-reviewer if the diff touches packages/db.
       One message, scoped to the diff.                         [Opus x3, Sonnet x1]
[ ] 6. Verify against the running stack. Record which layers were N/A.
[ ] 7. Human approves. Merge. Mirror into docs/roadmap.md.
       Clear the context, then the next item.
```

**First cycle to run:** `F4.4` test runner (Phase 0, step 1). Start with its ADR.
