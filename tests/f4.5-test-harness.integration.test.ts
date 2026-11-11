import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startRedis, startTimescale, type StartedServer } from "./harness/containers";
import { dockerAnswers } from "./harness/docker";
import { pg, type PgQueryable } from "./harness/pg";
import {
  buildTemplate,
  copyDatabase,
  dropRunDatabases,
  TEMPLATE_DATABASE,
} from "./harness/template-database";
import { testInfraMode } from "./harness/test-infra-mode";
import { resolveRoleUrls, withDatabase, workerDatabaseEnv } from "./harness/worker-database";

/**
 * `F4.5` (ADR 0124) — the container half of the harness, against real containers.
 *
 * Starts its own Timescale and Redis rather than reading the run's, so it proves the path the
 * global setup takes: start → build the template with the CLIs CI runs → copy per worker. The
 * claims are the ones the isolation rests on: a row in one copy is absent from the other; the
 * template cannot be connected to; `FORCE ROW LEVEL SECURITY` still binds `bms_owner` in a copy;
 * one Redis index does not see another's keys.
 *
 * Gated like every integration suite: no Docker skips locally and refuses under `CI`. It reads
 * neither `DATABASE_URL` nor `BMS_TEST_DB` on purpose — it tests the container path whatever the
 * run's own mode is.
 */

const verdict = testInfraMode({ CI: process.env.CI }, await dockerAnswers());
if (verdict.kind === "refuse") {
  throw new Error(`F4.5 harness integration test: ${verdict.reason}`);
}
const run = verdict.kind === "containers";
if (!run) {
  process.stderr.write(
    `\n[F4.5] Skipping the harness integration test: ${verdict.kind === "skip" ? verdict.reason : ""}\n`,
  );
}

describe.runIf(run)("F4.5 harness against real containers", () => {
  let postgres: StartedServer | undefined;
  let redis: StartedServer | undefined;
  const pools: PgQueryable[] = [];
  let w1: PgQueryable;
  let w2: PgQueryable;

  function pool(url: string): PgQueryable {
    const opened = new pg.Pool({ connectionString: url, max: 2 });
    pools.push(opened);
    return opened;
  }

  beforeAll(async () => {
    // allSettled, so a container that did start is kept for afterAll to stop even when the
    // other one failed — CI runs without Ryuk (ADR 0124 decision 7), so nothing else would.
    const [pgStart, redisStart] = await Promise.allSettled([startTimescale(), startRedis()]);
    postgres = pgStart.status === "fulfilled" ? pgStart.value : undefined;
    redis = redisStart.status === "fulfilled" ? redisStart.value : undefined;
    for (const outcome of [pgStart, redisStart]) {
      if (outcome.status === "rejected") throw outcome.reason;
    }
    const server = (postgres as StartedServer).url;
    await buildTemplate(server, { server: "own-container", database: TEMPLATE_DATABASE });
    await copyDatabase(server, TEMPLATE_DATABASE, "bms_w1", "own-container");
    await copyDatabase(server, TEMPLATE_DATABASE, "bms_w2", "own-container");
    w1 = pool(withDatabase(server, "bms_w1"));
    w2 = pool(withDatabase(server, "bms_w2"));
  }, 300_000);

  afterAll(async () => {
    await Promise.allSettled(pools.map((p) => p.end()));
    await Promise.allSettled([postgres?.stop(), redis?.stop()]);
  });

  it("copies the seeded template into each worker database", async () => {
    const one = await w1.query<{ n: string }>("SELECT count(*) AS n FROM bms.assets");
    const two = await w2.query<{ n: string }>("SELECT count(*) AS n FROM bms.assets");
    expect(Number(one.rows[0]?.n)).toBeGreaterThan(0);
    expect(two.rows[0]?.n).toBe(one.rows[0]?.n);
  });

  it("keeps a row written in one worker's database out of the other's", async () => {
    await w1.query(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ('F45-ISOLATION', 'F4.5 isolation probe', 'INR')",
    );
    const inOne = await w1.query("SELECT 1 FROM bms.organizations WHERE code = 'F45-ISOLATION'");
    const inTwo = await w2.query("SELECT 1 FROM bms.organizations WHERE code = 'F45-ISOLATION'");
    expect(inOne.rowCount).toBe(1);
    expect(inTwo.rowCount).toBe(0);
  });

  /**
   * Not the gate for this claim — the copies in `beforeAll` are. Measured (U1 mutations M9–M11):
   * a template left reachable, or reopened after the first copy, makes the *next* `CREATE
   * DATABASE … TEMPLATE` fail with "is being accessed by other users", because TimescaleDB's
   * scheduler connects to it within seconds. So every mutation that breaks this property reddens
   * the hook, and this case states the property for a reader rather than catching a regression.
   */
  it("leaves the template unreachable, so no worker can change it", async () => {
    const template = pool(withDatabase((postgres as StartedServer).url, TEMPLATE_DATABASE));
    await expect(template.query("SELECT 1")).rejects.toThrow(/not currently accepting connections/);
  });

  it("still binds bms_owner with FORCE ROW LEVEL SECURITY in a copy", async () => {
    const ownerUrl = new URL((postgres as StartedServer).url);
    ownerUrl.username = "bms_owner";
    ownerUrl.password = "bms_owner_dev";
    const env = workerDatabaseEnv(
      resolveRoleUrls({ DATABASE_URL: ownerUrl.toString() }),
      "bms_w1",
      (redis as StartedServer).url,
      1,
    );
    const owner = new pg.Client({ connectionString: env.DATABASE_URL as string });
    const fleet = new pg.Client({ connectionString: env.DATABASE_URL_FLEET as string });
    await Promise.all([owner.connect(), fleet.connect()]);
    try {
      const ownerRows = await owner.query<{ n: string }>("SELECT count(*) AS n FROM bms.assets");
      const fleetRows = await fleet.query<{ n: string }>("SELECT count(*) AS n FROM bms.assets");
      expect(Number(ownerRows.rows[0]?.n)).toBe(0);
      expect(Number(fleetRows.rows[0]?.n)).toBeGreaterThan(0);
    } finally {
      await Promise.allSettled([owner.end(), fleet.end()]);
    }
  });

  it("keeps a Redis key on one worker's index off another's", async () => {
    const { createClient } = await import("./harness/redis-probe");
    const url = (redis as StartedServer).url;
    const one = await createClient(`${url}/1`);
    const two = await createClient(`${url}/2`);
    try {
      await one.set("f45:probe", "1");
      expect(await one.get("f45:probe")).toBe("1");
      expect(await two.get("f45:probe")).toBeNull();
    } finally {
      await Promise.allSettled([one.quit(), two.quit()]);
    }
  });

  /**
   * The external mode end to end (PR 2 code review, finding 1): this container stands in for a
   * server someone else owns. Roles already exist there (`beforeAll` ran `db:roles`), so the
   * external build skips it and seeds with the caller's own `bms_owner` URL — the shape CI's
   * service database and a developer's compose database take once a suite leaves the list.
   */
  it("builds, copies and drops a run-prefixed set on an external server, leaving its other databases", async () => {
    const server = (postgres as StartedServer).url;
    const prefix = "bms_tf45ext01";
    const owner = new URL(server);
    owner.username = "bms_owner";
    owner.password = "bms_owner_dev";

    await buildTemplate(server, { server: "external", database: `${prefix}_template`, ownerUrl: owner.toString() });
    await copyDatabase(server, `${prefix}_template`, `${prefix}_w1`, "external");
    await copyDatabase(server, `${prefix}_template`, `${prefix}_w2`, "external");

    const one = pool(withDatabase(server, `${prefix}_w1`));
    const two = pool(withDatabase(server, `${prefix}_w2`));
    await one.query(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ('F45-EXT', 'F4.5 external probe', 'INR')",
    );
    expect((await one.query("SELECT 1 FROM bms.organizations WHERE code = 'F45-EXT'")).rowCount).toBe(1);
    expect((await two.query("SELECT 1 FROM bms.organizations WHERE code = 'F45-EXT'")).rowCount).toBe(0);
    await Promise.all([one.end(), two.end()]);
    pools.splice(pools.indexOf(one), 1);
    pools.splice(pools.indexOf(two), 1);

    await dropRunDatabases(server, prefix);

    const maintenance = pool(withDatabase(server, "postgres"));
    const left = await maintenance.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'bms%' ORDER BY datname",
    );
    const names = left.rows.map((row) => row.datname);
    expect(names.filter((name) => name.startsWith(prefix))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining([TEMPLATE_DATABASE, "bms_w1", "bms_w2"]));
  }, 180_000);
});
