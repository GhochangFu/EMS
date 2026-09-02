import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.39` / ADR 0051 decisions 2, 3 and 4 — the point-key vocabulary becomes
 * global, and `bms.asset_points` is constrained against it.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants;
 * `tests/f3.37-asset-role-vocabulary.test.ts` is the direct model, because this
 * row moves a fifth table into the class that one describes.
 *
 * **What is NOT tested here, and why.** The catalog's contents are rows, so a
 * list asserted here would be a copy of the seed — `adr-0034`'s header states
 * that rule. The row counts belong to the §4.6 database check. What remains
 * checkable from the repository is the *shape*, and above all **the statement
 * order inside migration `0057`**, which is the single thing most likely to go
 * wrong and the one thing no other gate can see.
 *
 * **Two orderings, both load-bearing, both measured on the running stack
 * before this file was written:**
 *
 * 1. `bms.point_keys` holds 49 rows over 34 distinct codes — PHEWB's 15 codes
 *    are a strict subset of ESKOM's 34 — so `CREATE UNIQUE INDEX … (code)`
 *    aborts on 15 duplicate pairs unless the duplicates collapse FIRST.
 * 2. 16 `(organization, key)` pairs sit on assets and outside their own
 *    organization's catalog, so `ADD … FOREIGN KEY (point_key)` aborts unless
 *    the orphan insert runs FIRST, in the same migration and never a later one.
 *
 * Those 16 resolve as 15 + 1. Fifteen codes are in no catalog at all. The
 * sixteenth is PHEWB's `frequency_hz`, which ESKOM's catalog already names — a
 * real meter reading that only the per-organization split made an orphan, and
 * which the merge repairs by itself. That one pair is the defect ADR 0051
 * describes, reduced to a single row.
 */
const MIGRATION_REL = "packages/db/drizzle/0057_global_point_key_vocabulary.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
const SEED_REL = "packages/db/src/point-keys-seed.ts";
const CONTRACT_REL = "packages/shared/src/contracts/admin.ts";
const BODY_SCHEMA_REL = "apps/api/src/admin/point-keys/point-keys.schema.ts";
const SERVICE_REL = "apps/api/src/admin/point-keys/point-keys.service.ts";
const CONTROLLER_REL = "apps/api/src/admin/point-keys/point-keys.controller.ts";
const RESOLVER_REL = "apps/api/src/admin/asset-points/resolve-catalog-point-key.ts";
const OWNER_RLS_REL = "apps/api/src/database/bms-owner-rls.integration.spec.ts";
const PAGE_REL = "apps/web/src/pages/admin/point-keys-page.tsx";
const CONSTANTS_REL = "packages/shared/src/constants.ts";
const PILOT_SEED_REL = "packages/db/src/phe-pilot-seed.ts";

/**
 * Comments stripped. `f3.1a` learned this the hard way: `RESET ROLE;` in a
 * header *comment* kept a `toContain` green after the statement itself was
 * deleted. This migration's header quotes most of what is asserted below, and
 * the ordering assertions would be satisfied by prose otherwise.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * The same rule as `sqlOnly`, for TypeScript. Every "this token is gone" scan
 * below reads this rather than the raw file, because this row's own doc
 * comments quote the identifiers it removes — `withTenant`,
 * `canManagePointKey`, `withOrganization`, `organizationId` — to say why they
 * went. Scanning the raw text would fail on the explanation and pass on the
 * silence, which is exactly backwards.
 *
 * Block comments first, then line comments. Safe on these files: none of them
 * carries a string literal or regex containing `//` or `/*`.
 */
const tsOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The index of the first match, or `-1`. Ordering assertions read these. */
const at = (haystack: string, needle: RegExp): number => haystack.search(needle);

const DROP_DUPLICATES = /DELETE\s+FROM\s+bms\.point_keys/i;
const UNIQUE_ON_CODE = /CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+bms\.point_keys\s*\(\s*code\s*\)/i;
const ORPHAN_INSERT = /INSERT\s+INTO\s+bms\.point_keys/i;
const ASSET_POINTS_FK = /ALTER\s+TABLE\s+bms\.asset_points[\s\S]{0,300}?FOREIGN\s+KEY\s*\(\s*point_key\s*\)/i;

describe("F3.39 global point-key vocabulary (ADR 0051 decisions 2-4)", () => {
  const migration = read(MIGRATION_REL);
  const sql = sqlOnly(migration);

  describe("migration 0057 — statement order", () => {
    /**
     * **The first of the two orderings, and the one the row's own first draft
     * missed entirely.** It said "merge to the union, drop `organization_id`,
     * unique index on `code`" and named no dedupe step. On the seeded stack
     * that migration aborts at the index, having already dropped the column it
     * would need to choose a survivor by — a failure that leaves the database
     * in a state no later migration can reason about.
     */
    it("collapses duplicate codes BEFORE the unique index on code", () => {
      const dedupe = at(sql, DROP_DUPLICATES);
      const index = at(sql, UNIQUE_ON_CODE);

      expect(
        dedupe,
        "0057 has no DELETE that collapses duplicate bms.point_keys rows by " +
          "organization. PHEWB's 15 codes are a strict subset of ESKOM's 34, so the " +
          "table holds 49 rows over 34 distinct codes and a unique index on `code` " +
          "aborts on 15 duplicate pairs.",
      ).toBeGreaterThanOrEqual(0);
      expect(index, "0057 never creates a unique index on bms.point_keys (code)").toBeGreaterThanOrEqual(0);
      expect(
        dedupe < index,
        "0057 creates the unique index on `code` BEFORE collapsing the duplicates. " +
          "That aborts the migration on any database seeded before this row. The " +
          "dedupe must run first, and it must run while `organization_id` still " +
          "exists so the survivor is chosen explicitly rather than at random.",
      ).toBe(true);
    });

    /**
     * **The second ordering — (b) before (c), and both in this file.** ADR 0051
     * fact 4's 16 pairs are on the seeded stack today. A foreign key added
     * before the orphans are admitted aborts; one added in a *later* migration
     * leaves a window in which `db:migrate` succeeds and the constraint the row
     * exists to add is silently absent.
     */
    it("admits the orphan codes BEFORE adding the asset_points foreign key", () => {
      const insert = at(sql, ORPHAN_INSERT);
      const fk = at(sql, ASSET_POINTS_FK);

      expect(insert, "0057 never inserts the orphan point keys").toBeGreaterThanOrEqual(0);
      expect(
        fk,
        "0057 never adds the foreign key on bms.asset_points (point_key). That FK is " +
          "ADR 0051 decision 4 and the whole reason the vocabulary becomes a constraint " +
          "rather than a decoration.",
      ).toBeGreaterThanOrEqual(0);
      expect(
        insert < fk,
        "0057 adds the asset_points foreign key BEFORE inserting the orphan codes. " +
          "16 (organization, key) pairs exist on assets outside their own catalog, so " +
          "the ALTER aborts on any database seeded before this row.",
      ).toBe(true);
    });

    /**
     * `unit` is deliberately absent from the orphan insert's column list: the
     * codes arrive from `phe-pilot-seed.ts`'s TeleCash sensor map, which carries
     * no unit, and a guessed unit is a claim rather than a record. `domain` is
     * read off the owning asset in the same SELECT, which is a fact the database
     * already holds — measured before this file was written, no orphan code
     * spans two asset domains, so that read is single-valued.
     */
    it("derives the orphan rows from asset_points rather than listing them", () => {
      const insertBlock = sql.slice(at(sql, ORPHAN_INSERT));
      expect(
        /FROM\s+bms\.asset_points/i.test(insertBlock),
        "0057 spells the orphan codes into a VALUES list. Derive them from " +
          "bms.asset_points joined to bms.assets instead: a hand-copied list is a " +
          "snapshot of one database and silently misses an orphan on any other.",
      ).toBe(true);
    });
  });

  describe("migration 0057 — the table joins the global-vocabulary class", () => {
    it("drops organization_id, its unique index, its policy and FORCE", () => {
      expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+tenant_isolation\s+ON\s+bms\.point_keys/i);
      expect(sql).toMatch(/ALTER\s+TABLE\s+bms\.point_keys\s+NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(sql).toMatch(/ALTER\s+TABLE\s+bms\.point_keys\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(sql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+bms\.point_keys_org_code_unique/i);
      expect(sql).toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS\s+organization_id/i);
    });

    /**
     * **`id` stays the primary key, and `code` takes a unique index instead.**
     * Corrected on 2026-09-01 against this row's own first draft, which said
     * `code` becomes the primary key. A foreign-key target needs only a unique
     * index; meanwhile `GET`/`PATCH /api/v1/admin/point-keys/:id` and
     * `tests/integration-fixture-isolation.test.ts` both key on `id`, so
     * promoting `code` rewrites the routes and buys nothing. `bms.asset_roles`
     * uses `code` as its primary key because it was born that way and has no
     * id-keyed caller; this table has four.
     */
    it("keeps id as the primary key", () => {
      expect(
        /PRIMARY\s+KEY\s*\(\s*code\s*\)/i.test(sql),
        "0057 promotes `code` to the primary key of bms.point_keys. Four callers key " +
          "on `id` — the two :id routes, the fixture cleanup, and the audit entityId. " +
          "The FK target needs only the unique index this migration already creates.",
      ).toBe(false);
      expect(
        /bms\.point_keys\s+DROP\s+CONSTRAINT[^;]*pkey/i.test(sql),
        "0057 drops the bms.point_keys primary key. See above — `id` stays.",
      ).toBe(false);
    });

    /**
     * **The bracket closes BEFORE the orphan insert, and that is the
     * load-bearing line in the file.** `bms.asset_points` carries FORCE ROW
     * LEVEL SECURITY (`0047`) and `bms_owner` is not `BYPASSRLS`, so with no
     * `app.current_organization` set it reads zero rows from that table —
     * measured on the running stack, not reasoned. An orphan insert inside the
     * bracket therefore inserts nothing, reports success, and leaves the
     * foreign key to abort on the rows it was written to admit. Worse, an FK
     * validates existing rows on creation, so one added by a role that can see
     * none passes vacuously.
     *
     * `0051`'s reason for the bracket still holds for what stays inside it:
     * `0041` lines 112-113 grant default privileges only for objects created BY
     * `bms_owner`, and `db:migrate` connects as `bms_app`.
     */
    it("closes the bms_owner bracket before reading bms.asset_points", () => {
      expect(sql).toMatch(/^\s*SET\s+ROLE\s+bms_owner\s*;/i);

      const reset = at(sql, /RESET\s+ROLE\s*;/i);
      expect(reset, "0057 never leaves the bms_owner bracket").toBeGreaterThanOrEqual(0);
      expect(
        at(sql, UNIQUE_ON_CODE) < reset,
        "0057 creates the unique index outside the bms_owner bracket.",
      ).toBe(true);
      expect(
        reset < at(sql, ORPHAN_INSERT),
        "0057 reads bms.asset_points while still inside SET ROLE bms_owner. That role " +
          "is bound by FORCE ROW LEVEL SECURITY and sees zero rows there with no " +
          "app.current_organization set, so the orphan insert would admit nothing and " +
          "the foreign key would then abort. Steps 4 and 5 run on the migration's own " +
          "superuser connection.",
      ).toBe(true);
      expect(
        reset < at(sql, ASSET_POINTS_FK),
        "0057 adds the asset_points foreign key inside the bms_owner bracket. An FK " +
          "validates existing rows on creation, and a role that can see none validates " +
          "nothing — the constraint would pass vacuously.",
      ).toBe(true);
    });

    it("journals migration 0057 so drizzle does not silently skip it", () => {
      expect(
        read(JOURNAL_REL).includes("0057_global_point_key_vocabulary"),
        "migration 0057 has no journal entry. Drizzle skips an unjournalled .sql file " +
          "without a word, so db:migrate would pass with the column still present — " +
          "exactly how 0018/0021/0022 reached main without creating bms.point_keys.",
      ).toBe(true);
    });
  });

  describe("the caller side loses the tenant axis it can no longer honour", () => {
    it("the drizzle schema drops pointKeys.organizationId", () => {
      const schema = tsOnly(read(SCHEMA_REL));
      const start = schema.indexOf('export const pointKeys = bmsSchema.table("point_keys", {');
      expect(start, "pointKeys table definition not found").toBeGreaterThanOrEqual(0);
      const block = schema.slice(start, schema.indexOf("});", start));
      expect(
        /organizationId/.test(block),
        "packages/db schema still declares pointKeys.organizationId after 0057 drops " +
          "the column. Drizzle would emit it in every SELECT and every insert.",
      ).toBe(false);
    });

    /**
     * `withTenant` around a write to an unpoliced global table is not merely
     * redundant — it opens a transaction with a GUC that nothing reads and
     * claims a tenant the row does not have. The four writes move to `fleetDb`,
     * whose audit row is stamped org-less: the executor rule ADR 0043
     * Amendment 5 already states (`this.fleetDb` for a `null` organizationId).
     */
    it("the point-keys service no longer wraps writes in withTenant", () => {
      const service = tsOnly(read(SERVICE_REL));
      expect(
        /withTenant\s*\(/.test(service),
        "point-keys.service.ts still calls withTenant. bms.point_keys carries no " +
          "policy after 0057, so the tenant context is a claim about a row that has " +
          "no organization. Writes run on fleetDb with an org-less audit row.",
      ).toBe(false);
    });

    /**
     * **The write path narrows as the read path widens, and this is the gate
     * on it.** `canManagePointKey` answers "may this caller manage THIS
     * organization's catalog" — a question with no referent once the catalog is
     * fleet-wide. Deleting the check without replacing it would hand every
     * `org_admin` write access to global master data. The replacement is the
     * global `admin` role, exactly as F3.40 rules for `bms.asset_roles`.
     */
    it("gates point-key writes to the global admin role", () => {
      const service = tsOnly(read(SERVICE_REL));
      expect(
        /canManagePointKey/.test(service),
        "point-keys.service.ts still calls canManagePointKey, which gates on an " +
          "organizationId the row no longer has.",
      ).toBe(false);
      expect(
        /isGlobalAdmin/.test(service),
        "point-keys.service.ts drops the per-organization write gate without adding a " +
          "global one. bms.point_keys is fleet-wide master data after 0057, so a " +
          "tenant administrator must not write it — ADR 0046's reasoning for audit " +
          "reads, applied to a write, and the same ruling F3.40 makes for asset_roles.",
      ).toBe(true);
    });

    it("the catalog resolver no longer filters by organization", () => {
      const resolver = tsOnly(read(RESOLVER_REL));
      expect(
        /pointKeys\.organizationId/.test(resolver),
        "resolve-catalog-point-key.ts still filters the catalog by organization. After " +
          "0057 that column does not exist, and the point of the merge is that a code " +
          "means the same thing in every organization.",
      ).toBe(false);
    });

    it("the seed writes one catalog rather than one per organization", () => {
      const seed = tsOnly(read(SEED_REL));
      expect(
        /withOrganization/.test(seed),
        "point-keys-seed.ts still opens a per-organization tenant context. The catalog " +
          "is global after 0057, so the loop collapses to one pass.",
      ).toBe(false);
      expect(
        /ON CONFLICT \(organization_id, code\)/.test(seed),
        "point-keys-seed.ts still arbitrates its upsert on (organization_id, code). " +
          "That index is dropped by 0057; the arbiter is (code).",
      ).toBe(false);
    });

    /**
     * **The cold-start gate, and the only one that catches it.**
     *
     * Migration `0057` admits the orphan codes from `bms.asset_points`. On an
     * EMPTY database that table has no rows, so it admits none — and then
     * `phe-pilot-seed.ts` inserts asset_points for 15 codes no other seed path
     * writes. The first `pnpm db:seed` on a fresh volume fails with
     * `asset_points_point_key_point_keys_code_fk` and `compose up` never
     * completes. Measured on a scratch database, not reasoned about.
     *
     * Nothing else sees this: `pnpm build`, `typecheck:tests` and every suite
     * that runs against the ALREADY-seeded stack are all green, because there
     * the codes exist. This asserts the pilot seed registers its own codes
     * before the rows that reference them, so a new sensor code added to
     * `bmsPointKeyForSensor` cannot reintroduce the failure.
     */
    it("the PHE pilot seed registers its own codes before mapping them", () => {
      const pilot = tsOnly(read(PILOT_SEED_REL));

      const register = at(pilot, /INSERT\s+INTO\s+bms\.point_keys/i);
      const map = at(pilot, /INSERT\s+INTO\s+bms\.asset_points/i);

      expect(
        register,
        "phe-pilot-seed.ts never writes bms.point_keys. Its TeleCash sensor map is the " +
          "only source of 15 codes, and 0057's orphan sweep finds nothing on a cold " +
          "start, so the first db:seed on an empty volume violates the new foreign key.",
      ).toBeGreaterThanOrEqual(0);
      expect(map, "phe-pilot-seed.ts no longer writes bms.asset_points").toBeGreaterThanOrEqual(0);
      expect(
        register < map,
        "phe-pilot-seed.ts maps an asset point before registering its code. The foreign " +
          "key 0057 adds is checked per statement, so the order is the fix.",
      ).toBe(true);

      expect(
        /ON CONFLICT \(code\) DO UPDATE[\s\S]{0,200}?COALESCE/i.test(pilot),
        "phe-pilot-seed.ts overwrites an existing point key's unit instead of filling a " +
          "NULL one. This seed re-runs on every compose up and 0057 admitted these codes " +
          "with a NULL unit, so EXCLUDED.unit would revert an admin's edit at each boot.",
      ).toBe(true);
    });

    it("point_keys leaves the FORCE-RLS list the owner suite scans", () => {
      const ownerRls = tsOnly(read(OWNER_RLS_REL));
      expect(
        /^\s*"point_keys",\s*$/m.test(ownerRls),
        "bms-owner-rls.integration.spec.ts still lists point_keys among the tables " +
          "that carry FORCE ROW LEVEL SECURITY. 0057 removes both the FORCE flag and " +
          "the policy, so that assertion now tests the opposite of the truth.",
      ).toBe(false);
    });
  });

  /**
   * **The contract moves with the column, and cannot wait for a later row.**
   * A response schema that still declares `organizationId` describes a field
   * the table does not have — `z.infer` would keep every caller compiling while
   * the runtime parse fails on the first request (ADR 0030).
   */
  describe("the contract loses the organization axis with the column", () => {
    it("adminPointKeyDtoSchema drops the three organization fields", () => {
      const contract = tsOnly(read(CONTRACT_REL));
      const start = contract.indexOf("export const adminPointKeyDtoSchema = z.object({");
      expect(start, "adminPointKeyDtoSchema not found").toBeGreaterThanOrEqual(0);
      const block = contract.slice(start, contract.indexOf("});", start));

      for (const field of ["organizationId", "organizationCode", "organizationName"]) {
        expect(
          block.includes(field),
          `adminPointKeyDtoSchema still declares ${field}. bms.point_keys has no ` +
            "organization after 0057, so the DTO would claim a field no row carries.",
        ).toBe(false);
      }
    });

    it("createPointKeyBodySchema drops organizationId", () => {
      const body = tsOnly(read(BODY_SCHEMA_REL));
      expect(
        /organizationId/.test(body),
        "createPointKeyBodySchema still requires organizationId. The body is `.strict()` " +
          "(ADR 0029), so a client that keeps sending it gets a 400 — but a body that " +
          "still ACCEPTS it invites the caller to believe the catalog is per-tenant.",
      ).toBe(false);
    });

    it("the list route drops its organizationId query parameter", () => {
      const controller = tsOnly(read(CONTROLLER_REL));
      expect(
        /Query\("organizationId"\)/.test(controller),
        "the point-keys list route still takes an organizationId query parameter. " +
          "There is nothing left to filter on.",
      ).toBe(false);
    });

    it("the admin page drops its organization column, filter and picker", () => {
      const page = tsOnly(read(PAGE_REL));
      expect(
        /organizationCode|organizationId/.test(page),
        "point-keys-page.tsx still renders or sends an organization for a point key. " +
          "The catalog is one list for the whole fleet after 0057.",
      ).toBe(false);
    });
  });

  /**
   * **The one guard that is about the future rather than this migration.**
   * Today the two seeded catalogs are built by one helper from one set of
   * constant arrays, so a shared code cannot disagree on `domain` or `unit` —
   * measured on the stack, zero codes disagree on unit, domain or name across
   * the two organizations. That is what makes the merge non-lossy.
   *
   * Once the seed is a single pass with `ON CONFLICT (code) DO UPDATE`, a
   * future disagreement stops being an error and becomes silent last-writer-
   * wins: whichever array is listed later quietly redefines the code. This
   * asserts the arrays stay disjoint so that never has a chance to happen.
   */
  describe("the merged catalog is single-valued (anti-drift)", () => {
    /**
     * Parsed rather than imported: the top-level `tests/` project has no
     * workspace dependency on `@bms/shared`, which is why
     * `f3.38-stock-catalog-vocabulary.test.ts` reads the same file as text.
     */
    const arraysByName = new Map<string, string[]>();
    for (const block of read(CONSTANTS_REL).matchAll(
      /export const ([A-Z_]*POINT_KEYS) = \[([^\]]*)\]/g,
    )) {
      arraysByName.set(
        block[1]!,
        [...block[2]!.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!),
      );
    }

    /**
     * Array → the domain `point-keys-seed.ts` files it under.
     *
     * **An array missing from this table escapes every check below, silently.**
     * Both the pin and the clash test iterate `Object.entries(ARRAY_DOMAIN)`,
     * never `arraysByName`, so a seventh array added to `constants.ts` and not
     * added here is neither pinned to its `keysForDomain` call nor compared
     * against the other six for a domain clash. `F3.41` added
     * `METERED_PUMPING_POINT_KEYS` and this entry in the same commit for that
     * reason — the entry is what makes the array's `keysForDomain` call
     * mandatory rather than optional, which is how the array reaches
     * `GLOBAL_CATALOG` at all.
     */
    const ARRAY_DOMAIN: Record<string, string> = {
      ELECTRICAL_POINT_KEYS: "electrical",
      HVAC_POINT_KEYS: "hvac",
      CONTROL_ROOM_UPS_POINT_KEYS: "electrical",
      CONTROL_ROOM_IT_POINT_KEYS: "it",
      CONTROL_ROOM_ENVIRONMENT_POINT_KEYS: "environment",
      CONTROL_ROOM_ELECTRICAL_POINT_KEYS: "electrical",
      METERED_PUMPING_POINT_KEYS: "electrical",
      ELECTRICAL_CLASS_POINT_KEYS: "electrical",
    };

    /**
     * The table above is a copy, so it is pinned to its source rather than
     * trusted. If the seed re-files an array under a different domain, the
     * clash test below would keep passing against a stale mapping.
     */
    it("the array-to-domain mapping still matches the seed", () => {
      const seed = tsOnly(read(SEED_REL));
      for (const [arrayName, domain] of Object.entries(ARRAY_DOMAIN)) {
        expect(
          // Anchored on the `keysForDomain(` call, and only on the array that
          // OPENS it. Two reasons, and the bare name satisfies neither.
          //
          // `ELECTRICAL_POINT_KEYS` is a substring of
          // `CONTROL_ROOM_ELECTRICAL_POINT_KEYS`, so an unanchored search finds
          // the wrong array first. The lookbehind alone fixes that and is still
          // not enough: the seed names `ELECTRICAL_POINT_KEYS` a SECOND time
          // inside the `.filter()` that subtracts it from the control-room
          // array, and `"electrical"` follows that occurrence within 240
          // characters. Re-file the real call under another domain and this pin
          // would keep passing on the filter's mention, which is the one thing
          // it exists to prevent.
          //
          // `\\s*` and not a literal space: the control-room entry wraps its
          // array onto the next line, so the anchor has to cross a newline.
          new RegExp(
            `keysForDomain\\(\\s*(?<![A-Z_])${arrayName}[\\s\\S]{0,240}?"${domain}"`,
          ).test(seed),
          `${SEED_REL} no longer files ${arrayName} under the "${domain}" domain. ` +
            "Update ARRAY_DOMAIN in this file with it, or the clash check below runs " +
            "against a mapping the seed abandoned.",
        ).toBe(true);
      }
    });

    it("no point key code is claimed by two different domains", () => {
      const domainByCode = new Map<string, string>();
      const clashes: string[] = [];
      for (const [arrayName, domain] of Object.entries(ARRAY_DOMAIN)) {
        for (const code of arraysByName.get(arrayName) ?? []) {
          const seen = domainByCode.get(code);
          if (seen !== undefined && seen !== domain) {
            clashes.push(`${code}: ${seen} vs ${domain} (${arrayName})`);
          }
          domainByCode.set(code, domain);
        }
      }
      expect(
        clashes,
        "two shared point-key constant arrays give one code two domains. The seed is " +
          "one pass with ON CONFLICT (code) DO UPDATE after F3.39, so whichever array " +
          "is listed later silently wins and the code's domain flips with no error " +
          "anywhere. Before F3.39 the two catalogs were written separately and a " +
          "disagreement was at worst per-organization; now it is fleet-wide.",
      ).toEqual([]);
    });

    /**
     * **A code with no `UNIT_BY_KEY` entry is seeded with a NULL unit, and the
     * seed that writes it runs LAST.**
     *
     * `keysForDomain` writes `UNIT_BY_KEY[code] ?? null`, and
     * `seedPointKeyCatalog`'s upsert is a plain
     * `ON CONFLICT (code) DO UPDATE SET … unit = EXCLUDED.unit`. Its sibling in
     * `phe-pilot-seed.ts` is deliberately
     * `unit = COALESCE(bms.point_keys.unit, EXCLUDED.unit)` — an admin's fill
     * must survive a re-seed — but `seedPointKeyCatalog` runs **after** it in
     * `seed.ts`, so the plain assignment wins. A code that reaches
     * `GLOBAL_CATALOG` without a unit therefore overwrites a real, correct unit
     * with NULL on **every `compose up`**, and nothing reports it.
     *
     * `F3.41` is why this exists: it added twelve codes that carry real units
     * (`kWh`, `kVA`, `A`, `V`) and two that are genuinely unitless. The check
     * passed for all 34 codes before that commit, so it lands green and can
     * only ever fail on the mistake it names.
     *
     * Parsed rather than imported, for the same reason `arraysByName` is: the
     * top-level `tests/` project has no workspace dependency on `@bms/db`.
     */
    it("every catalogued point key has a UNIT_BY_KEY entry", () => {
      const seed = tsOnly(read(SEED_REL));
      const table = /const UNIT_BY_KEY: Record<string, string> = \{([\s\S]*?)\n\};/.exec(seed);
      expect(table, `no UNIT_BY_KEY table parsed out of ${SEED_REL}`).not.toBeNull();
      const units = new Set(
        [...table![1]!.matchAll(/^\s*([a-z0-9_]+):/gm)].map((m) => m[1]!),
      );
      // Anti-vacuity for this case alone, at the actual rather than at the
      // pre-`F2.11` count of 46 — this file argues at length for moving a bound
      // to its actual, and leaving one slack in the same commit would be the
      // inconsistency a later reader copies. 191 = 185 + `F2.12`'s six
      // promoted derived codes (ADR 0051 Amendment 6 decision 8, plan §12
      // ruling 2).
      expect(units.size, `UNIT_BY_KEY parsed as almost nothing`).toBeGreaterThanOrEqual(191);

      const missing: string[] = [];
      for (const arrayName of Object.keys(ARRAY_DOMAIN)) {
        for (const code of arraysByName.get(arrayName) ?? []) {
          if (!units.has(code)) {
            missing.push(`${code} (${arrayName})`);
          }
        }
      }
      expect(
        [...new Set(missing)].sort(),
        `${SEED_REL} catalogues a point key with no UNIT_BY_KEY entry, so keysForDomain ` +
          "seeds it with a NULL unit. seedPointKeyCatalog runs last in seed.ts and its " +
          "upsert assigns `unit = EXCLUDED.unit` outright, so on every `compose up` this " +
          "reverts whatever unit phe-pilot-seed.ts or an administrator put there. Give " +
          'the code its unit — or the empty string, the way `pf` and `breaker_main` ' +
          "already spell an unset one.",
      ).toEqual([]);
    });

    /**
     * **Neither seed that writes `bms.point_keys` may overwrite a unit.**
     *
     * `bms.point_keys` is fleet-wide and unpoliced since `0057`, and ADR 0051
     * Amendment 1 names a global administrator's correction as the remedy for a
     * code the platform mislabels — `PATCH /api/v1/admin/point-keys/:id` carries
     * `unit`. Both seeds re-run on every `compose up`, so an outright
     * `unit = EXCLUDED.unit` silently undoes that correction at the next boot.
     *
     * `phe-pilot-seed.ts` had always got this right and `point-keys-seed.ts` had
     * always got it wrong; the disagreement was invisible because the codes
     * barely overlapped. `F3.41` made twelve of them overlap, and
     * `seedPointKeyCatalog` runs LAST, so the wrong one would have won. Found by
     * the `security-reviewer` sweep, and pinned here because nothing else can
     * see it: both statements are strings, both are valid SQL, and the failure
     * is a value quietly reverting between boots.
     */
    it("no point-key seed overwrites a unit an administrator may have set", () => {
      let statementsSeen = 0;
      for (const rel of [SEED_REL, PILOT_SEED_REL]) {
        const source = tsOnly(read(rel));
        // **Scoped to the `bms.point_keys` upsert, not the whole file.**
        // `phe-pilot-seed.ts` also upserts `bms.asset_points`, and `unit =
        // EXCLUDED.unit` is CORRECT there — that column is the seed's own
        // mapping, derived from the vendor catalog, and nothing else writes it.
        // A file-wide scan would fail on that line and teach the next reader to
        // weaken this check.
        // **Escaped backticks are removed BEFORE the block is sliced, and that
        // is not tidying.** `phe-pilot-seed.ts` carries an SQL comment on the
        // line immediately after its INSERT that quotes `` \`$1\` ``, so
        // slicing at the first backtick ended the block after 76 characters —
        // before `ON CONFLICT`. The check found the statement, reported two
        // statements seen, and inspected nothing in that file: change it to
        // `unit = EXCLUDED.unit` and this stayed green. Caught by the
        // `migration-reviewer` sweep on the commit that introduced it, which is
        // why the reaching-ON-CONFLICT assertion below now exists as well.
        const unescaped = source.replace(/\\`/g, "'");
        for (const start of [...unescaped.matchAll(/INSERT INTO bms\.point_keys\b/g)]) {
          statementsSeen += 1;
          // To the end of the enclosing template literal — every one of these
          // statements is written as a backtick string.
          const rest = unescaped.slice(start.index!);
          const end = rest.indexOf("`");
          const block = rest.slice(0, end >= 0 ? end : rest.length);
          // The second anti-vacuity control, and the one that would have caught
          // the escaped-backtick bug: a block that does not reach its own
          // `ON CONFLICT` cannot contain the assignment being checked, so a
          // pass would mean nothing.
          expect(
            block.includes("ON CONFLICT"),
            `${rel}: the sliced bms.point_keys statement stops before its ON CONFLICT ` +
              `clause (${block.length} chars), so the check below inspects nothing. Fix ` +
              "the slice, do not delete this assertion.",
          ).toBe(true);
          const overwriting = [...block.matchAll(/\bunit\s*=\s*([^,\n]+)/g)]
            .map((m) => m[1]!.trim())
            .filter((rhs) => rhs.startsWith("EXCLUDED.unit"));
          expect(
            overwriting,
            `${rel} assigns unit = EXCLUDED.unit outright on bms.point_keys. Both seeds ` +
              "re-run on every `compose up`, and that table is fleet-wide and unpoliced " +
              "since 0057, so this reverts a global administrator's PATCH at the next " +
              "boot — the correction ADR 0051 Amendment 1 names as the remedy for a " +
              "mislabelled code. Use COALESCE(bms.point_keys.unit, EXCLUDED.unit), as " +
              "both seeds now do.",
          ).toEqual([]);
        }
      }
      // Anti-vacuity: two upserts exist today, one per seed. A rename that made
      // the scan find none would otherwise pass for free.
      expect(
        statementsSeen,
        `no INSERT INTO bms.point_keys found in ${SEED_REL} or ${PILOT_SEED_REL} — the scan is blind`,
      ).toBeGreaterThanOrEqual(2);
    });

    /**
     * Anti-vacuity. Every assertion above is a `false`/`[]` expectation on a
     * scan, and a scan that finds nothing passes for free. If the constants are
     * renamed away or the migration is emptied, this is what fails.
     */
    it("the scanned sources are non-empty", () => {
      expect(
        arraysByName.size,
        `no *_POINT_KEYS array parsed out of ${CONSTANTS_REL}`,
      ).toBeGreaterThanOrEqual(8);
      const codes = new Set([...arraysByName.values()].flat());
      // 191 is the actual after `F2.12` appended its six promoted derived
      // codes (ADR 0051 Amendment 6 decision 8, plan §12 ruling 2) to the 185
      // that were here after `F2.11`. Moved to the actual rather than left at
      // 185, where it would have stayed green with the six new codes parsed
      // as nothing at all — which is the exact failure this whole `describe`
      // block exists to make impossible.
      expect(codes.size, "the shared point-key arrays are empty").toBeGreaterThanOrEqual(191);
      expect(
        sql.split(";").filter((s) => s.trim().length > 0).length,
        "migration 0057 holds almost no statements",
      ).toBeGreaterThanOrEqual(6);
      // `tsOnly(…)`, not `read(…)`, and that is the whole point of the check.
      // Every "this token is gone" scan above reads the STRIPPED source, so the
      // length that proves they had something to scan must be the stripped
      // length too. `tsOnly` deletes from the first `/*` to the next `*/`: one
      // stray `/*` in a string literal, closed by any later doc comment, blanks
      // the span between them. Every `.toBe(false)` would then pass for free
      // and a guard on `read(…)` would report the file as healthy, because the
      // raw file IS healthy — it is the text the scans see that is empty.
      expect(
        tsOnly(read(SERVICE_REL)).length,
        `${SERVICE_REL} strips to almost nothing — the scans above ran on empty text`,
      ).toBeGreaterThan(2000);
      expect(
        tsOnly(read(PAGE_REL)).length,
        `${PAGE_REL} strips to almost nothing — the scans above ran on empty text`,
      ).toBeGreaterThan(2000);
    });
  });
});
