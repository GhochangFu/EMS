import { describe, expect, it } from "vitest";

import {
  assertDatabaseName,
  buildTemplate,
  copyDatabase,
  dropRunDatabases,
} from "./harness/template-database";
import { testInfraMode } from "./harness/test-infra-mode";
import {
  resolveRoleUrls,
  withDatabase,
  workerDatabaseEnv,
  workerDatabaseName,
} from "./harness/worker-database";

/**
 * `F4.5` (ADR 0124) — the pure half of the integration-test harness.
 *
 * `testInfraMode` is the one verdict the global setup reads (ADR 0124 decision 5,
 * ruling 6). `workerDatabaseEnv` is what a worker's setup file writes into
 * `process.env` before a test file imports, so every role URL a suite derives
 * names that worker's own database. The container half is exercised by
 * `f4.5-test-harness.integration.test.ts`.
 */

const COMPOSE = "postgres://bms_owner:bms_owner_dev@localhost:5432/bms";

describe("testInfraMode (ADR 0124 decision 5)", () => {
  it("uses containers when nothing is set and Docker answers", () => {
    expect(testInfraMode({}, true)).toEqual({ kind: "containers" });
  });

  it("skips locally when nothing is set and Docker does not answer", () => {
    const verdict = testInfraMode({}, false);
    expect(verdict.kind).toBe("skip");
  });

  it("refuses under CI when nothing is set and Docker does not answer", () => {
    expect(testInfraMode({ CI: "true" }, false).kind).toBe("refuse");
    expect(testInfraMode({ CI: "1" }, false).kind).toBe("refuse");
  });

  it("lets a set DATABASE_URL win over Docker, with per-worker copies", () => {
    expect(testInfraMode({ DATABASE_URL: COMPOSE }, true)).toEqual({
      kind: "external",
      databaseUrl: COMPOSE,
      isolate: true,
    });
  });

  it("keeps the single shared database only when asked for by name", () => {
    expect(testInfraMode({ DATABASE_URL: COMPOSE, BMS_TEST_DB: "shared" }, true)).toEqual({
      kind: "external",
      databaseUrl: COMPOSE,
      isolate: false,
    });
  });

  it("lets BMS_TEST_DB=containers win over a set DATABASE_URL (the CI test step)", () => {
    expect(testInfraMode({ DATABASE_URL: COMPOSE, BMS_TEST_DB: "containers", CI: "true" }, true)).toEqual({
      kind: "containers",
    });
  });

  it("uses a set DATABASE_URL under CI even without Docker, rather than refusing", () => {
    expect(testInfraMode({ CI: "true", DATABASE_URL: COMPOSE }, false).kind).toBe("external");
  });

  it("refuses BMS_TEST_DB=containers without Docker, locally as well as in CI", () => {
    expect(testInfraMode({ BMS_TEST_DB: "containers" }, false).kind).toBe("refuse");
  });

  it("refuses BMS_TEST_DB=external or shared without a DATABASE_URL", () => {
    expect(testInfraMode({ BMS_TEST_DB: "external" }, true).kind).toBe("refuse");
    expect(testInfraMode({ BMS_TEST_DB: "shared" }, true).kind).toBe("refuse");
  });

  it("refuses an unknown BMS_TEST_DB value rather than guessing", () => {
    expect(testInfraMode({ BMS_TEST_DB: "container" }, true).kind).toBe("refuse");
  });

  it("treats a whitespace-only DATABASE_URL as unset", () => {
    expect(testInfraMode({ DATABASE_URL: "   " }, true)).toEqual({ kind: "containers" });
  });
});

describe("workerDatabaseName", () => {
  it("names the worker's database from VITEST_POOL_ID", () => {
    expect(workerDatabaseName("1")).toBe("bms_w1");
    expect(workerDatabaseName("15")).toBe("bms_w15");
  });

  it("refuses a pool id outside 1–15, the Redis indexes this harness may use", () => {
    expect(() => workerDatabaseName("0")).toThrow(/VITEST_POOL_ID/);
    expect(() => workerDatabaseName("16")).toThrow(/VITEST_POOL_ID/);
  });

  it("puts an external run's prefix in front, so two runs on one server cannot collide", () => {
    expect(workerDatabaseName("2", "bms_tab12cd")).toBe("bms_tab12cd_w2");
  });

  it("refuses a prefix that is not bms or bms_t<run id>", () => {
    expect(() => workerDatabaseName("1", "postgres")).toThrow(/prefix/);
    expect(() => workerDatabaseName("1", 'bms"; DROP')).toThrow(/prefix/);
  });

  it("refuses a missing or non-numeric pool id", () => {
    expect(() => workerDatabaseName(undefined)).toThrow(/VITEST_POOL_ID/);
    expect(() => workerDatabaseName("1; DROP DATABASE bms")).toThrow(/VITEST_POOL_ID/);
  });
});

describe("withDatabase", () => {
  it("swaps only the database name", () => {
    expect(withDatabase("postgres://u:p@h:5432/bms?sslmode=disable", "bms_w2")).toBe(
      "postgres://u:p@h:5432/bms_w2?sslmode=disable",
    );
  });
});

describe("resolveRoleUrls", () => {
  it("derives each role from DATABASE_URL with the dev password, as the suites do", () => {
    const urls = resolveRoleUrls({ DATABASE_URL: COMPOSE });
    expect(urls.owner).toBe(COMPOSE);
    expect(urls.superuser).toBe("postgres://bms_app:bms_app_dev@localhost:5432/bms");
    expect(urls.fleet).toBe("postgres://bms_fleet:bms_fleet_dev@localhost:5432/bms");
    expect(urls.auth).toBe("postgres://bms_auth:bms_auth_dev@localhost:5432/bms");
    expect(urls.tenant).toBe("postgres://bms_tenant:bms_tenant_dev@localhost:5432/bms");
  });

  it("treats a blank role URL as unset, as the suites' gate does", () => {
    const urls = resolveRoleUrls({ DATABASE_URL: COMPOSE, DATABASE_URL_FLEET: "", DATABASE_URL_AUTH: "  " });
    expect(urls.fleet).toBe("postgres://bms_fleet:bms_fleet_dev@localhost:5432/bms");
    expect(urls.auth).toBe("postgres://bms_auth:bms_auth_dev@localhost:5432/bms");
  });

  it("keeps an explicit role URL over the derived one", () => {
    const urls = resolveRoleUrls({
      DATABASE_URL: COMPOSE,
      DATABASE_URL_TENANT: "postgres://bms_tenant:other@db:6000/x",
      BMS_FLEET_PASSWORD: "fleet-pw",
    });
    expect(urls.tenant).toBe("postgres://bms_tenant:other@db:6000/x");
    expect(urls.fleet).toBe("postgres://bms_fleet:fleet-pw@localhost:5432/bms");
  });
});

describe("workerDatabaseEnv", () => {
  const env = workerDatabaseEnv(
    resolveRoleUrls({ DATABASE_URL: COMPOSE }),
    "bms_w3",
    "redis://localhost:6379",
    3,
  );

  it("points all five database variables at the worker's database", () => {
    for (const key of [
      "DATABASE_URL",
      "DATABASE_URL_SUPERUSER",
      "DATABASE_URL_FLEET",
      "DATABASE_URL_AUTH",
      "DATABASE_URL_TENANT",
    ]) {
      expect(new URL(env[key] as string).pathname, key).toBe("/bms_w3");
    }
  });

  it("keeps each variable's own role", () => {
    expect(new URL(env.DATABASE_URL as string).username).toBe("bms_owner");
    expect(new URL(env.DATABASE_URL_SUPERUSER as string).username).toBe("bms_app");
    expect(new URL(env.DATABASE_URL_FLEET as string).username).toBe("bms_fleet");
    expect(new URL(env.DATABASE_URL_AUTH as string).username).toBe("bms_auth");
    expect(new URL(env.DATABASE_URL_TENANT as string).username).toBe("bms_tenant");
  });

  it("gives the worker its own Redis index", () => {
    expect(env.REDIS_URL).toBe("redis://localhost:6379/3");
  });
});

/**
 * The guards in front of interpolated SQL (`CREATE DATABASE` takes no parameters). Each refusal
 * happens before a connection is opened, so these run with no database: the URL below points at
 * nothing, and a guard that let a name through would fail on the connection instead of matching
 * `/refusing/`.
 */
describe("database-name guards", () => {
  const NOWHERE = "postgres://bms_app:x@127.0.0.1:1/postgres";

  it("allows the plain names only on a server this run started", () => {
    expect(assertDatabaseName("bms_w1", "own-container")).toBe("bms_w1");
    expect(() => assertDatabaseName("bms_w1", "external")).toThrow(/refusing/);
    expect(() => assertDatabaseName("bms_template", "external")).toThrow(/refusing/);
  });

  it("allows run-prefixed names on either server", () => {
    expect(assertDatabaseName("bms_tab12cd_w3", "external")).toBe("bms_tab12cd_w3");
    expect(assertDatabaseName("bms_tab12cd_template", "own-container")).toBe("bms_tab12cd_template");
  });

  it("refuses a name that could carry SQL", async () => {
    await expect(
      copyDatabase(NOWHERE, "bms_template", 'bms_w1"; DROP DATABASE bms; --', "own-container"),
    ).rejects.toThrow(/refusing/);
  });

  it("refuses the application database and the maintenance database", async () => {
    await expect(copyDatabase(NOWHERE, "bms_template", "bms", "own-container")).rejects.toThrow(/refusing/);
    await expect(copyDatabase(NOWHERE, "bms_template", "postgres", "own-container")).rejects.toThrow(
      /refusing/,
    );
  });

  it("refuses to build an unprefixed template on an external server", async () => {
    await expect(
      buildTemplate(NOWHERE, { server: "external", database: "bms_template", ownerUrl: NOWHERE }),
    ).rejects.toThrow(/refusing/);
  });

  it("refuses to drop databases by the plain bms prefix", async () => {
    await expect(dropRunDatabases(NOWHERE, "bms")).rejects.toThrow(/plain bms/);
  });
});
