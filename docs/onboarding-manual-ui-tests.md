# Manual UI tests — AI onboarding wizard

Run on branch `feature/ai-onboarding-wizard` after `pnpm db:migrate` and setting `OPENAI_API_KEY` + `CREDENTIAL_ENCRYPTION_KEY` in `apps/api/.env`.

## Prerequisites

- Local stack: API, web, optional ingest
- Users: global admin, `organization_admin`, `location_admin`
- Desktop Chrome/Edge; one run at width &lt;1280px

## Checklist

### A — Access

- [ ] Org admin: Organizations → **Onboard with AI** opens the copilot dock with the onboarding skill started for that organization (no page change; the old `/admin/organizations/:orgId/onboarding` page is retired, `F3.86` PR 7)
- [ ] Org admin: the dock's **Onboard a site** starts the same skill
- [ ] Location admin: no **Onboard with AI** and no **Onboard a site**
- [ ] Organization with the copilot switch off: the dock says the copilot is off and starts nothing

### B — Chat flow (in the dock's onboarding skill)

- [ ] Bot greets; drawer closed during Q&A
- [ ] Natural-language replies advance phases
- [ ] Quick chips work (protocol, location type)
- [ ] MQTT credentials in chat never echoed in bubbles

### C — Preview drawer

- [ ] Closed during Q&A; auto-opens on review / errors / ready-to-commit
- [ ] Manual **Preview** toggle works
- [ ] Dismiss respected until new trigger

### D — Commit

- [ ] **Validate** shows errors in drawer
- [ ] **Commit** in the draft preview, or **Confirm** on the copilot's commit card, creates records in admin CRUD (typing "confirm commit" commits nothing)
- [ ] MQTT ingest picks up new RTU (if ingest running)

## Sign-off

| Field | Value |
|-------|-------|
| Date | |
| Commit SHA | |
| Ready to merge to main | [ ] |
