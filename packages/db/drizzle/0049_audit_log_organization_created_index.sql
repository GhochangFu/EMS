-- E7.1i: make tenant-scoped audit-log reads seekable.
SET ROLE bms_owner;

CREATE INDEX IF NOT EXISTS audit_log_organization_created_idx
  ON bms.audit_log (organization_id, created_at DESC, id DESC);

RESET ROLE;
