import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";

import type { JwtPayload, NotificationChannelDto } from "@bms/shared";

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

const ADMIN = { sub: "u1", role: "admin" } as unknown as JwtPayload;
const OPERATOR = { sub: "u2", role: "operator" } as unknown as JwtPayload;
const CHANNEL_ID = "33333333-3333-3333-3333-333333333333";

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
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.com/x" },
  secret: "s".repeat(16),
  secretState: "ready",
  enabled: true,
};

type Ctor = ConstructorParameters<typeof NotificationsController>;

function controllerWith(options: {
  channels?: Partial<Record<string, unknown>>;
  notifications?: Partial<Record<string, unknown>>;
  env?: NodeJS.ProcessEnv;
}): NotificationsController {
  const channels = {
    list: () => Promise.resolve([dto]),
    loadById: () => Promise.resolve(channelRow),
    create: () => Promise.resolve(dto),
    update: () => Promise.resolve(dto),
    remove: () => Promise.resolve(true),
    listDeliveries: () => Promise.resolve({ items: [] }),
    readiness: (config: ReturnType<typeof buildConfig>) =>
      Promise.resolve([{ kind: "email", configured: config.smtp !== null, detail: "…" }]),
    ...options.channels,
  } as unknown as Ctor[0];

  const notifications = {
    sendTest: () => Promise.resolve({ status: "sent" as const, error: null }),
    ...options.notifications,
  } as unknown as Ctor[1];

  const accessControl = {
    assertAdminRole: (role: string) => {
      if (role !== "admin") throw new ForbiddenException("admin only");
    },
  } as unknown as Ctor[2];

  return new NotificationsController(
    channels,
    notifications,
    accessControl,
    buildConfig(options.env ?? {}),
  );
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
    await rejects(
      () => controller.createChannel(OPERATOR, {}),
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
