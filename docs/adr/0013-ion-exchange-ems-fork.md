# ADR 0013 — Fork positioning: TRINETRA for Ion Exchange (India) Ltd.

## Status

Accepted

## Context

The Eskom SMOC engagement produced the current platform (README still titled
"Eskom SMOC BMS"; product brand TRINETRA). A new SOW
(`docs/sow-enterprise-ems-euphoria-infotech.pdf`, Euphoria Infotech ↔
Ion Exchange (India) Ltd.) commissions an Enterprise EMS / "AI Monitoring &
Optimisation Foundry" on this platform; its feature delta is tracked in
`docs/BACKLOG.md` (`E*` ids). `BACKLOG.md` §5 flagged a product-positioning
decision: one multi-client platform vs. a fork.

The human owner decided to fork: this repository (a backup of the Eskom-state
copy exists elsewhere) becomes the Ion Exchange product line.

## Decision

1. This repository is now the **TRINETRA Enterprise EMS for Ion Exchange
   (India) Ltd.** product line. The Eskom SMOC engagement continues, if at all,
   from the external backup copy — not from this repo.
2. **Product brand stays TRINETRA.** Client branding changes from Eskom to
   Ion Exchange (India) Ltd.; "Powered by Euphoria Infotech India Limited"
   stays.
3. **Display layer + docs only.** In scope: user-visible strings in `apps/web`
   and `apps/api` (e.g. chat assistant copy), README, `CLAUDE.md`,
   `docs/roadmap.md` header. Out of scope — explicitly retained under their
   existing names: DB enums and identifiers (`smoc_campus`, `rsmoc`, `csmoc`,
   org code `ESKOM`), schema/table names, seed demo data and logins
   (`*@bms.local`), code symbols, SMOC location-type terminology in UI copy,
   and the read-only UX reference mockups (`ESKOM_SMOC.html`,
   `TRINETRA.html`).
4. Renaming internal identifiers, mockup replacement, or white-label
   multi-branding would each need a future ADR (multi-tenancy re-open is
   already tracked as `E7.1`).

## Consequences

- `docs/BACKLOG.md` §5 "Product positioning" ADR row is resolved by this ADR;
  domain-pack work (`E5.*`) targets Ion Exchange verticals (water first).
- `AGENTS.md` intro/status references to Eskom SMOC must be softened in a
  separate `chore(agents):` commit (§9.10) — not part of this ADR's commit.
- Eskom-specific seed *content* (South African site names, provinces, tariffs)
  remains until Ion Exchange master data arrives via onboarding; it is demo
  data, not branding.
- No new dependencies.
