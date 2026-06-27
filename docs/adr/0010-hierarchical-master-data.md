# ADR 0010 — Hierarchical master data hub and point key catalog

## Status

Accepted

## Context

ADR 0009 added flat master-data admin screens. Operators need a hierarchy-aligned
workflow (organization → location → RTU → asset → point mapping) with scoped
roles and a reusable point key catalog per organization.

## Decision

1. Add migration `0018` with `bms.user_organization_access` and org-scoped
   `bms.point_keys`.
2. Introduce `organization_admin` role with org-scoped master-data writes and
   org-scoped point key catalog management.
3. Keep `location_admin` scoped to assigned locations; org list is read-only and
   derived from assigned locations.
4. Replace flat hub navigation with drill-down URLs plus sidebar shortcuts and
   cascading hierarchy filters on each screen.
5. Validate `asset_points.point_key` against active catalog rows for the asset's
   organization on create/update.
6. Seed demo catalog keys from shared point key constants for ESKOM and PHEWB;
   demo user `phe-admin@bms.local` is an organization admin for PHEWB.

## Drill-down routes

| Level | Route |
|-------|-------|
| Organizations | `/admin/organizations` |
| Locations | `/admin/organizations/:orgId/locations` |
| RTUs | `/admin/locations/:locationId/rtus` |
| Assets | `/admin/locations/:locationId/rtus/:rtuId/assets` |
| Mappings | `/admin/assets/:assetId/points` |
| Point keys | `/admin/point-keys` |

Flat shortcut routes (`/admin/locations`, `/admin/rtus`, etc.) remain with
hierarchy dropdowns that navigate into nested URLs when selections change.

## Consequences

- Global admin manages all organizations and catalogs; organization admin manages
  one assigned org and its catalog; location admin manages mappings only.
- Asset point mappings require catalog entries; free-text point keys are rejected
  by the API.
- Keycloak realm export includes `organization_admin` and `phe-admin@bms.local`.
