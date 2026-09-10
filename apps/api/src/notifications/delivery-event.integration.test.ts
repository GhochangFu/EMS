import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { NotificationDeliveryDto } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { ChannelsService } from "./channels.service";
import {
  assertsEachRowsEvent,
  assertsTheKeyNeverCrosses,
  assertsTheTwoRateLimitRowsAreToldApart,
  cleanUpDeliveryEventFixture,
  seedDeliveryEventFixture,
  type DeliveryEventFixture,
} from "./delivery-event.integration.spec";

/**
 * `F3.56` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle and the one read.
 *
 * The wrapper ships in the same commit as the spec deliberately: Vitest
 * discovers only `.test` files, so a spec with no wrapper runs nowhere and is
 * excluded from coverage as well. `tests/repo-invariants.test.ts` refused
 * `F3.54` in CI for exactly that.
 */
const connectionString = requireIntegrationDb({
  item: "F3.56",
  label: "ChannelsService.listDeliveries derives the event kind from the dedupe key",
  because:
    "the derivation reads a column the DTO does not carry, off a row Postgres wrote. A fake db " +
    "answers whatever shape it was written to answer, so it cannot show that the `select` gained " +
    "`dedupe_key`, that the real `rule_id`/`alarm_id` NULLs reach the parse, or that the key is " +
    "consumed rather than returned. Row 5's NULL key with a NULL rule is only writable against " +
    "the real `organization_id NOT NULL` and the real status CHECK.",
});

describe.skipIf(!connectionString)(
  "F3.56 — the delivery ledger names the event kind (ADR 0041 Amendment 8)",
  () => {
    let ownerPool: pg.Pool;
    let authPool: pg.Pool;
    let fixture: DeliveryEventFixture;
    let items: NotificationDeliveryDto[];

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F3.56");
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.56",
      );
      const fleetDb: BmsDb = createDb(ownerPool);

      fixture = await seedDeliveryEventFixture(ownerPool);

      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const channels = new ChannelsService(
        fleetDb,
        fleetDb,
        {
          encrypt: () => ({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), keyVersion: 1 }),
        } as unknown as ConstructorParameters<typeof ChannelsService>[2],
        accessControl,
      );

      // ONE read, filtered to this suite's own channel: the ledger is a shared
      // table and an unfiltered read would carry another suite's rows into
      // `assertsTheKeyNeverCrosses`. A global admin, so `errorProjection` is the
      // raw column and rows 4 and 5 really do carry the same error text.
      const response = await channels.listDeliveries(jwtFor(SEEDED.globalAdmin, "admin"), {
        limit: 100,
        channelId: fixture.channelId,
      });
      items = response.items;
    }, 60_000);

    afterAll(async () => {
      if (ownerPool) await cleanUpDeliveryEventFixture(ownerPool);
      await Promise.all([ownerPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("P1 gives each of the six rows its own event kind", () => {
      assertsEachRowsEvent(items, fixture);
    });

    it("P2 tells the two `rate-limit check failed` rows apart by event alone", () => {
      assertsTheTwoRateLimitRowsAreToldApart(items, fixture);
    });

    it("P3 consumes the dedupe key in the `.map()` and never returns it", () => {
      assertsTheKeyNeverCrosses(items, fixture);
    });
  },
);
