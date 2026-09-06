import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";

import {
  alarmEscalationDefaults,
  alarmEscalationProfiles,
  alarmEscalationStepChannels,
  alarmEscalationSteps,
  auditLog,
} from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import { EscalationProfilesService } from "./escalation-profiles.service";
import {
  createEscalationProfileBodySchema,
  setEscalationDefaultsBodySchema,
  updateEscalationProfileBodySchema,
} from "./escalation-profiles.schema";
import type { NotificationChannelRow } from "./notification-transport";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejectsWith(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

type Ctor = ConstructorParameters<typeof EscalationProfilesService>;

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PROFILE_ID = "cccccccc-0000-4000-8000-00000000000c";
const CHANNEL_A = "11111111-0000-4000-8000-000000000001";
const CHANNEL_B = "22222222-0000-4000-8000-000000000002";
const FLEET_CHANNEL = "33333333-0000-4000-8000-000000000003";

const ADMIN = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" } as JwtPayload;
const ORG_ADMIN = {
  sub: "u2",
  email: "org@bms.local",
  name: "Org",
  role: "organization_admin",
} as JwtPayload;
const LOCATION_ADMIN = {
  sub: "u3",
  email: "loc@bms.local",
  name: "Loc",
  role: "location_admin",
} as JwtPayload;

function channelRow(id: string, organizationId: string | null): NotificationChannelRow {
  return {
    id,
    organizationId,
    code: `ch-${id.slice(0, 4)}`,
    name: "Channel",
    kind: "log",
    config: {},
    secret: null,
    secretState: "none",
    enabled: true,
  };
}

/**
 * `AccessControlService`'s three methods, answered from the role and a fixed
 * writable-organization set.
 *
 * The role comes from the fake rather than from `jwt.role` for the reason
 * `channels.service.ts`'s class comment records: every real method resolves the
 * database row, never the claim. Here the two agree, so a test reads naturally;
 * the point is that the service never reads `jwt.role` itself.
 */
function accessControl(role: UserRole, writable: string[] | null): Ctor[3] {
  return {
    requireMasterDataUser: () => Promise.resolve({ role }),
    writableOrganizationIds: () => Promise.resolve(writable),
    canManageNotificationChannel: (_jwt: JwtPayload, organizationId: string | null) => {
      if (role === "admin") return Promise.resolve(true);
      if (role !== "organization_admin" || organizationId === null) return Promise.resolve(false);
      return Promise.resolve(writable === null || writable.includes(organizationId));
    },
  } as unknown as Ctor[3];
}

/** `ChannelsService.loadById` alone — the only method this service calls. */
function channelsService(
  rows: Record<string, NotificationChannelRow | null>,
  gate: (row: NotificationChannelRow) => boolean = () => true,
): { channels: Ctor[2]; loaded: string[] } {
  const loaded: string[] = [];
  const channels = {
    loadById: (_jwt: JwtPayload, id: string) => {
      loaded.push(id);
      const row = rows[id];
      if (row === undefined || row === null) return Promise.resolve(null);
      if (!gate(row)) {
        return Promise.reject(new ForbiddenException("Notification channel is outside your access scope"));
      }
      return Promise.resolve(row);
    },
  } as unknown as Ctor[2];
  return { channels, loaded };
}

type Insert = { table: unknown; values: unknown };
type Recorder = {
  /** Per-fake counters, not lifetime statistics (§4.6). */
  transactions: number;
  tenantOrgIds: string[];
  inserts: Insert[];
  deletes: unknown[];
  updates: Insert[];
  audits: Record<string, unknown>[];
};

function recorder(): Recorder {
  return { transactions: 0, tenantOrgIds: [], inserts: [], deletes: [], updates: [], audits: [] };
}

/**
 * The two halves of the fake database, told apart the way the service tells
 * them apart: reads that must span organizations go to the fleet fake, every
 * write and every single-organization read goes through `withTenant` on the
 * tenant fake.
 *
 * **Reads are routed by their exact projection key set**, the idiom
 * `notifications.service.spec.ts` records: drizzle hands a fake an opaque
 * object for the `WHERE`, so the projection is the only thing a fake can see.
 * An unknown projection throws rather than returning `[]` — a fake that
 * answers a read it does not recognise makes a test pass for the wrong reason
 * (the `F3.46` lesson). The real `WHERE` of each read is proven against
 * Postgres in `escalation-profiles.rls.integration.spec.ts`.
 */
function fakeFleet(
  rec: Recorder,
  answers: { existing?: unknown[]; listRows?: unknown[] } = {},
): Ctor[0] {
  const shapeOf = (projection: Record<string, unknown>): string =>
    Object.keys(projection).sort().join(",");
  return {
    select: (projection: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      // `loadExistingForWrite` — the profile's own organization, read before
      // any tenant GUC exists to read it under.
      if (shape === "code,name,organizationId") {
        return {
          from: () => ({ where: () => ({ limit: () => Promise.resolve(answers.existing ?? []) }) }),
        };
      }
      // The audit actor lookup, `channels.service.ts:audit()`'s shape.
      if (shape === "id") {
        return {
          from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "actor-1" }]) }) }),
        };
      }
      // `list` — the profile/step/channel join, across organizations.
      if (shape === "afterMinutes,channelId,code,createdAt,id,name,organizationId,stepNo,updatedAt") {
        return {
          from: () => ({
            leftJoin: () => ({
              leftJoin: () => ({
                where: () => ({ orderBy: () => Promise.resolve(answers.listRows ?? []) }),
              }),
            }),
          }),
        };
      }
      throw new Error(`fakeFleet: unrecognised projection {${shape}}`);
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === auditLog) rec.audits.push(values);
        else rec.inserts.push({ table, values });
        return Promise.resolve(undefined);
      },
    }),
  } as unknown as Ctor[0];
}

function fakeTenant(
  rec: Recorder,
  answers: {
    profileRow?: Record<string, unknown>;
    updatedRow?: Record<string, unknown> | undefined;
    stepRows?: { stepNo: number; afterMinutes: number; channelId: string | null }[];
    defaultRows?: { severity: string; profileId: string; profileCode: string }[];
    visibleProfileIds?: string[];
    deleteReturns?: { id: string }[];
    failWith?: { code: string; constraint?: string };
  } = {},
): Ctor[1] {
  const shapeOf = (projection: Record<string, unknown>): string =>
    Object.keys(projection).sort().join(",");
  const reject = (): Promise<never> =>
    Promise.reject(
      Object.assign(new Error(`constraint violation ${answers.failWith?.code}`), answers.failWith),
    );
  /**
   * A **lazy** rejecting thenable, and the laziness is not decoration: an
   * eagerly-created rejected promise that the service reaches past (it calls
   * `.returning()`, not `await`) is an unhandled rejection, which fails the run
   * for a reason that has nothing to do with the assertion.
   */
  const failing = (): unknown => ({
    returning: reject,
    then: (onFulfilled: unknown, onRejected: unknown) =>
      reject().then(onFulfilled as never, onRejected as never),
  });

  const tx = {
    execute: (statement: unknown) => {
      // `withTenant`'s `set_config`. The organization id is a bind parameter,
      // never concatenated into the SQL, so it is reachable as a value inside
      // the statement's chunks rather than as text. Scanned structurally
      // instead of by chunk key so this does not break on drizzle's internals.
      const visit = (node: unknown, depth: number): void => {
        if (depth > 5 || node === null || typeof node !== "object") return;
        for (const value of Object.values(node as Record<string, unknown>)) {
          if (typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
            rec.tenantOrgIds.push(value);
          } else if (typeof value === "object") visit(value, depth + 1);
        }
      };
      visit(statement, 0);
      return Promise.resolve(undefined);
    },
    select: (projection: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      if (shape === "afterMinutes,channelId,stepNo") {
        return {
          from: () => ({
            leftJoin: () => ({
              where: () => ({ orderBy: () => Promise.resolve(answers.stepRows ?? []) }),
            }),
          }),
        };
      }
      if (shape === "profileCode,profileId,severity") {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => ({ orderBy: () => Promise.resolve(answers.defaultRows ?? []) }),
            }),
          }),
        };
      }
      if (shape === "id") {
        return {
          from: () => ({
            where: () =>
              Promise.resolve((answers.visibleProfileIds ?? []).map((id) => ({ id }))),
          }),
        };
      }
      throw new Error(`fakeTenant: unrecognised projection {${shape}}`);
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        rec.inserts.push({ table, values });
        if (answers.failWith !== undefined) return failing();
        const rows =
          table === alarmEscalationProfiles
            ? [answers.profileRow ?? {}]
            : table === alarmEscalationSteps
              ? (values as { stepNo: number }[]).map((value, index) => ({
                  id: `step-${index + 1}`,
                  stepNo: value.stepNo,
                }))
              : [];
        return Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            rec.updates.push({ table, values });
            if (answers.failWith !== undefined) return reject();
            return Promise.resolve(
              answers.updatedRow === undefined ? [] : [answers.updatedRow],
            );
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        rec.deletes.push(table);
        if (answers.failWith !== undefined) return failing();
        const rows = answers.deleteReturns ?? [];
        return Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
      },
    }),
  };

  return {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      rec.transactions += 1;
      return fn(tx);
    },
  } as unknown as Ctor[1];
}

const PROFILE_ROW = {
  id: PROFILE_ID,
  organizationId: ORG_A,
  code: "after-hours",
  name: "After hours",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

/**
 * `F3.10` U8 — what `EscalationProfilesService` answers, and what it refuses
 * before it writes anything (ADR 0057 decision 7, plan D8/D11 and PR 1's M2).
 */
export async function runEscalationProfilesServiceTests(): Promise<void> {
  // --- the schema owns three of the refusals -------------------------------
  //
  // Q2 and Q4 are bounds, so they belong where a bound belongs: in the Zod
  // body, refused before a service method is ever entered.
  {
    const notIncreasing = createEscalationProfileBodySchema.safeParse({
      code: "after-hours",
      name: "After hours",
      steps: [
        { afterMinutes: 5, channelIds: [CHANNEL_A] },
        { afterMinutes: 5, channelIds: [CHANNEL_A] },
      ],
    });
    assert(!notIncreasing.success, "equal afterMinutes must be refused, not only descending ones");

    const noChannel = createEscalationProfileBodySchema.safeParse({
      code: "after-hours",
      name: "After hours",
      steps: [{ afterMinutes: 5, channelIds: [] }],
    });
    assert(!noChannel.success, "a step with no channel is refused (ruling Q4)");
    assert(
      JSON.stringify(noChannel.error?.flatten()).includes("escalates to nobody"),
      "the refusal says why a channel-less step is not merely empty",
    );

    const noSteps = createEscalationProfileBodySchema.safeParse({
      code: "after-hours",
      name: "After hours",
    });
    assert(noSteps.success, "a profile with no steps is allowed (ruling Q4)");

    const emptyPatch = updateEscalationProfileBodySchema.safeParse({});
    assert(!emptyPatch.success, "an empty PATCH is a lost edit, not a no-op");

    const duplicateSeverity = setEscalationDefaultsBodySchema.safeParse({
      items: [
        { severity: "critical", profileId: PROFILE_ID },
        { severity: "critical", profileId: PROFILE_ID },
      ],
    });
    assert(!duplicateSeverity.success, "a severity may be mapped at most once per organization");
  }

  // --- an organization_admin with one grant need not name the organization --
  {
    const rec = recorder();
    const { channels } = channelsService({ [CHANNEL_A]: channelRow(CHANNEL_A, ORG_A) });
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { profileRow: PROFILE_ROW, stepRows: [{ stepNo: 1, afterMinutes: 5, channelId: CHANNEL_A }] }),
      channels,
      accessControl("organization_admin", [ORG_A]),
    );

    const dto = await service.create(ORG_ADMIN, {
      code: "after-hours",
      name: "After hours",
      steps: [{ afterMinutes: 5, channelIds: [CHANNEL_A] }],
    });

    assert(dto.organizationId === ORG_A, "the single grant is the implicit target organization");
    assert(rec.transactions === 1, "exactly one tenant transaction is opened");
    assert(rec.tenantOrgIds[0] === ORG_A, "withTenant names the resolved organization");
    assert(dto.steps.length === 1 && dto.steps[0]?.stepNo === 1, "the step is numbered from 1");
    assert(
      typeof dto.createdAt === "string" && dto.createdAt.endsWith("Z"),
      "timestamps cross the wire as ISO strings, as the contract declares",
    );
    assert(rec.audits.length === 1, "one audit row per write");
    assert(
      rec.audits[0]?.entityType === "alarm_escalation_profile" &&
        rec.audits[0]?.organizationId === ORG_A,
      "the audit row is stamped with the entity type and the profile's organization",
    );
    const payload = rec.audits[0]?.payload as Record<string, unknown>;
    assert(
      payload.code === "after-hours" && payload.stepCount === 1,
      "the audit payload carries codes, ids and counts (§9.6)",
    );
  }

  // --- an admin who omits organizationId is refused, not given a global row -
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () => service.create(ADMIN, { code: "after-hours", name: "After hours", steps: [] }),
      (e) => e instanceof BadRequestException && /organizationId is required/i.test((e as Error).message),
      "an admin who names no organization",
    );
    assert(rec.transactions === 0, "nothing was written");
  }

  // --- a channel outside the caller's scope is a 403, before any write ------
  {
    const rec = recorder();
    const { channels, loaded } = channelsService(
      { [CHANNEL_B]: channelRow(CHANNEL_B, ORG_B) },
      (row) => row.organizationId === ORG_A,
    );
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { profileRow: PROFILE_ROW }),
      channels,
      accessControl("organization_admin", [ORG_A]),
    );
    await rejectsWith(
      () =>
        service.create(ORG_ADMIN, {
          code: "after-hours",
          name: "After hours",
          steps: [{ afterMinutes: 5, channelIds: [CHANNEL_B] }],
        }),
      (e) => e instanceof ForbiddenException,
      "a channel the caller may not manage",
    );
    assert(loaded.length === 1, "the channel was resolved through ChannelsService.loadById");
    assert(rec.transactions === 0, "the refusal lands before the transaction opens");
  }

  // --- a channel in ANOTHER organization is a 400, mirroring setRuleChannels
  //
  // PR 1's M2: `dispatchToChannels` drops a channel whose organization is
  // neither `null` nor the alarm's, and that guard is the caller-independent
  // floor. This is the same refusal one layer up — an admin passes every scope
  // gate, so without it a profile in org A could silently name org B's channel
  // and every step it fed would be dropped at send time with a warn nobody
  // reads. A fleet-wide (NULL-org) channel stays shareable, exactly as
  // `setRuleChannels` and `rule_notifications` keep it.
  {
    const rec = recorder();
    const { channels } = channelsService({
      [CHANNEL_B]: channelRow(CHANNEL_B, ORG_B),
      [FLEET_CHANNEL]: channelRow(FLEET_CHANNEL, null),
    });
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { profileRow: PROFILE_ROW }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () =>
        service.create(ADMIN, {
          organizationId: ORG_A,
          code: "after-hours",
          name: "After hours",
          steps: [{ afterMinutes: 5, channelIds: [FLEET_CHANNEL, CHANNEL_B] }],
        }),
      (e) =>
        e instanceof BadRequestException &&
        /different organization/i.test((e as Error).message) &&
        (e as Error).message.includes(CHANNEL_B) &&
        !(e as Error).message.includes(FLEET_CHANNEL),
      "a channel belonging to another organization",
    );
    assert(rec.transactions === 0, "the pairing refusal lands before the transaction opens");
  }

  // --- a channel id that resolves to nothing is named, not left to the FK ---
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { profileRow: PROFILE_ROW }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () =>
        service.create(ADMIN, {
          organizationId: ORG_A,
          code: "after-hours",
          name: "After hours",
          steps: [{ afterMinutes: 5, channelIds: [CHANNEL_A] }],
        }),
      (e) => e instanceof BadRequestException && (e as Error).message.includes(CHANNEL_A),
      "a channel id naming no channel",
    );
    assert(rec.transactions === 0, "nothing was written");
  }

  // --- steps are renumbered 1..n from their positions ----------------------
  {
    const rec = recorder();
    const { channels } = channelsService({
      [CHANNEL_A]: channelRow(CHANNEL_A, ORG_A),
      [FLEET_CHANNEL]: channelRow(FLEET_CHANNEL, null),
    });
    const service = new EscalationProfilesService(
      fakeFleet(rec, { existing: [{ organizationId: ORG_A, code: "after-hours", name: "After hours" }] }),
      fakeTenant(rec, {
        updatedRow: PROFILE_ROW,
        stepRows: [
          { stepNo: 1, afterMinutes: 5, channelId: CHANNEL_A },
          { stepNo: 2, afterMinutes: 30, channelId: FLEET_CHANNEL },
        ],
      }),
      channels,
      accessControl("admin", null),
    );

    const dto = await service.update(ADMIN, PROFILE_ID, {
      steps: [
        { afterMinutes: 5, channelIds: [CHANNEL_A] },
        { afterMinutes: 30, channelIds: [FLEET_CHANNEL] },
      ],
    });

    const stepInsert = rec.inserts.find((row) => row.table === alarmEscalationSteps);
    assert(stepInsert !== undefined, "the ladder is replaced, not patched");
    assert(
      JSON.stringify((stepInsert?.values as { stepNo: number }[]).map((s) => s.stepNo)) === "[1,2]",
      "step numbers are the 1-based positions the server assigns",
    );
    assert(
      rec.deletes.includes(alarmEscalationSteps),
      "replace-all deletes the old ladder first (the step_channels rows cascade)",
    );
    assert(
      rec.inserts.some((row) => row.table === alarmEscalationStepChannels),
      "each step's channels are re-inserted",
    );
    assert(dto?.steps.length === 2, "the response carries the stored ladder");
    assert(
      dto?.steps[1]?.channelIds[0] === FLEET_CHANNEL,
      "a fleet-wide channel is a legitimate step target",
    );
    assert(rec.audits.length === 1, "one audit row per write");
  }

  // --- an unknown profile is a null, which the controller turns into a 404 --
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec, { existing: [] }),
      fakeTenant(rec),
      channels,
      accessControl("admin", null),
    );
    assert(
      (await service.update(ADMIN, PROFILE_ID, { name: "x" })) === null,
      "update of an unknown profile answers null",
    );
    assert((await service.remove(ADMIN, PROFILE_ID)) === false, "remove of an unknown profile answers false");
    assert(rec.transactions === 0, "neither opened a transaction");
  }

  // --- deleting a profile a severity still maps to is a 409, not a 500 ------
  //
  // `alarm_escalation_defaults.profile_id` is NO ACTION by design (D6): the map
  // must not be silently emptied by a delete. Untranslated that is an
  // "Internal server error" on the admin screen, which is the failure
  // `ChannelsService.remove` already has a recorded incident for.
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec, { existing: [{ organizationId: ORG_A, code: "after-hours", name: "After hours" }] }),
      fakeTenant(rec, { failWith: { code: "23503", constraint: "alarm_escalation_defaults_profile_id_fk" } }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () => service.remove(ADMIN, PROFILE_ID),
      (e) => e instanceof ConflictException && /severity/i.test((e as Error).message),
      "deleting a profile a severity still maps to",
    );
  }

  // --- a duplicate code is a 409 that names the scope -----------------------
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { failWith: { code: "23505" } }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () => service.create(ADMIN, { organizationId: ORG_A, code: "after-hours", name: "After hours", steps: [] }),
      (e) => e instanceof ConflictException && /organization/i.test((e as Error).message),
      "a profile code already used in the organization",
    );
  }

  // --- the severity foreign key is the vocabulary, and it answers 400 -------
  //
  // D11: `alarm_escalation_defaults.severity → alarm_severities(code)` is what
  // validates a severity, which is what keeps `NotificationsModule` free of a
  // `VocabulariesModule` import. That is only true if the violation is
  // translated rather than surfacing as a 500.
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, {
        visibleProfileIds: [PROFILE_ID],
        failWith: { code: "23503", constraint: "alarm_escalation_defaults_severity_fk" },
      }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () =>
        service.setDefaults(ADMIN, {
          organizationId: ORG_A,
          items: [{ severity: "urgent", profileId: PROFILE_ID }],
        }),
      (e) => e instanceof BadRequestException && /severity/i.test((e as Error).message),
      "a severity the vocabulary does not declare",
    );
  }

  // --- a profile from another organization never reaches the policy ---------
  //
  // Under `withTenant(orgB)` the `0066` parent leg refuses the row with a
  // 42501 row-level-security error, which no SQLSTATE translation catches and
  // which reads as a 500. The service asks first, under the same GUC, so a
  // profile the organization cannot see is a 400 that says so — and the policy
  // stays the floor, proven in the RLS integration spec rather than relied on
  // for the message.
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, { visibleProfileIds: [] }),
      channels,
      accessControl("admin", null),
    );
    await rejectsWith(
      () =>
        service.setDefaults(ADMIN, {
          organizationId: ORG_A,
          items: [{ severity: "critical", profileId: PROFILE_ID }],
        }),
      (e) =>
        e instanceof BadRequestException &&
        (e as Error).message.includes(PROFILE_ID) &&
        /this organization/i.test((e as Error).message),
      "a severity mapped to another organization's profile",
    );
    assert(
      !rec.inserts.some((row) => row.table === alarmEscalationDefaults),
      "no defaults row was inserted",
    );
  }

  // --- the happy severity map, and its audit row ---------------------------
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec),
      fakeTenant(rec, {
        visibleProfileIds: [PROFILE_ID],
        defaultRows: [{ severity: "critical", profileId: PROFILE_ID, profileCode: "after-hours" }],
      }),
      channels,
      accessControl("organization_admin", [ORG_A]),
    );
    const response = await service.setDefaults(ORG_ADMIN, {
      items: [{ severity: "critical", profileId: PROFILE_ID }],
    });
    assert(response.organizationId === ORG_A, "the single grant resolves the target organization");
    assert(
      response.items[0]?.profileCode === "after-hours",
      "the response carries the profile code the page renders",
    );
    assert(rec.deletes.includes(alarmEscalationDefaults), "the map is replaced, not merged");
    assert(
      rec.audits[0]?.entityType === "alarm_escalation_defaults",
      "the map's audit row has its own entity type",
    );
    assert(
      (rec.audits[0]?.payload as { itemCount?: number }).itemCount === 1,
      "the audit payload counts the mappings rather than restating them all",
    );
  }

  // --- the read gate is the write gate --------------------------------------
  //
  // The 2026-08-27 ruling recorded on `ChannelsService.list`: a
  // `location_admin` resolves to a real, non-empty `writableOrganizationIds`
  // through `locationDerivedOrganizationIds`, so a read gated on scope alone
  // would hand back configuration that `canManageNotificationChannel` refuses
  // on the very same row. D8 says this surface is gated like the channel
  // admin, so the same fork applies here.
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      // Deliberately NOT empty: with the role fork missing,
      // `writableOrganizationIds` resolves a `location_admin` to a real,
      // non-empty set and the read runs — so an empty fixture here would let
      // the assertion below pass on the strength of the fixture rather than
      // the gate.
      fakeFleet(rec, {
        listRows: [{ ...PROFILE_ROW, stepNo: null, afterMinutes: null, channelId: null }],
      }),
      fakeTenant(rec),
      channels,
      accessControl("location_admin", [ORG_A]),
    );
    assert((await service.list(LOCATION_ADMIN)).length === 0, "a location_admin sees no profiles");
    await rejectsWith(
      () => service.getDefaults(LOCATION_ADMIN, ORG_A),
      (e) => e instanceof ForbiddenException,
      "a location_admin reading another surface's severity map",
    );
  }

  // --- list groups the join back into profiles with their ladders -----------
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const service = new EscalationProfilesService(
      fakeFleet(rec, {
        listRows: [
          { ...PROFILE_ROW, stepNo: 1, afterMinutes: 5, channelId: CHANNEL_A },
          { ...PROFILE_ROW, stepNo: 1, afterMinutes: 5, channelId: FLEET_CHANNEL },
          { ...PROFILE_ROW, stepNo: 2, afterMinutes: 30, channelId: null },
          { ...PROFILE_ROW, id: "dddddddd-0000-4000-8000-00000000000d", code: "day", stepNo: null, afterMinutes: null, channelId: null },
        ],
      }),
      fakeTenant(rec),
      channels,
      accessControl("admin", null),
    );
    const items = await service.list(ADMIN);
    assert(items.length === 2, "one item per profile, however many join rows it produced");
    assert(items[0]?.steps.length === 2, "the two steps are grouped under their profile");
    assert(
      JSON.stringify(items[0]?.steps[0]?.channelIds) === JSON.stringify([CHANNEL_A, FLEET_CHANNEL]),
      "both of a step's channels survive the grouping",
    );
    assert(
      items[0]?.steps[1]?.channelIds.length === 0,
      "a step whose left join found no channel is a step with no channels, not a null",
    );
    assert(items[1]?.steps.length === 0, "a profile with no ladder is an empty array, not a phantom step");
  }

  // --- two organizations may use the SAME code, and the join interleaves ----
  //
  // The unique key is `(organization_id, code)`, so `after-hours` in ESKOM and
  // `after-hours` in PHEWB are two different profiles — and `list` orders by
  // `code`, which is exactly what puts their rows next to each other. Grouping
  // on the code, or assuming one profile's rows arrive contiguously, would
  // merge two tenants' ladders into one item on a global admin's screen. The
  // fixture below interleaves them deliberately; with distinct codes it could
  // not tell a correct implementation from that one.
  {
    const rec = recorder();
    const { channels } = channelsService({});
    const OTHER_ID = "dddddddd-0000-4000-8000-00000000000d";
    const service = new EscalationProfilesService(
      fakeFleet(rec, {
        listRows: [
          { ...PROFILE_ROW, stepNo: 1, afterMinutes: 5, channelId: CHANNEL_A },
          { ...PROFILE_ROW, id: OTHER_ID, organizationId: ORG_B, stepNo: 1, afterMinutes: 9, channelId: CHANNEL_B },
          { ...PROFILE_ROW, stepNo: 2, afterMinutes: 30, channelId: CHANNEL_A },
        ],
      }),
      fakeTenant(rec),
      channels,
      accessControl("admin", null),
    );
    const items = await service.list(ADMIN);
    assert(items.length === 2, "two organizations sharing a code are two profiles");
    const a = items.find((item) => item.organizationId === ORG_A);
    const b = items.find((item) => item.organizationId === ORG_B);
    assert(a?.steps.length === 2, "org A keeps both of its steps despite the interleaving");
    assert(
      b?.steps.length === 1 && b.steps[0]?.afterMinutes === 9,
      "org B's single step is its own, not org A's step 1",
    );
    assert(
      JSON.stringify(b?.steps[0]?.channelIds) === JSON.stringify([CHANNEL_B]),
      "and it carries org B's channel, not a merge of both tenants'",
    );
  }
}
