-- Purge every stored onboarding chat transcript (ADR 0022 decision 5, `E8.3`).
--
-- Until ADR 0022 the wizard *asked* for credentials in chat — the rule-based
-- turn replied "Share username and password" — and `extractCredentials` parsed
-- them out of the free-text turn. The turn itself was then stored verbatim in
-- `bms.onboarding_sessions.messages` and returned by
-- `GET /admin/onboarding/sessions/:id`. Any row written before that change may
-- therefore contain a plaintext MQTT username and password.
--
-- **Unconditional, not selective.** No attempt is made to detect which rows
-- carry a secret. ADR 0022 decision 2 replaces credential *parsing* with
-- credential *detection*, and that detector is deliberately imprecise in the
-- refusing direction — a heuristic that cannot be trusted to gate new turns
-- cannot be trusted to decide which old rows are safe to keep. Every transcript
-- goes.
--
-- **Session rows are kept.** `bms.audit_log` carries `master.onboarding.commit`
-- entries whose `entity_id` is the session id, and `F4.14` (ADR 0021) made
-- those readable. Deleting sessions to fix a credential leak would destroy
-- audit history that now has a reader — a bad trade, and the reason this
-- migration empties a column rather than removing rows. `draft` is untouched:
-- its secrets live in `_secrets` already encrypted (ADR 0012) and it is
-- redacted on read by `redactDraftForClient`.
--
-- Forward-only and idempotent: re-running sets an already-empty array to the
-- same empty array. There is no down migration — restoring plaintext
-- credentials is not a recovery this repo should be able to perform.
--
-- Cost note: `messages` is `jsonb` on a table with one row per onboarding
-- session, so this rewrites every row of a small table. No index depends on
-- `messages`.

UPDATE bms.onboarding_sessions
   SET messages = '[]'::jsonb
 WHERE messages IS DISTINCT FROM '[]'::jsonb;
