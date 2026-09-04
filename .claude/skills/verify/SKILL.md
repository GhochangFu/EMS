---
name: verify
description: Run the TRINETRA BMS verification suite from AGENTS.md §7 — package builds, the Vitest suite, test type-checking, and smoke checks — and report pass/fail with evidence. Also carries §4 — how to run §4.6's browser layer against the running stack without spending the session's context on screenshots. Use before committing non-trivial changes, before opening a merge request, whenever asked to confirm the repo is green, whenever a change needs checking in a browser, and at step 1 of `backlog-cycle` mode `done`.
---

# Verify

Run the project's verification commands and report the result honestly. Never
claim "passing" without showing the command output. Run from the repo root
(`D:\Projects\portal.bms`). Use the Bash tool (pnpm/tsx/node are POSIX-friendly).

## 1. Static checks (no running services or DB needed)

Run these first — they are always safe to run:

```bash
pnpm typecheck                      # = pnpm build: shared → db → api → web → ingest
pnpm typecheck:tests                # the tests/ files and vitest configs
node --check apps/sim/src/index.js
pnpm test                           # vitest run — the whole suite
```

**The runner is Vitest (ADR 0014).** `pnpm test` runs everything;
`pnpm test:coverage` adds the thresholds and is **what CI enforces** — run that
one before a merge request rather than `pnpm test`. `pnpm test:onboarding` is a
narrow subset (onboarding, credential-crypto, admin-access, RTU-config) for a
fast loop while working in that area; it is **not** a substitute for the suite,
and reporting it as "tests pass" is a false green.

Prefer `pnpm typecheck` over building the packages one by one: the root script
also builds `ingest`, which a hand-written list has forgotten before.

`pnpm typecheck:tests` names each `tests/` file explicitly instead of globbing,
because `tests/` has no `tsconfig.json`. A new invariant file is type-checked by
nothing until it is added there by hand (AGENTS.md §4.6).

**Integration suites gate on `DATABASE_URL`, asymmetrically.** Unset, they skip
locally but **throw under `CI`**. Set, a failed connection fails everywhere
rather than skipping. Coverage thresholds assume those suites ran, so a local
run with no database is a *partial* result — say so.

## 2. Smoke checks (need the dev stack and/or a seeded DB)

Only run these if the API/DB are up, or start them first. They will fail with
connection errors otherwise — report that as "not run", not as a failure:

```bash
pnpm --filter web smoke:cr          # Control Room extension smoke
pnpm --filter web smoke:realtime    # Redis-backed Socket.IO fan-out
pnpm --filter @bms/db verify:hierarchy   # Org→Location→RTU→Asset hierarchy (needs DB)
```

If the change touches the DB schema/seed, also run a clean migration/seed
(`pnpm db:migrate && pnpm db:seed`) against a scratch database — this is on the
open Location-and-Access hardening checklist in `docs/roadmap.md`.

## 3. Report

- Show the exact commands you ran and their pass/fail status.
- If anything failed, paste the relevant error output and stop — do not
  paper over it.
- State clearly which smoke checks were **skipped** because services weren't
  running. "Skipped" is not "passed".
- Name the narrowing. If you ran `test:onboarding` instead of `test`, or `test`
  instead of `test:coverage`, or had no `DATABASE_URL`, say which suites did not
  run. A subset reported as "the tests" is the false green this skill exists to
  prevent.
- Only report the suite as green when every command you ran actually succeeded.

Scope this to what the change touched when a full run is impractical (e.g. a
web-only change needs `pnpm typecheck` plus the relevant smoke), but say so
explicitly when you narrow it.

## 4. The browser layer of §4.6, and what it costs

A green suite is not a deployment. Step 6 of
[`docs/build-operating-model.md`](../../../docs/build-operating-model.md) —
verification against the running Docker stack — is a separate step. Its database
and API halves are ordinary commands. Its **browser** half is the expensive one,
and this section is how to run it without spending the session on it.

**The measurement, `F3.37`, 2026-08-29.** That row's browser layer consumed
**360.2k of the session's 363.4k message tokens** — 36% of a 1M window for one
row. Every one of those tokens was `mcp__claude-in-chrome__computer`, which
returns a screenshot image on *every* call, roughly 1.5–2.5k tokens each.
Nothing else in the session was within two orders of magnitude. A row that
spends its context on screenshots has none left for the review agents that
follow it, and compaction discards the screenshots while keeping the
conclusions — so most of that spend bought one turn of usefulness.

### 4.1 Ask the cheapest layer that can answer

Before opening a browser at all, ask whether a cheaper gate already proves the
claim. From `F3.37`, a fair sample of an admin-screen row:

| Claim | Cheapest gate that actually holds it | Browser? |
|---|---|---|
| The role `<select>` renders the API's vocabulary, not a hardcoded list | the jsdom component spec (ADR 0042) — its fixture names roles that appear in no seed, so a hardcoded list fails it | **No** |
| The write reaches the DB, refuses an unknown code, and audits | the integration suite, plus `curl` against the running API | **No** |
| Members come back ordered by `assets.code` | the integration suite, whose fixture inserts c, a, b | **No** |
| The tab renders and the route resolves | — | **Yes** |
| A hard reload still shows the written value | — | **Yes** |

Two of five needed pixels. The other three had a gate already, and the browser
run was a slower, weaker copy of it — weaker because it checked an impression of
the screen rather than an exact value.

**The boundary, and it is a hard one.** A cheaper gate may replace a browser
check of **logic**. It may never replace the check of **what is actually
served**. AGENTS.md §4.6 states this in its own words — *"a static check is not
a substitute for reading what is served"* — and pays for it with `F4.20`, which
shipped a green suite, `typecheck`, `typecheck:tests` **and** a static invariant
while the served document was broken three ways, all three found only by
fetching it from the running container. jsdom renders against a stub: it cannot
see a stale bundle, a container that was built but never restarted, or a route
the router does not have. That is why the last two rows of the table stay
browser-only, and why no future row may move a served-artifact check out of that
column on the strength of a unit test.

Name the layers you skipped **and why**, the same way §4.6 requires you to name
the N/A ones. "Not needed — the jsdom spec gates it" is a result. Silence is
indistinguishable from not checking.

### 4.2 The ladder — text tools first, `computer` last

Every tool below returns text. Only `computer` returns an image.

| To do this | Use | Cost |
|---|---|---|
| Read a value, count matching rows, check a class or attribute | `javascript_tool` | ~50–200 tokens |
| See what is on the page | `read_page`, `filter: "interactive"` | text — narrow with `depth` or `ref_id`, it defaults to 50k chars |
| Read the copy | `get_page_text` | text |
| Locate something to click | `find` (natural language) | up to 20 elements with refs |
| Prove a request fired, or its status | `read_network_requests`, `urlPattern` | text |
| Prove nothing threw | `read_console_messages`, `pattern` | text |
| Judge layout, styling, or something you cannot name | `computer` | **1.5–2.5k per call** |

**The recipe. Do not screenshot to find out where to click.**

1. `find` with a natural-language query — it returns the element and its
   position.
2. `computer` `left_click` at that position. One call, one image.
3. **Assert with `javascript_tool`**, never with your reading of the image:

   ```js
   [...document.querySelectorAll('td')]
     .filter((e) => e.textContent === '2 with this role').length
   ```

   This is the stronger check as well as the cheaper one: it is an exact string
   match instead of an impression of one, and it costs about 1% of a screenshot.

Two things that look like savings and are not:

- **`browser_batch` saves round trips, not images.** A batch of four `computer`
  actions still returns four screenshots. Use it to cut turns, and take the
  token saving from the rows above.
- **`read_page` is text but not small.** It defaults to a 50k-character
  accessibility tree. Pass `ref_id` or `depth`, or prefer `find`.

**"Prove nothing threw" is not what an unfiltered console read proves.** A
Chrome extension whose content script matches `<all_urls>` runs on every full
page load in the developer's own profile, and its uncaught errors land in the
same console. On 2026-09-04 a browser pass read **exactly two `[EXCEPTION]`
entries on every admin page load**, each a bare `Object` with no message and no
stack — the container serves a minified bundle with no source maps, so nothing
in the entry named its origin. They were filed as `F4.91` against this
application. They were not ours.

Three cheap probes settled it, and they are the ones to repeat rather than
rediscover:

1. **Load a page with none of our code.** Keycloak's account console at
   `localhost:8080` produced the same entries. That single reading is worth more
   than any amount of staring at our own bundle.
2. **Count the failures.** `read_network_requests` showed 18 API calls, all 2xx,
   on both routes — so "unhandled rejection from a failed fetch", the obvious
   first hypothesis, was refuted by a count rather than by an argument.
3. **Change route without reloading.** The pair never recurred on an in-app
   navigation, which puts it in page bootstrap rather than in anything a React
   route does.

So: scope every console assertion with `pattern`, or state which page you
compared against. An unscoped "the console is clean" is a claim about the
developer's browser profile as much as about this application — and a row filed
on it costs a real investigation, which is what `F4.91` cost.

`resize_window` to a smaller viewport before a screenshot you genuinely need —
the image shrinks and so does its cost.

### 4.3 Send the whole browser run to a subagent

**This is the largest single saving, and it is measured.** The screenshots stay
in the subagent's context; only its report crosses back. A probe on 2026-08-30
spent **48.7k tokens inside the agent and returned about 200** to the parent
session.

Use `browser-verifier` (`.claude/agents/browser-verifier.md`). Give it the URL,
the credentials situation, and the **specific claims** to check — not "look at
the page". It returns a pass/fail table.

The browser MCP tools reached a live tab from a subagent on **2026-08-30** —
`tabs_context_mcp`, `javascript_tool` and `find`, all confirmed. Treat that as a
dated observation, not a guarantee: this repo has a recorded case of the browser
tool failing to reach `localhost` in one session and succeeding in the next, so
the capability is session-specific. The failure is at least loud — no tabs
visible — rather than silent. Re-check only if that happens.

**`ToolSearch` is a dependency, not belt-and-braces.** Those tools are named in
`browser-verifier.md`'s frontmatter and still arrive **deferred**: naming them
grants access, it does not load their schemas. Confirmed by asking the agent
that had just used them. Do not remove `ToolSearch` from that `tools:` list
while tidying.

### 4.4 Three traps that present as a broken feature

All three look like a defect and are not:

- **The dev server is serving the wrong branch.** It recompiles on checkout, so
  a branch switch in the session silently reverts the app underneath a browser
  run, and the feature's route then redirects to `/`. This is not hypothetical:
  the first run of `browser-verifier` (2026-08-30) returned four FAILs against a
  screen whose branch was not checked out, and the agent was right to — the
  route genuinely was not in the source it was served. Run
  `git branch --show-current` before you navigate. If the route is missing from
  `apps/web/src/app.tsx` as well as from the page, suspect the branch, not the
  code.
- **The API's CORS allowlist names `:5173` only** (`apps/api/src/main.ts`). A
  dev server on any other port serves the login page perfectly and has every
  request blocked by the browser. Serve on 5173, or add the origin.
- **A stale Vite process holds the port across sessions.** `F3.37` found one
  from an earlier day still on 5173, pointed at the container API, which runs
  `AUTH_MODE=oidc` and refuses local passwords. Check what owns the port before
  you blame the page or the seed.

And the standing one from `docs/local-setup.md`: `docker compose build` restarts
nothing. Prove the new code is in the container — check the image's Created time
against the commit — before reading anything from it.
