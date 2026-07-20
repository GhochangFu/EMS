---
name: new-adr
description: Scaffold the next Architecture Decision Record in docs/adr/ using this repo's ADR format, and remind about the AGENTS.md §10 Promotion Process. Use when a change introduces a new dependency, a schema change, a new module/app, or promotes something out of AGENTS.md §6 (Out of Scope).
---

# New ADR

Create the next numbered ADR in `docs/adr/` following the existing house style,
then surface the promotion follow-ups. ADRs are how this repo gates
dependencies and scope changes (AGENTS.md §9.4, §10).

## Steps

1. **Find the next number.** List `docs/adr/` and take the highest
   `NNNN-*.md` prefix + 1, zero-padded to four digits (existing records run
   `0001`–`0012`).
2. **Pick a slug.** kebab-case, short, describing the decision
   (e.g. `0013-report-pdf-export`).
3. **Write the file** at `docs/adr/<NNNN>-<slug>.md` using this template — match
   the terse style of the existing ADRs (0007–0012 are good models):

   ```markdown
   # ADR <NNNN> — <Title>

   ## Status

   Accepted

   ## Context

   <Why this decision is needed now. Reference prior ADRs it builds on.>

   ## Decision

   1. <Numbered, concrete decisions — schema names, endpoints, env vars, scope limits.>

   ## Dependencies

   <New npm packages, if any, and which app they belong to. Omit if none.>

   ## Consequences

   - <Trade-offs, follow-up work, what stays deferred.>
   ```

   Keep it to what was actually decided. Name concrete artifacts: table names
   (`bms.*`), routes (`/api/v1/...`), env vars, and which `apps/*` or
   `packages/*` are touched.

4. **Promotion follow-ups (AGENTS.md §10).** If this ADR promotes something out
   of §6 (Out of Scope), remind the user to, in the **same** effort:
   - Remove/soften the corresponding item in `AGENTS.md §6` and update its
     status line — but only via a separate `chore(agents):` commit/PR (§9.10).
   - Flip the matching row in `docs/roadmap.md` to active/complete.
   Do **not** edit `AGENTS.md` as a side effect of writing the ADR; call it out
   as a distinct step so it lands in a `chore(agents):` change.

5. **New dependency?** If the ADR adds an npm package, that package.json change
   is what §9.4 gates — the ADR is its justification. Note that the
   dependency-ADR hook will ask for confirmation when the manifest changes.

## Report

Tell the user the path you created, a one-line summary of the decision, and the
promotion follow-ups (if any) still owed in `AGENTS.md` and `docs/roadmap.md`.
