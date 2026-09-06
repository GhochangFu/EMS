import { integrationDbVerdict, resolveFleetUrl } from "./integration-db-gate.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The gate's verdict, enumerated over all four environments.
 *
 * This suite is the reason the copy in `integration-db-gate.ts` is safe to have
 * made. Asserting only that `bindings.integration.spec.ts` passes would prove
 * nothing: it passes either way on a machine with `DATABASE_URL` set, which is
 * exactly the environment where an inverted verdict is invisible. The failure
 * this kills is a suite that skips in CI while looking green.
 */
export function runIngestDbGateTests(): void {
  // ---- the asymmetry, in both directions ----------------------------------

  {
    const local = integrationDbVerdict({});
    assert(local.kind === "skip", `no DATABASE_URL and no CI must skip, got ${local.kind}`);

    for (const ci of ["true", "1"]) {
      const inCi = integrationDbVerdict({ CI: ci });
      assert(inCi.kind === "refuse", `no DATABASE_URL under CI=${ci} must refuse, got ${inCi.kind}`);
    }

    for (const notCi of ["false", "0", ""]) {
      const verdict = integrationDbVerdict({ CI: notCi });
      assert(verdict.kind === "skip", `CI=${notCi} is not CI, got ${verdict.kind}`);
    }
  }

  {
    // A set URL runs in both environments — the suite is never skipped for a
    // reason the environment did not give.
    for (const env of [{ DATABASE_URL: "postgres://x/y" }, { DATABASE_URL: "postgres://x/y", CI: "true" }]) {
      const verdict = integrationDbVerdict(env);
      assert(verdict.kind === "run", `a set DATABASE_URL must run, got ${verdict.kind}`);
      assert(
        verdict.kind === "run" && verdict.connectionString === "postgres://x/y",
        "the verdict carries the connection string it was given",
      );
    }
  }

  // ---- the fleet derivation ------------------------------------------------

  {
    const derived = resolveFleetUrl("postgres://bms_owner:bms_owner_dev@localhost:5433/bms", {});
    const parsed = new URL(derived);
    assert(parsed.username === "bms_fleet", `the derived role must be bms_fleet, got ${parsed.username}`);
    assert(parsed.password === "bms_fleet_dev", "the compose default password is used when none is set");
    assert(parsed.port === "5433", `the host and port must survive the rewrite, got ${parsed.port}`);
    assert(parsed.pathname === "/bms", `the database name must survive the rewrite, got ${parsed.pathname}`);
  }

  {
    const explicit = resolveFleetUrl("postgres://bms_owner:pw@localhost:5433/bms", {
      DATABASE_URL_FLEET: "postgres://other:secret@db.internal:6000/bms",
    });
    assert(
      explicit === "postgres://other:secret@db.internal:6000/bms",
      `an explicit DATABASE_URL_FLEET must win untouched, got ${explicit}`,
    );

    const overridden = resolveFleetUrl("postgres://bms_owner:pw@localhost:5433/bms", {
      BMS_FLEET_PASSWORD: "not-the-default",
    });
    assert(
      new URL(overridden).password === "not-the-default",
      "BMS_FLEET_PASSWORD overrides the compose default",
    );
  }
}
