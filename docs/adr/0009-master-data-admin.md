# ADR 0009 — Master data administration

## Status

Accepted

## Context

Phase 5 established the hierarchy Organization → Location → RTU → Asset →
`asset_points` (point key mapping) in ADR 0008. Operators need UI and API
support to add, edit, and deactivate catalog rows without direct database
access. Location admins must manage only assigned locations and their child
entities.

## Decision

1. Add `active` flags on `organizations`, `rtus`, and `assets` (migration
   `0017`); reuse existing `active` on `locations` and `asset_points`.
2. Expose REST admin endpoints under `/api/v1/admin/*` with JWT auth.
3. Allow `admin` (global) and `location_admin` (scoped) roles; organization
   **writes** remain `admin` only.
4. Use deactivate/reactivate (no hard delete) with referential integrity
   guards on parent entities.
5. Add web **Administration** sidebar group and Settings top-nav link for
   master-data screens.
6. Audit every mutation in `bms.audit_log` via `MasterDataAuditService`.

## Deactivate rules

| Entity | Rule |
|--------|------|
| Organization | Block if any active locations remain |
| Location | Block if any active RTUs or assets remain |
| RTU | Block if any active assets remain |
| Asset | Deactivate asset and its `asset_points` |
| Asset point | Set `active = false` only |

## Consequences

- Seed/demo data remains intact; inactive rows are hidden from default
  operational views when filters apply.
- Location admins cannot create new top-level locations or organizations.
- Org-level read RBAC for dashboards remains unchanged from ADR 0008.
- Future work: user/access assignment UI, bulk import, URL-persisted filters.
