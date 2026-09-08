import { eq, is, TransactionRollbackError } from "drizzle-orm";

import { alarmSkills, assetTemplates, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AlarmKbService } from "./alarm-kb.service";
import { fixtureLocation } from "../testing/integration-fixtures";

/**
 * `E2.2` PR 2 (ADR 0059 decision 4) — the browsable KB against a real database.
 *
 * Every assertion runs in its own transaction and rolls back, for the reason
 * `alarm-enrichment.integration.spec.ts`'s header gives.
 *
 * **These fixtures do not need provenance**, and that asymmetry is the whole
 * argument for ruling Q0: `classPhilosophy` on the alarm panel resolves for 0 of
 * 290 rules on the dev database, while this list reads published templates
 * directly and finds 170 authored philosophy rows across 21 classes. The two
 * surfaces fail in opposite conditions.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

type AlarmSeed = {
  code: string;
  philosophy?: Record<string, string> | null;
};

async function seedTemplate(
  db: BmsDb,
  args: {
    organizationId: string;
    code: string;
    version: number;
    status: "draft" | "published" | "archived";
    alarms: AlarmSeed[];
  },
): Promise<string> {
  const [row] = await db
    .insert(assetTemplates)
    .values({
      organizationId: args.organizationId,
      code: args.code,
      version: args.version,
      name: `E2.2 KB ${args.code} v${args.version}`,
      assetType: "e22_kb_machine",
      domain: "electrical",
      status: args.status,
      content: {
        alarms: args.alarms.map((alarm) => ({
          code: alarm.code,
          pointKey: "e22_kb_point",
          message: `Message for ${alarm.code}`,
          severity: "warning",
          category: "safety",
          ...(alarm.philosophy === undefined
            ? {}
            : { philosophy: alarm.philosophy }),
        })),
      },
    })
    .returning({ id: assetTemplates.id });
  if (!row) {
    throw new Error(`failed to seed KB template ${args.code} v${args.version}`);
  }
  return row.id;
}

/** Only this suite's own templates, so a shared database's real content cannot decide a count. */
function onlyOurClasses<T extends { templateCode: string }>(classes: T[], prefix: string): T[] {
  return classes.filter((entry) => entry.templateCode.startsWith(prefix));
}

/**
 * Ruling Q0a — one entry per `code`, at the **current published version**. Not
 * every published version (an archive), and not only the versions the fleet
 * pins (which would hide a class nobody has instantiated yet).
 */
export async function assertKbListsOneEntryPerCodeAtTheCurrentPublishedVersion(
  db: BmsDb,
): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    const philosophy = { cause: "v1 cause", action: "v1 action" };
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_VERSIONS",
      version: 1,
      status: "published",
      alarms: [{ code: "A1", philosophy }],
    });
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_VERSIONS",
      version: 2,
      status: "published",
      alarms: [{ code: "A1", philosophy: { cause: "v2 cause", action: "v2 action" } }],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);
    const ours = onlyOurClasses(classes, "E22_KB_VERSIONS");

    assert(ours.length === 1, `expected exactly one entry for the code, got ${ours.length}`);
    assert(
      ours[0]?.templateVersion === 2,
      `expected the highest published version, got ${ours[0]?.templateVersion}`,
    );
    assert(
      ours[0]?.alarms[0]?.cause === "v2 cause",
      `expected v2's philosophy text, got ${ours[0]?.alarms[0]?.cause}`,
    );

    tx.rollback();
  });
}

/** A draft is unpublished intent and an archived version is withdrawn; neither is knowledge. */
export async function assertKbExcludesDraftAndArchivedTemplates(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    const philosophy = { cause: "should not appear" };
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_DRAFT",
      version: 1,
      status: "draft",
      alarms: [{ code: "A1", philosophy }],
    });
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_ARCHIVED",
      version: 1,
      status: "archived",
      alarms: [{ code: "A1", philosophy }],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);

    assert(
      onlyOurClasses(classes, "E22_KB_DRAFT").length === 0,
      "a draft template must not appear in the KB",
    );
    assert(
      onlyOurClasses(classes, "E22_KB_ARCHIVED").length === 0,
      "an archived template must not appear in the KB",
    );

    tx.rollback();
  });
}

/**
 * ADR 0059 decision 9. This service runs on `bms_fleet`, which is `BYPASSRLS`,
 * so the organization filter is hand-written and nothing else holds it.
 * **Delete the `inArray` on `organizationId` and this test must fail.**
 */
export async function assertKbScopedToTheCallersOrganization(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    const [otherOrg] = await tx
      .insert(organizations)
      .values({ code: "E22_KB_OTHER_ORG", name: "E2.2 KB — other tenant" })
      .returning({ id: organizations.id });
    if (!otherOrg) {
      throw new Error("failed to insert the other-tenant organization");
    }
    await seedTemplate(tx, {
      organizationId: otherOrg.id,
      code: "E22_KB_FOREIGN",
      version: 1,
      status: "published",
      alarms: [{ code: "A1", philosophy: { cause: "another tenant's knowledge" } }],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);
    assert(
      onlyOurClasses(classes, "E22_KB_FOREIGN").length === 0,
      "a template from another organization must not appear in the caller's KB",
    );

    tx.rollback();
  });
}

/**
 * A bare threshold row is not knowledge, and a philosophy object whose every
 * field is empty is not either. On today's data all 170 alarm rows carry one,
 * so this test is the only thing holding the rule.
 */
export async function assertKbOmitsAlarmRowsWithNoPhilosophy(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_MIXED",
      version: 1,
      status: "published",
      alarms: [
        { code: "HAS_ONE", philosophy: { cause: "real knowledge" } },
        { code: "HAS_NONE" },
        { code: "HAS_EMPTY", philosophy: { cause: "   ", action: "" } },
      ],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);
    const ours = onlyOurClasses(classes, "E22_KB_MIXED");
    assert(ours.length === 1, `expected the class to appear once, got ${ours.length}`);

    const codes = (ours[0]?.alarms ?? []).map((a) => a.alarmCode).sort();
    assert(
      codes.length === 1 && codes[0] === "HAS_ONE",
      `expected only the philosophy-bearing entry, got [${codes.join(", ")}]`,
    );

    tx.rollback();
  });
}

/**
 * ADR 0059 decision 7, the KB's half: a retired trade still renders its label,
 * because a philosophy authored before the retirement must stay legible.
 */
export async function assertKbResolvesAnInactiveSkillLabel(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    await tx
      .insert(alarmSkills)
      .values({ code: "e22_kb_retired", label: "Retired KB trade", active: false });
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_RETIRED_SKILL",
      version: 1,
      status: "published",
      alarms: [{ code: "A1", philosophy: { cause: "x", skill: "e22_kb_retired" } }],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);
    const ours = onlyOurClasses(classes, "E22_KB_RETIRED_SKILL");
    assert(
      ours[0]?.alarms[0]?.skillLabel === "Retired KB trade",
      `an inactive skill must still resolve its label, got ${ours[0]?.alarms[0]?.skillLabel}`,
    );

    tx.rollback();
  });
}

/**
 * A caller with no organization at all gets nothing, not everything. The
 * failure direction has to be closed — `readableOrganizationIds` returns `null`
 * for an unrestricted admin and `[]` for a user with no grant, and confusing
 * the two is how a scope check becomes a leak.
 */
export async function assertKbReturnsNothingForAnEmptyScope(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_EMPTY_SCOPE",
      version: 1,
      status: "published",
      alarms: [{ code: "A1", philosophy: { cause: "visible to someone" } }],
    });

    const { classes } = await new AlarmKbService(tx).list([]);
    assert(classes.length === 0, `an empty organization scope must return nothing, got ${classes.length}`);

    tx.rollback();
  });
}

/** Sanity: the fixture's own template really is reachable when the scope allows it. */
export async function assertKbFindsAPhilosophyBearingClass(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { organizationId } = await fixtureLocation(tx);
    const templateId = await seedTemplate(tx, {
      organizationId,
      code: "E22_KB_HAPPY",
      version: 1,
      status: "published",
      alarms: [
        {
          code: "BEARING_TEMP_HIGH",
          philosophy: {
            cause: "Lubrication starvation.",
            impact: "Unplanned outage.",
            action: "Reduce load and re-grease.",
            skill: "mechanical",
          },
        },
      ],
    });

    const { classes } = await new AlarmKbService(tx).list([organizationId]);
    const ours = onlyOurClasses(classes, "E22_KB_HAPPY");
    assert(ours.length === 1, `expected the seeded class, got ${ours.length}`);
    assert(ours[0]?.templateId === templateId, "expected the seeded template's id");
    const alarm = ours[0]?.alarms[0];
    assert(alarm?.alarmCode === "BEARING_TEMP_HIGH", `got ${alarm?.alarmCode}`);
    assert(alarm?.cause === "Lubrication starvation.", `got ${alarm?.cause}`);
    assert(alarm?.impact === "Unplanned outage.", `got ${alarm?.impact}`);
    assert(alarm?.action === "Reduce load and re-grease.", `got ${alarm?.action}`);
    assert(
      alarm?.skillCode === "mechanical" && alarm?.skillLabel === "Mechanical",
      `expected the skill resolved to its label, got ${alarm?.skillCode}/${alarm?.skillLabel}`,
    );
    assert(ours[0]?.domain === "electrical", `got ${ours[0]?.domain}`);

    tx.rollback();
  });
}

/** Used by the runner to skip cleanly when the seed's vocabulary is missing. */
export async function assertMechanicalSkillIsSeeded(db: BmsDb): Promise<void> {
  const [row] = await db
    .select({ label: alarmSkills.label })
    .from(alarmSkills)
    .where(eq(alarmSkills.code, "mechanical"))
    .limit(1);
  assert(row?.label === "Mechanical", `expected the seeded mechanical trade, got ${row?.label}`);
}
