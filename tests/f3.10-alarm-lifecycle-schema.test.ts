import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.10` U3 / ADR 0057 decisions 1, 2, 3 and 7 — migration `0066`, the alarm
 * lifecycle: the two stamps and the hold, the backfill under `FORCE`, the
 * dedupe index's predicate swap, the four escalation tables under RLS, and the
 * two `notification_deliveries` indexes the PR 1 readers promised. Model:
 * `tests/adr-0055-min-coverage-ratio-migration.test.ts` and
 * `tests/f3.46-notification-deliveries-dedupe-index.test.ts`.
 *
 * `tests/adr-0043-tenant-columns.test.ts` scans `0046`/`0047` only, so the
 * four new tables' policies and `FORCE` flags are policed here.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6). Files are read by relative path from the repo root, never through a
 * static `@bms` import (the `F2.7` lesson: a hand-repaired workspace made a
 * real TS2307 pass locally).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0066_alarm_lifecycle.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/alarms-schema.ts";
const SERVICE_REL = "apps/api/src/notifications/notifications.service.ts";
/** `F3.53` moved the two dedupe-key ledger reads here, out of the service. */
const LEDGER_READS_REL = "apps/api/src/notifications/ledger-reads.ts";

const ESCALATION_TABLES = [
  "alarm_escalation_profiles",
  "alarm_escalation_steps",
  "alarm_escalation_step_channels",
  "alarm_escalation_defaults",
] as const;

/** Comments stripped before every assertion (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of one `CREATE POLICY tenant_isolation ON bms.<table>` statement. */
const policyOf = (sql: string, table: string): string => {
  const head = `CREATE POLICY tenant_isolation ON bms.${table}`;
  const start = sql.indexOf(head);
  expect(start, `${MIGRATION_REL} has no "${head}"`).toBeGreaterThan(-1);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
};

/** Every `CREATE UNIQUE INDEX` statement, each up to its own semicolon. */
const uniqueIndexStatements = (sql: string): string[] =>
  sql.match(/CREATE UNIQUE INDEX[\s\S]*?;/g) ?? [];

describe("F3.10 — migration 0066 exists", () => {
  it("0066_alarm_lifecycle.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), "migration must exist").toBe(true);
  });
});

describe("F3.10 alarm lifecycle migration 0066 (ADR 0057 decisions 1, 2, 3, 7)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("journals 0066 with idx 66 and a when strictly greater than entry 65's, both read from the file", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    const entry65 = journal.entries.find((e) => e.idx === 65);
    expect(entry65, "journal entry idx 65 (0065_notification_deliveries_dedupe_index) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry66 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry66,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();
    expect(entry66?.idx, "journal entry for 0066 must have idx 66").toBe(66);
    expect(entry66?.version).toBe("7");
    expect(entry66?.breakpoints).toBe(true);
    expect(
      entry66?.when,
      "migration 0066's journal when must be strictly greater than entry 65's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry65!.when);
  });

  it("adds the two alarm stamps and the rule hold, each IF NOT EXISTS, nullable, no CHECK", () => {
    expect(sql).toMatch(/ALTER TABLE bms\.alarms\s+ADD COLUMN IF NOT EXISTS cleared_at timestamptz;/);
    expect(sql).toMatch(/ALTER TABLE bms\.alarms\s+ADD COLUMN IF NOT EXISTS normal_since timestamptz;/);
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS clear_hold_seconds integer;/,
    );
    // Zod owns the 1..86_400 bound (plan Q2, 0062's precedent). `WITH CHECK` is
    // the policy clause and is removed before the scan so it cannot mask a
    // column CHECK that should not be there.
    expect(
      /\bCHECK\b/.test(sql.replace(/WITH CHECK/g, "")),
      "migration 0066 must carry no CHECK constraint — the clear_hold_seconds bound lives " +
        "in apps/api's Zod layer, the 0062 precedent.",
    ).toBe(false);
  });

  it("backfills cleared_at from acknowledged_at inside a per-organization GUC loop (plan D5)", () => {
    // `bms_owner` under FORCE with no GUC sees zero alarms rows, so a bare
    // UPDATE would backfill nothing and the index below would still build —
    // `tests/adr-0043-tenant-columns.test.ts` records the trap for 0046.
    const loop = sql.search(/FOR org IN SELECT id FROM bms\.organizations LOOP/);
    expect(loop, "the backfill must iterate bms.organizations, not run bare").toBeGreaterThan(-1);
    const update = sql.search(
      /UPDATE bms\.alarms\s+SET cleared_at = acknowledged_at\s+WHERE acknowledged_at IS NOT NULL\s+AND cleared_at IS NULL/,
    );
    expect(update, "the backfill UPDATE must be inside the loop").toBeGreaterThan(loop);
    expect(sql.indexOf("END LOOP;"), "the UPDATE must close inside END LOOP").toBeGreaterThan(update);
    expect(sql).toMatch(/set_config\(\s*'app\.current_organization',\s*org\.id::text,\s*true\s*\)/);
  });

  it("guards the whole backfill on the OLD index predicate, so a replay cannot back-date a live alarm", () => {
    // After 0066 `acknowledged_at IS NOT NULL AND cleared_at IS NULL` is the
    // ordinary steady state (ADR 0057 decision 1: acknowledged, still active),
    // so an unguarded replay of this file would clear every live acknowledged
    // alarm and free its dedupe slot. The marker that says "not yet migrated"
    // is the OLD predicate still in the catalogue — read BEFORE the DROP that
    // removes it, or the guard reads a catalogue this same file just changed.
    const guard = sql.search(
      /IF EXISTS \(SELECT 1 FROM pg_indexes\s+WHERE schemaname = 'bms' AND indexname = 'alarms_open_per_rule_uidx'\s+AND indexdef LIKE '%acknowledged_at IS NULL%'\) THEN/,
    );
    expect(
      guard,
      "0066's backfill must be wrapped in an IF EXISTS on pg_indexes matching the old " +
        "acknowledged_at IS NULL predicate — without it the file is not re-runnable.",
    ).toBeGreaterThan(-1);

    const loop = sql.indexOf("FOR org IN SELECT id FROM bms.organizations LOOP");
    expect(guard, "the guard must open before the organization loop").toBeLessThan(loop);
    const endIf = sql.indexOf("END IF;");
    expect(endIf, "the guard must be closed with END IF").toBeGreaterThan(sql.indexOf("END LOOP;"));

    // The GUC reset stays OUTSIDE the IF: nothing later in this transaction may
    // run with a tenant set, whether or not the backfill fired.
    const reset = sql.indexOf("set_config('app.current_organization', '', true)");
    expect(reset, "0066 must reset app.current_organization to ''").toBeGreaterThan(-1);
    expect(reset, "the reset must follow END LOOP").toBeGreaterThan(sql.indexOf("END LOOP;"));
    expect(reset, "the reset must sit outside the IF, not inside it").toBeGreaterThan(endIf);

    // Reading the catalogue after the DROP would make the guard always false.
    const drop = sql.indexOf("DROP INDEX IF EXISTS bms.alarms_open_per_rule_uidx;");
    expect(drop, "0066 must DROP INDEX IF EXISTS bms.alarms_open_per_rule_uidx").toBeGreaterThan(-1);
    expect(guard, "the pg_indexes guard must read the catalogue before the DROP invalidates it").toBeLessThan(
      drop,
    );
  });

  it("moves alarms_open_per_rule_uidx to cleared_at IS NULL — drop, then create, after the backfill (decision 2)", () => {
    const drop = sql.indexOf("DROP INDEX IF EXISTS bms.alarms_open_per_rule_uidx;");
    expect(drop, "0066 must DROP INDEX IF EXISTS bms.alarms_open_per_rule_uidx").toBeGreaterThan(-1);
    const create = sql.search(
      /CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_per_rule_uidx\s+ON bms\.alarms\s*\(\s*asset_id,\s*rule_id\s*\)\s*WHERE cleared_at IS NULL AND rule_id IS NOT NULL;/,
    );
    expect(create, "0066 must re-create alarms_open_per_rule_uidx on the cleared_at predicate").toBeGreaterThan(-1);
    expect(drop, "the DROP must precede the CREATE").toBeLessThan(create);
    const backfill = sql.indexOf("SET cleared_at = acknowledged_at");
    expect(backfill, "the backfill must precede the CREATE — the CREATE is the duplicate check").toBeLessThan(create);

    for (const statement of uniqueIndexStatements(sql)) {
      expect(
        statement,
        "no CREATE UNIQUE INDEX in 0066 may still predicate on acknowledged_at IS NULL",
      ).not.toMatch(/acknowledged_at IS NULL/);
    }
  });

  it.each(ESCALATION_TABLES)("creates bms.%s IF NOT EXISTS, with ENABLE + FORCE and a tenant_isolation policy", (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
    expect(sql).toMatch(new RegExp(`ALTER TABLE bms\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE bms\\.${table}\\s+FORCE ROW LEVEL SECURITY;`));
    expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);
    expect(sql).toContain(`CREATE POLICY tenant_isolation ON bms.${table}`);
  });

  it("gives every policy the legs plan D6 names — and no others", () => {
    const current = "nullif(current_setting('app.current_organization', true), '')::uuid";

    // profiles: own column only.
    const profiles = policyOf(sql, "alarm_escalation_profiles");
    expect(profiles).toContain(`organization_id = ${current}`);
    expect(profiles).not.toMatch(/EXISTS/);

    // defaults: own column AND the parent leg on profile_id — a foreign key is
    // checked with row security off (0056:279-291), so without the leg a
    // tenant could map its severity to another tenant's profile.
    const defaults = policyOf(sql, "alarm_escalation_defaults");
    expect(defaults).toContain(`organization_id = ${current}`);
    expect(defaults).toMatch(/AND EXISTS \(SELECT 1 FROM bms\.alarm_escalation_profiles p/);
    expect(defaults).toContain("p.id = alarm_escalation_defaults.profile_id");

    // steps: through the profile (rule_notifications' shape, 0047:262-272).
    const steps = policyOf(sql, "alarm_escalation_steps");
    expect(steps).toMatch(/EXISTS \(SELECT 1 FROM bms\.alarm_escalation_profiles p/);
    expect(steps).toContain("p.id = alarm_escalation_steps.profile_id");

    // step channels: through step -> profile. The channel leg is deliberately
    // absent: a fleet-wide NULL-org channel is a legitimate target, exactly as
    // rule_notifications does not check the channel's organization; the
    // service gates channel scope in code (plan D8, PR 1 review M2).
    const stepChannels = policyOf(sql, "alarm_escalation_step_channels");
    expect(stepChannels).toMatch(/FROM bms\.alarm_escalation_steps s/);
    expect(stepChannels).toMatch(/JOIN bms\.alarm_escalation_profiles p ON p\.id = s\.profile_id/);
    expect(stepChannels).toContain("s.id = alarm_escalation_step_channels.step_id");
    expect(stepChannels).not.toMatch(/notification_channels/);

    // Every policy gates the write as well as the read.
    for (const policy of [profiles, defaults, steps, stepChannels]) {
      expect(policy).toMatch(/USING \(/);
      expect(policy).toMatch(/WITH CHECK \(/);
    }
  });

  it("wires the foreign keys with the actions D6 rules", () => {
    // Configuration cascades with its parent.
    expect(sql).toMatch(
      /profile_id uuid NOT NULL\s+CONSTRAINT alarm_escalation_steps_profile_id_fk\s+REFERENCES bms\.alarm_escalation_profiles\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /step_id uuid NOT NULL\s+CONSTRAINT alarm_escalation_step_channels_step_id_fk\s+REFERENCES bms\.alarm_escalation_steps\(id\) ON DELETE CASCADE/,
    );
    // A channel a step still names, or a profile a severity still maps to,
    // refuses the delete loudly (0038's reasoning for rule_notifications).
    expect(sql).toMatch(
      /channel_id uuid NOT NULL\s+CONSTRAINT alarm_escalation_step_channels_channel_id_fk\s+REFERENCES bms\.notification_channels\(id\),/,
    );
    expect(sql).toMatch(
      /profile_id uuid NOT NULL\s+CONSTRAINT alarm_escalation_defaults_profile_id_fk\s+REFERENCES bms\.alarm_escalation_profiles\(id\),/,
    );
    // Severity is validated by the foreign key, not by VocabulariesModule (D11).
    expect(sql).toMatch(
      /severity varchar\(64\) NOT NULL\s+CONSTRAINT alarm_escalation_defaults_severity_fk\s+REFERENCES bms\.alarm_severities\(code\)/,
    );
    // Uniques and primary keys per D6.
    expect(sql).toMatch(/CONSTRAINT alarm_escalation_profiles_org_code_key UNIQUE \(organization_id, code\)/);
    expect(sql).toMatch(/CONSTRAINT alarm_escalation_steps_profile_step_key UNIQUE \(profile_id, step_no\)/);
    expect(sql).toMatch(/PRIMARY KEY \(step_id, channel_id\)/);
    expect(sql).toMatch(/PRIMARY KEY \(organization_id, severity\)/);
  });

  it("adds the two notification_deliveries indexes the PR 1 readers promised and drops 0065's now-subsumed one", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS notification_deliveries_channel_key_idx\s+ON bms\.notification_deliveries\s*\(\s*channel_id,\s*dedupe_key\s*\)\s*WHERE dedupe_key IS NOT NULL;/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS notification_deliveries_alarm_idx\s+ON bms\.notification_deliveries\s*\(\s*alarm_id\s*\)\s*WHERE alarm_id IS NOT NULL;/,
    );
    // Same key columns; `dedupe_key = $x` implies IS NOT NULL and the status
    // filter is applied after, so the wider index serves hasRecordedSkip too.
    // 0038's rule read in reverse: the migration that makes an index readerless
    // drops it.
    expect(sql).toContain("DROP INDEX IF EXISTS bms.notification_deliveries_dedupe_skip_idx;");
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket, writes no GRANT, never CONCURRENTLY", () => {
    expect(sql).toContain("SET ROLE bms_owner;");
    expect(sql).toContain("RESET ROLE;");
    // Default privileges fire for objects bms_owner creates (0056:72-75); a
    // hand-written GRANT would hide a future breakage of the bracket.
    expect(/\bGRANT\b/.test(sql), "migration 0066 must write no GRANT").toBe(false);
    expect(
      /CONCURRENTLY/i.test(sql),
      "drizzle applies the file inside one transaction; CONCURRENTLY cannot run inside one (§4.4).",
    ).toBe(false);
  });

  it("the readers exist: sentChannelIdsForAlarm, eventDeliveryBlocked and hasRecordedSkip read what the indexes serve", () => {
    const service = read(SERVICE_REL);
    expect(service).toContain("async sentChannelIdsForAlarm(");

    // `F3.53` moved the two dedupe-key reads OUT of the service, into
    // `ledger-reads.ts`, to make room under §4.5's cap. The invariant is
    // unchanged and deliberately not weakened — an index must still have a
    // reader that filters on the columns it serves. Only the file and the
    // declaration form moved: `private async x(` became
    // `export async function x(`.
    //
    // This test found that move by going red in the full suite, and nothing
    // else did: it lives in the `repo` vitest project, so neither
    // `vitest run apps/api/src/notifications` nor `pnpm typecheck:tests`
    // executes it.
    const ledgerReads = read(LEDGER_READS_REL);
    expect(ledgerReads).toContain("export async function eventDeliveryBlocked(");
    expect(ledgerReads).toContain("export async function hasRecordedSkip(");

    const alarmRead = service.slice(service.indexOf("async sentChannelIdsForAlarm("));
    expect(
      alarmRead.slice(0, alarmRead.indexOf("return ")).includes("eq(notificationDeliveries.alarmId"),
      "sentChannelIdsForAlarm no longer filters on alarm_id, so notification_deliveries_alarm_idx has no reader",
    ).toBe(true);

    const eventRead = ledgerReads.slice(
      ledgerReads.indexOf("export async function eventDeliveryBlocked("),
    );
    expect(
      eventRead.slice(0, eventRead.indexOf("return ")).includes("eq(notificationDeliveries.dedupeKey"),
      "eventDeliveryBlocked no longer filters on dedupe_key, so notification_deliveries_channel_key_idx has no reader",
    ).toBe(true);
  });

  it("packages/db/src/schema/alarms-schema.ts mirrors the columns and the four tables", () => {
    const schema = read(SCHEMA_REL);

    const alarmsStart = schema.indexOf('bmsSchema.table("alarms"');
    expect(alarmsStart).toBeGreaterThan(-1);
    const alarmsBlock = schema.slice(alarmsStart, schema.indexOf("\n});", alarmsStart));
    expect(alarmsBlock).toMatch(/clearedAt:\s*timestamp\(\s*"cleared_at"/);
    expect(alarmsBlock).toMatch(/normalSince:\s*timestamp\(\s*"normal_since"/);

    const rulesStart = schema.indexOf('bmsSchema.table("automation_rules"');
    expect(rulesStart).toBeGreaterThan(-1);
    const rulesBlock = schema.slice(rulesStart, schema.indexOf("\n});", rulesStart));
    expect(rulesBlock).toMatch(/clearHoldSeconds:\s*integer\(\s*"clear_hold_seconds"\s*\)/);

    for (const table of ESCALATION_TABLES) {
      expect(schema, `alarms-schema.ts declares no drizzle table for bms.${table}`).toContain(
        `bmsSchema.table(\n  "${table}"`,
      );
    }
    expect(schema).toContain('unique("alarm_escalation_profiles_org_code_key")');
    expect(schema).toContain('unique("alarm_escalation_steps_profile_step_key")');
  });
});
