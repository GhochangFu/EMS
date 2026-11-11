import { randomBytes } from "node:crypto";

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

/**
 * `F4.5` (ADR 0124 decision 1, rulings 1, 2, 5) — one TimescaleDB and one Redis per test run.
 *
 * The tags are the ones `docker-compose.yml` and CI's `services:` pin, so the suites run on the
 * engine everything else runs (ADR 0023 decision 4, ADR 0063 decision 13). The server flags:
 *
 * - `max_worker_processes` and `timescaledb.max_background_workers` are raised above compose's
 *   because every worker database runs its own TimescaleDB scheduler and jobs (ADR 0024 records
 *   the silent per-job failure an exhausted budget causes). Measured in U1: 12 jobs per
 *   database, one scheduler per database, all policies `Success` in a copy.
 * - `timescaledb.telemetry_level=off`: the "Telemetry Reporter" job phones home and fails
 *   wherever outbound traffic is blocked, which is not a failure of anything under test.
 * - Redis keeps compose's `noeviction` (ADR 0063: an evicting Redis may drop a queued job).
 *
 * **Passwords are random per run** (security review of PR 1, M1 and L1). testcontainers
 * publishes an exposed port on every host interface and has no option to bind loopback only, so
 * a container started here is reachable from the developer's network for the length of the run.
 * Compose binds Redis to `127.0.0.1` for this reason (ADR 0063 Amendment 2); a random
 * `requirepass` and a random Postgres superuser password are the equivalent here. The four
 * application roles keep their dev passwords, as on compose.
 */

export const TIMESCALE_IMAGE = "timescale/timescaledb:2.29.1-pg16";
export const REDIS_IMAGE = "redis:7-alpine";

/** The superuser the image creates; `db:roles` and `db:migrate` connect as it, as in CI. */
export const SUPERUSER_NAME = "bms_app";

export type StartedServer = {
  /** `postgres://bms_app:<random>@host:port/<initial db>` or `redis://:<random>@host:port`. */
  readonly url: string;
  stop(): Promise<void>;
};

function randomPassword(): string {
  return randomBytes(18).toString("hex");
}

function started(container: StartedTestContainer, url: string): StartedServer {
  return {
    url,
    stop: async () => {
      await container.stop();
    },
  };
}

/** Starts the pinned TimescaleDB image with this harness's server flags and a random superuser password. */
export async function startTimescale(initialDatabase = "postgres"): Promise<StartedServer> {
  const password = randomPassword();
  const container = await new GenericContainer(TIMESCALE_IMAGE)
    .withEnvironment({
      POSTGRES_DB: initialDatabase,
      POSTGRES_USER: SUPERUSER_NAME,
      POSTGRES_PASSWORD: password,
    })
    .withCommand([
      "postgres",
      "-c",
      "max_worker_processes=48",
      "-c",
      "timescaledb.max_background_workers=40",
      "-c",
      "timescaledb.telemetry_level=off",
    ])
    .withExposedPorts(5432)
    // The entrypoint starts a temporary server for init scripts, stops it, then starts the real
    // one — so "ready" is logged twice and only the second means the port is the real server.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120_000)
    .start();
  const url = new URL(`postgres://${container.getHost()}:${container.getMappedPort(5432)}/${initialDatabase}`);
  url.username = SUPERUSER_NAME;
  url.password = password;
  return started(container, url.toString());
}

/** Starts the pinned Redis image with compose's flags and a random `requirepass`. */
export async function startRedis(): Promise<StartedServer> {
  const password = randomPassword();
  const container = await new GenericContainer(REDIS_IMAGE)
    .withCommand([
      "redis-server",
      "--appendonly",
      "yes",
      "--maxmemory-policy",
      "noeviction",
      "--requirepass",
      password,
    ])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60_000)
    .start();
  return started(container, `redis://:${password}@${container.getHost()}:${container.getMappedPort(6379)}`);
}
