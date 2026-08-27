import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";

import { notificationChannels, users, userOrganizationAccess } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, NotificationChannelDto, UserRole } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { ChannelsService } from "./channels.service";
import { NotificationsController } from "./notifications.controller";
import {
  createNotificationChannelBodySchema,
  updateNotificationChannelBodySchema,
} from "./notifications.schema";
import { buildConfig } from "./notifications.config";
import type { NotificationChannelRow } from "./notification-transport";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(
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

const ADMIN = { sub: "u1", email: "u1@bms.local", name: "U1", role: "admin" } as JwtPayload;
const OPERATOR = { sub: "u2", email: "u2@bms.local", name: "U2", role: "operator" } as JwtPayload;
const CHANNEL_ID = "33333333-3333-3333-3333-333333333333";
const OWN_ORG_ID = "aaaaaaaa-0000-0000-0000-00000000000a";
const OTHER_ORG_ID = "bbbbbbbb-0000-0000-0000-00000000000b";

const dto: NotificationChannelDto = {
  id: CHANNEL_ID,
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.com/x" },
  enabled: true,
  hasSecret: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const channelRow: NotificationChannelRow = {
  id: CHANNEL_ID,
  organizationId: OWN_ORG_ID,
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.com/x" },
  secret: "s".repeat(16),
  secretState: "ready",
  enabled: true,
};

type Ctor = ConstructorParameters<typeof NotificationsController>;

/**
 * `E7.1c`: gating moved out of the controller (`assertAdmin` is gone) and
 * into `ChannelsService`, which resolves the database role itself via
 * `AccessControlService.requireMasterDataUser`/`canManageNotificationChannel`
 * — every one of those methods calls `resolveDbUser`, never trusting
 * `jwt.role`. `guard` mirrors that same refusal at the fake layer, so this
 * suite still proves a role outside the master-data set is refused on every
 * route, without re-wiring a real `AccessControlService` for the breadth
 * check (the org-scope depth check below does use the real services).
 */
function guard<T>(user: JwtPayload, run: () => Promise<T>): Promise<T> {
  if (user.role !== "admin" && user.role !== "organization_admin" && user.role !== "location_admin") {
    return Promise.reject(
      new ForbiddenException(
        "Master data administration requires admin, organization_admin, or location_admin role",
      ),
    );
  }
  return run();
}

function controllerWith(options: {
  channels?: Partial<Record<string, unknown>>;
  notifications?: Partial<Record<string, unknown>>;
  env?: NodeJS.ProcessEnv;
}): NotificationsController {
  const channels = {
    list: (user: JwtPayload) => guard(user, () => Promise.resolve([dto])),
    loadById: (user: JwtPayload) => guard(user, () => Promise.resolve(channelRow)),
    create: (user: JwtPayload) => guard(user, () => Promise.resolve(dto)),
    update: (user: JwtPayload) => guard(user, () => Promise.resolve(dto)),
    remove: (user: JwtPayload) => guard(user, () => Promise.resolve(true)),
    listDeliveries: (user: JwtPayload) => guard(user, () => Promise.resolve({ items: [] })),
    readiness: (config: ReturnType<typeof buildConfig>) =>
      Promise.resolve([{ kind: "email", configured: config.smtp !== null, detail: "…" }]),
    ...options.channels,
  } as unknown as Ctor[0];

  const notifications = {
    sendTest: () => Promise.resolve({ status: "sent" as const, error: null }),
    ...options.notifications,
  } as unknown as Ctor[1];

  return new NotificationsController(channels, notifications, buildConfig(options.env ?? {}));
}

/**
 * A fake `authDb` answering `resolveDbUser` with a fixed role, and a fake
 * `fleetDb` answering the three shapes `ChannelsService.loadById` and
 * `AccessControlService.writableOrganizationIds` need — distinguished by
 * TABLE identity (the actual `@bms/db` table objects), not by inspecting the
 * built `WHERE` clause, so one fake correctly answers three different queries
 * without parsing drizzle's SQL AST.
 */
function realGateController(
  role: UserRole,
  channelOrganizationId: string | null,
  ownOrgIds: string[] = [],
): { controller: NotificationsController; jwt: JwtPayload } {
  const jwt = { sub: "u1", email: "u1@bms.local", name: "U1", role } as JwtPayload;

  const authDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{ id: "u1", email: "u1@bms.local", displayName: "U1", role }]),
        }),
      }),
    }),
  } as unknown as BmsDb;

  const fleetDb = {
    select: () => ({
      from: (table: unknown) => {
        if (table === userOrganizationAccess) {
          return { where: () => Promise.resolve(ownOrgIds.map((id) => ({ id }))) };
        }
        if (table === users) {
          return { where: () => ({ limit: () => Promise.resolve([{ id: "u1" }]) }) };
        }
        if (table !== notificationChannels) {
          throw new Error(`realGateController: unexpected table in a fleetDb.select().from(...)`);
        }
        return {
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: CHANNEL_ID,
                  organizationId: channelOrganizationId,
                  code: "ops-webhook",
                  name: "Operations webhook",
                  kind: "webhook",
                  config: { url: "https://hooks.example.com/x" },
                  enabled: true,
                  secretCiphertext: null,
                  secretIv: null,
                  secretKeyVersion: null,
                },
              ]),
          }),
        };
      },
    }),
  } as unknown as BmsDb;

  const accessControl = new AccessControlService(authDb, fleetDb);
  // secretCiphertext is null above, so toChannelRow never reaches crypto.
  const channels = new ChannelsService(
    fleetDb,
    {} as unknown as BmsDb,
    {} as unknown as ConstructorParameters<typeof ChannelsService>[2],
    accessControl,
  );
  const notifications = {
    sendTest: () => Promise.resolve({ status: "sent" as const, error: null }),
  } as unknown as Ctor[1];

  return {
    controller: new NotificationsController(
      channels as unknown as Ctor[0],
      notifications,
      buildConfig({}),
    ),
    jwt,
  };
}

/**
 * `F3.8` U7 — the notifications controller.
 *
 * Two properties are worth a test each, and they are the ones a refactor
 * breaks silently: which routes are admin-only, and that a channel response
 * never carries a secret.
 */
export async function runNotificationsControllerTests(): Promise<void> {
  // --- authorisation -------------------------------------------------------
  {
    const controller = controllerWith({});
    // Every channel and delivery route is admin-only.
    await rejects(
      () => controller.listChannels(OPERATOR),
      (e) => e instanceof ForbiddenException,
      "listing channels as an operator",
    );
    // A VALID body, deliberately: `createChannel` now parses the body before
    // calling `channels.create` (matching `PointKeysAdminController`'s own
    // convention — `service.create(user, schema.parse(body))` inline), so an
    // invalid body would throw `BadRequestException` before the gate inside
    // `create` ever ran, and the test would prove nothing about authorization.
    await rejects(
      () =>
        controller.createChannel(OPERATOR, {
          code: "ops-test",
          name: "Operations test",
          kind: "webhook",
        }),
      (e) => e instanceof ForbiddenException,
      "creating a channel as an operator",
    );
    await rejects(
      () => controller.updateChannel(OPERATOR, CHANNEL_ID, { name: "x" }),
      (e) => e instanceof ForbiddenException,
      "patching a channel as an operator",
    );
    await rejects(
      () => controller.deleteChannel(OPERATOR, CHANNEL_ID),
      (e) => e instanceof ForbiddenException,
      "deleting a channel as an operator",
    );
    await rejects(
      () => controller.testChannel(OPERATOR, CHANNEL_ID),
      (e) => e instanceof ForbiddenException,
      "sending a test as an operator",
    );
    await rejects(
      () => controller.listDeliveries(OPERATOR, {}),
      (e) => e instanceof ForbiddenException,
      "reading the ledger as an operator",
    );

    // Readiness is authenticated but NOT admin-only (decision 10): the operator
    // editing a rule marked `notify` is who must see that nothing is
    // configured. Deliberately asserted, because "tighten it for consistency"
    // is the obvious-looking change that breaks the banner.
    const readiness = await controller.readiness();
    assert(readiness.items.length > 0, "readiness must answer for a non-admin");
    assert(
      readiness.items.every((item: unknown) => !JSON.stringify(item).includes("SMTP_PASSWORD")),
      "readiness must disclose no credential",
    );
  }

  // --- authorisation, in depth: the org-scope matrix ------------------------
  //
  // `E7.1c` (ADR 0043 Amendment 5, decision 7). `guard` above only proves a
  // route is gated AT ALL; it cannot show a gate that answers `true` for the
  // wrong organization would still be caught, because it never varies the
  // organization. These four cases wire the REAL `ChannelsService` and
  // `AccessControlService` (backed by lightweight fakes, not a database)
  // through `testChannel`, so the actual `canManageNotificationChannel`
  // decision — not a stand-in for it — is what each assertion depends on.
  {
    // (1) a role outside the master-data set: assertMasterDataRole THROWS,
    // the same "not a false" shape access-control.service.spec.ts pins.
    const outsideRole = realGateController("viewer", OWN_ORG_ID);
    await rejects(
      () => outsideRole.controller.testChannel(outsideRole.jwt, CHANNEL_ID),
      (e) => e instanceof ForbiddenException,
      "a viewer is refused outright, before any organization is even compared",
    );

    // (2) organization_admin against ANOTHER organization's channel: refused.
    const wrongOrg = realGateController("organization_admin", OTHER_ORG_ID, [OWN_ORG_ID]);
    await rejects(
      () => wrongOrg.controller.testChannel(wrongOrg.jwt, CHANNEL_ID),
      (e) => e instanceof ForbiddenException,
      "an organization_admin may not test another organization's channel",
    );

    // (2b) organization_admin against a fleet-managed GLOBAL (NULL-org)
    // channel: also refused — a global row is fleet business, not a tenant's.
    const globalChannel = realGateController("organization_admin", null, [OWN_ORG_ID]);
    await rejects(
      () => globalChannel.controller.testChannel(globalChannel.jwt, CHANNEL_ID),
      (e) => e instanceof ForbiddenException,
      "an organization_admin may not test a fleet-managed global channel",
    );

    // (3) organization_admin against its OWN organization's channel: allowed.
    const ownOrg = realGateController("organization_admin", OWN_ORG_ID, [OWN_ORG_ID]);
    const result = await ownOrg.controller.testChannel(ownOrg.jwt, CHANNEL_ID);
    assert(result.status === "sent", "an organization_admin may test its own organization's channel");
  }

  // --- a channel response never carries a secret ---------------------------
  {
    const controller = controllerWith({});
    const listed = await controller.listChannels(ADMIN);
    const serialised = JSON.stringify(listed);
    assert(
      serialised.includes('"hasSecret":true'),
      "the response says whether a secret is set",
    );
    for (const forbidden of ["secret\":\"", "secretCiphertext", "secretIv", "secretKeyVersion"]) {
      assert(
        !serialised.includes(forbidden),
        `a channel response carried ${forbidden} — §9.6 and decision 8 allow hasSecret only`,
      );
    }
  }

  // --- validation ----------------------------------------------------------
  {
    const controller = controllerWith({});
    await rejects(
      () => controller.createChannel(ADMIN, { code: "Ops Webhook", name: "x", kind: "webhook" }),
      (e) => e instanceof BadRequestException,
      "a code with spaces and capitals",
    );
    await rejects(
      () => controller.createChannel(ADMIN, { name: "x", kind: "webhook" }),
      (e) => e instanceof BadRequestException,
      "a body with no code",
    );
    // An empty PATCH reads as "I changed something" and changes nothing.
    await rejects(
      () => controller.updateChannel(ADMIN, CHANNEL_ID, {}),
      (e) => e instanceof BadRequestException,
      "an empty PATCH",
    );
    await rejects(
      () => controller.updateChannel(ADMIN, "not-a-uuid", { name: "x" }),
      (e) => e instanceof BadRequestException,
      "a non-uuid id",
    );
  }

  // --- 404s ----------------------------------------------------------------
  {
    const missing = controllerWith({
      channels: {
        update: () => Promise.resolve(null),
        remove: () => Promise.resolve(false),
        loadById: () => Promise.resolve(null),
      },
    });
    await rejects(
      () => missing.updateChannel(ADMIN, CHANNEL_ID, { name: "x" }),
      (e) => e instanceof NotFoundException,
      "patching a channel that does not exist",
    );
    await rejects(
      () => missing.deleteChannel(ADMIN, CHANNEL_ID),
      (e) => e instanceof NotFoundException,
      "deleting a channel that does not exist",
    );
    await rejects(
      () => missing.testChannel(ADMIN, CHANNEL_ID),
      (e) => e instanceof NotFoundException,
      "testing a channel that does not exist",
    );
  }

  // --- the send test reports the real outcome ------------------------------
  {
    const refused = controllerWith({
      notifications: {
        sendTest: () =>
          Promise.resolve({
            status: "failed" as const,
            error: "webhook host grafana resolves to a private, loopback or link-local address",
          }),
      },
    });
    const result = await refused.testChannel(ADMIN, CHANNEL_ID);
    assert(result.status === "failed", "a refused test reports failed");
    assert(
      (result.error ?? "").includes("private"),
      "the refusal reaches whoever is configuring the channel — that is the point of the test button",
    );
    assert(
      !JSON.stringify(result).includes(channelRow.secret ?? ""),
      "the test result must not echo the channel secret",
    );
  }

  // --- the schemas themselves ----------------------------------------------
  {
    const created = createNotificationChannelBodySchema.parse({
      code: "ops-email",
      name: "Operations",
      kind: "email",
    });
    assert(created.enabled === true, "a channel is enabled unless said otherwise");
    assert(
      JSON.stringify(created.config) === "{}",
      "config defaults to an empty object, not undefined",
    );
    // Three distinct intentions on PATCH.
    assert(
      updateNotificationChannelBodySchema.parse({ secret: null }).secret === null,
      "null clears the secret",
    );
    assert(
      updateNotificationChannelBodySchema.parse({ name: "x" }).secret === undefined,
      "an omitted secret keeps the stored one",
    );
    assert(
      updateNotificationChannelBodySchema.safeParse({ secret: "short" }).success === false,
      "a too-short secret is refused",
    );
  }
}
