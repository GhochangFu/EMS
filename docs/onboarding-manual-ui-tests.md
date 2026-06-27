# Manual UI tests — AI onboarding wizard

Run on branch `feature/ai-onboarding-wizard` after `pnpm db:migrate` and setting `OPENAI_API_KEY` + `CREDENTIAL_ENCRYPTION_KEY` in `apps/api/.env`.

## Prerequisites

- Local stack: API, web, optional ingest
- Users: global admin, `organization_admin`, `location_admin`
- Desktop Chrome/Edge; one run at width &lt;1280px

## Checklist

### A — Access

- [ ] Org admin: Organizations → **Onboard with AI** opens full-screen chat
- [ ] Location admin: direct URL returns redirect/403
- [ ] **Back** returns to org locations

### B — Chat flow

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
- [ ] **Commit** or "create it" in chat creates records in admin CRUD
- [ ] MQTT ingest picks up new RTU (if ingest running)

## Sign-off

| Field | Value |
|-------|-------|
| Date | |
| Commit SHA | |
| Ready to merge to main | [ ] |
