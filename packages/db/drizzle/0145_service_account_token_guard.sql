-- F4.17 / ADR 0125 decisions 10, 13 and 17 - the PR 3 review findings on
-- migration 0144, as a forward-only follow-up (plan
-- docs/plans/f4.17-rate-limits-service-tokens.md section 13). 0144 is
-- committed, so it is not edited: every change lands here.
--
-- 1. users_service_account_check gains the synthetic email: a service row's
--    email is svc-...@service-account.invalid, so it can never take a real
--    person's address and block that person's account (security L2).
-- 2. THE GUARD fires BEFORE INSERT OR UPDATE (migration review M1/M2/L3/L4,
--    security M1/M2). A CHECK cannot read another table or the clock:
--      INSERT  the account is a live kind = 'service' row of the token's
--              organization; created_at is now() whatever the caller wrote,
--              so the 365-day expiry CHECK measures from the real issue time;
--              the revocation and last-used columns start empty; created_by,
--              when set, is a user of that organization or a global admin
--              (the single-column key runs with row security off).
--      UPDATE  revocation is one-way and final: a revoked row's revoked_at
--              and revoked_by never change again; a revoke is stamped now()
--              and its revoked_by is held like created_by; revoked_by is
--              written only with a revoke; a touched last_used_at is now().
-- 3. bms_auth's two policies see LIVE tokens only (not revoked, not expired),
--    so a verifier that forgot either test still finds nothing (security L1),
--    and bms_auth gains SELECT (last_used_at) (migration review L2).
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the
-- SET ROLE bracket. Idempotent: the constraint is dropped and re-added behind
-- a probe of its text, the function is replaced, the trigger and policies are
-- dropped before they are created. No statement-breakpoint markers.

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_service_account_check'
      AND conrelid = 'bms.users'::regclass
      AND pg_get_constraintdef(oid) LIKE '%service-account.invalid%'
  ) THEN
    ALTER TABLE bms.users DROP CONSTRAINT IF EXISTS users_service_account_check;
    ALTER TABLE bms.users
      ADD CONSTRAINT users_service_account_check CHECK (
        kind <> 'service'
        OR (
          password_hash IS NULL
          AND oidc_subject IS NULL
          AND email LIKE 'svc-%@service-account.invalid'
          AND organization_id IS NOT NULL
          AND role IN ('viewer', 'operator')
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bms.service_account_tokens_guard_kind() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM bms.users u
       WHERE u.id = NEW.service_account_id
         AND u.organization_id = NEW.organization_id
         AND u.kind = 'service'
         AND u.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'a service-account token must belong to an active kind = ''service'' user of its organization (ADR 0125 decision 10)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bms.users u
       WHERE u.id = NEW.created_by
         AND (u.organization_id IS NULL OR u.organization_id = NEW.organization_id)
    ) THEN
      RAISE EXCEPTION 'created_by must be a user of the token''s organization or a global admin'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW.created_at := now();
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
    NEW.last_used_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
    RAISE EXCEPTION 'a revoked service-account token stays revoked (ADR 0125 decision 13)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
    IF NEW.revoked_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bms.users u
       WHERE u.id = NEW.revoked_by
         AND (u.organization_id IS NULL OR u.organization_id = NEW.organization_id)
    ) THEN
      RAISE EXCEPTION 'revoked_by must be a user of the token''s organization or a global admin'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_by IS DISTINCT FROM OLD.revoked_by THEN
    RAISE EXCEPTION 'revoked_by is written only with a revoke'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at THEN
    NEW.last_used_at := now();
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS service_account_tokens_guard_kind ON bms.service_account_tokens;
CREATE TRIGGER service_account_tokens_guard_kind
  BEFORE INSERT OR UPDATE ON bms.service_account_tokens
  FOR EACH ROW EXECUTE FUNCTION bms.service_account_tokens_guard_kind();

DROP POLICY IF EXISTS auth_token_lookup ON bms.service_account_tokens;
CREATE POLICY auth_token_lookup ON bms.service_account_tokens
  FOR SELECT TO bms_auth USING (revoked_at IS NULL AND expires_at > now());

DROP POLICY IF EXISTS auth_token_touch ON bms.service_account_tokens;
CREATE POLICY auth_token_touch ON bms.service_account_tokens
  FOR UPDATE TO bms_auth
  USING (revoked_at IS NULL AND expires_at > now())
  WITH CHECK (revoked_at IS NULL AND expires_at > now());

GRANT SELECT (last_used_at) ON bms.service_account_tokens TO bms_auth;

RESET ROLE;

-- The proof, as the migrator's superuser (the 0141 idiom).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'bms.service_account_tokens'::regclass
       AND t.tgname = 'service_account_tokens_guard_kind'
       AND (t.tgtype & 4) <> 0  -- INSERT
       AND (t.tgtype & 16) <> 0 -- UPDATE
  ) THEN
    RAISE EXCEPTION 'migration 0145: the guard trigger does not fire on both INSERT and UPDATE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_service_account_check'
      AND conrelid = 'bms.users'::regclass
      AND pg_get_constraintdef(oid) LIKE '%service-account.invalid%'
  ) THEN
    RAISE EXCEPTION 'migration 0145: users_service_account_check does not hold the synthetic email';
  END IF;

  IF (
    SELECT count(*) FROM pg_policy p
     WHERE p.polrelid = 'bms.service_account_tokens'::regclass
       AND p.polname IN ('auth_token_lookup', 'auth_token_touch')
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%revoked_at IS NULL%'
  ) <> 2 THEN
    RAISE EXCEPTION 'migration 0145: bms_auth''s token policies are not scoped to live tokens';
  END IF;

  IF NOT has_column_privilege('bms_auth', 'bms.service_account_tokens', 'last_used_at', 'SELECT')
     OR has_column_privilege('bms_auth', 'bms.service_account_tokens', 'revoked_at', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0145: bms_auth does not hold SELECT (last_used_at) without UPDATE (revoked_at)';
  END IF;
END $$;
