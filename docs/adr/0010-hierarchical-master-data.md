# ADR 0010 — Hierarchical master data hub and point key catalog

## Status

Accepted

> ⚠️ **Amended in part on 2026-09-01 by
> [ADR 0051 Amendment 2](0051-global-template-vocabulary.md#amendment-2--two-clauses-corrected-against-what-shipped-and-the-records-0057-falsified-2026-09-01).**
> `bms.point_keys` is **no longer per-organization**: migration `0057` drops its
> `organization_id`, its policy and its FORCE flag, and adds a foreign key from
> `bms.asset_points.point_key` to `point_keys(code)`. The context paragraph,
> decisions 1, 2, 5 and 6, and the first consequence bullet are affected. The
> original text stands below as the reasoning that was true when it was written.

## Context

ADR 0009 added flat master-data admin screens. Operators need a hierarchy-aligned
workflow (organization → location → RTU → asset → point mapping) with scoped
roles and a reusable point key catalog per organization.
<!-- ⚠️ "per organization" — no longer true; see the Status notice. -->

## Decision

1. Add migration `0018` with `bms.user_organization_access` and org-scoped
   `bms.point_keys`.
   ⚠️ *`bms.point_keys` is fleet-wide since `0057`.*
2. Introduce `organization_admin` role with org-scoped master-data writes and
   org-scoped point key catalog management.
   ⚠️ *Amended twice over. There is no per-organization catalog to manage, and
   `F3.39` narrowed the point-key admin surface to the global `admin` role.
   [ADR 0051 Amendment 1](0051-global-template-vocabulary.md#amendment-1--onboarding-may-extend-the-global-catalog-and-is-refused-when-the-draft-contradicts-it-2026-09-01)
   permits an `organization_admin` to **extend** the shared catalog through
   onboarding, and refuses any draft that contradicts an existing code. The
   org-scoped master-data writes are unaffected.*
3. Keep `location_admin` scoped to assigned locations; org list is read-only and
   derived from assigned locations.
4. Replace flat hub navigation with drill-down URLs plus sidebar shortcuts and
   cascading hierarchy filters on each screen.
5. Validate `asset_points.point_key` against active catalog rows for the asset's
   organization on create/update.
   ⚠️ *The organization clause is gone: `resolveCatalogPointKey` requires a row
   matching `code` with `active = true`, and nothing else. The validation itself
   is now stronger, not weaker — `0057`'s foreign key holds it at the database
   as well as in the service.*
6. Seed demo catalog keys from shared point key constants for ESKOM and PHEWB;
   demo user `phe-admin@bms.local` is an organization admin for PHEWB.
   ⚠️ *One `GLOBAL_CATALOG` replaces the per-org `ESKOM_CATALOG`/`PHE_CATALOG`
   pair in `packages/db/src/point-keys-seed.ts`. The demo user is unchanged.*

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
  ⚠️ *"and its catalog" no longer applies — there is one fleet-wide catalog, and
  only the global admin edits it. See the Status notice.*
- Asset point mappings require catalog entries; free-text point keys are rejected
  by the API.
  ⚠️ *Still true, and now enforced at the database too: `0057` adds
  `asset_points_point_key_point_keys_code_fk`.*
- Keycloak realm export includes `organization_admin` and `phe-admin@bms.local`.
