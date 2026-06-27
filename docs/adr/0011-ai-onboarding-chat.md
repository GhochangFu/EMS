# ADR 0011 — AI-first onboarding chat (scoped bot)

## Status

Accepted

## Context

ADR 0009/0010 added hierarchical master-data admin CRUD. Operators onboarding a new
location under an existing organization must create locations, RTUs, assets, point
keys, and mappings in the correct order. A conversational AI bot reduces errors and
speeds ingestion for future protocols beyond MQTT.

AGENTS.md previously deferred general site-wide AI copilot. This ADR scopes AI to
the admin onboarding wizard only.

## Decision

1. Add `openai` npm package to `apps/api` for chat completions with structured JSON
   output when `OPENAI_API_KEY` is set.
2. Expose `/api/v1/admin/onboarding/*` endpoints with JWT auth for session, chat,
   validate, and commit.
3. Full-screen chat is the primary UX; draft preview is a collapsible drawer with
   auto-open on review, validation errors, and ready-to-commit.
4. Strip credentials from LLM context; encrypt secrets server-side before storage.
5. When OpenAI is unavailable, use a deterministic rule-based chat fallback so
   validate/commit and inline edit remain usable.
6. General site copilot (dashboards, alarms, rules) remains deferred.

## Consequences

- New env vars: `OPENAI_API_KEY`, optional `OPENAI_MODEL`.
- Token cost bounded by capped conversation history and draft summaries.
- Requires ADR 0012 for credential storage.
