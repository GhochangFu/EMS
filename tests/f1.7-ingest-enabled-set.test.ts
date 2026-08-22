import { describe, it } from "vitest";

import {
  ENABLED_SET_VERSION,
  F1_7_ENABLED_RTU_CODES,
  resolveIngestEnabled,
} from "../packages/db/src/ingest-enabled-set.js";

/**
 * Who owns `bms.rtus.ingest_enabled` — the seed, or the operator (`F1.7`).
 *
 * **The seed used to own it unconditionally.** Its upsert carried
 * `ingest_enabled = EXCLUDED.ingest_enabled` in `ON CONFLICT DO UPDATE`, so an
 * operator who switched a flapping station off in the admin RTU screen had that
 * decision reverted by the next `pnpm db:seed` — which CI runs on every PR.
 * Invisible while one RTU was enabled; not invisible across nine.
 *
 * Simply dropping the column from the update would strand the fleet instead:
 * an already-seeded database would never see a changed set. So the rule is
 * versioned. The seed asserts a set once, records that it did, and from then on
 * the row belongs to whoever is running the plant.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** One of the nine the 2026-08-22 probe found publishing. */
const PUBLISHING = "861736076104923";
/** Banchukamari I — silent across all ten cycles of the 600 s probe. */
const SILENT = "861736076133666";

describe("F1.7 ingest-enabled set", () => {
  it("seeds a new RTU from the measured set", () => {
    const fresh = resolveIngestEnabled({ rtuCode: PUBLISHING, existing: null });
    assert(fresh.ingestEnabled, "a publishing RTU is enabled when first seeded");
    assert(fresh.reason === "seeded", `expected "seeded", got "${fresh.reason}"`);

    // A silent RTU stays `catalog`, which keeps `meta.telemetrySource` off
    // `mqtt` and so keeps the simulator feeding its dashboards. Enabling one
    // would take 88 points from simulated to dead.
    const quiet = resolveIngestEnabled({ rtuCode: SILENT, existing: null });
    assert(!quiet.ingestEnabled, "a silent RTU is not enabled");
  });

  it("adopts the set once on a database seeded before it existed", () => {
    const adopted = resolveIngestEnabled({
      rtuCode: PUBLISHING,
      existing: { ingestEnabled: false, enabledSetVersion: null },
    });
    assert(adopted.ingestEnabled, "an unstamped row takes the set");
    assert(adopted.reason === "adopted", `expected "adopted", got "${adopted.reason}"`);

    // A stamp from an older set is also unadopted for the current one.
    const stale = resolveIngestEnabled({
      rtuCode: PUBLISHING,
      existing: { ingestEnabled: false, enabledSetVersion: "f1.7-1999-01-01" },
    });
    assert(stale.reason === "adopted", "a row stamped with an older set is re-adopted");
  });

  it("leaves an adopted row to the operator, in both directions", () => {
    // The defect this exists for: an operator switches a flapping station off,
    // and the next seed must not switch it back on.
    const disabled = resolveIngestEnabled({
      rtuCode: PUBLISHING,
      existing: { ingestEnabled: false, enabledSetVersion: ENABLED_SET_VERSION },
    });
    assert(!disabled.ingestEnabled, "the seed must not re-enable what an operator disabled");
    assert(disabled.reason === "operator", `expected "operator", got "${disabled.reason}"`);

    // And the mirror, which matters just as much: an operator may enable a
    // station the probe found silent — it may have come back, and they can see
    // that on the health endpoint. The seed must not switch it off either.
    const enabled = resolveIngestEnabled({
      rtuCode: SILENT,
      existing: { ingestEnabled: true, enabledSetVersion: ENABLED_SET_VERSION },
    });
    assert(enabled.ingestEnabled, "the seed must not disable what an operator enabled");
  });

  it("carries exactly the nine RTUs the probe measured", () => {
    assert(
      F1_7_ENABLED_RTU_CODES.length === 9,
      `the measured set is nine RTUs, got ${F1_7_ENABLED_RTU_CODES.length}`,
    );
    assert(
      new Set(F1_7_ENABLED_RTU_CODES).size === 9,
      "the set carries no duplicate — a repeat would silently shrink it",
    );
    // Named rather than counted: the three the 600 s probe found silent must
    // not drift into the set on a careless edit, because enabling one takes a
    // working simulated dashboard dead.
    for (const quiet of ["861736076133666", "861736076133757", "861736076133609"]) {
      assert(
        !F1_7_ENABLED_RTU_CODES.includes(quiet),
        `${quiet} was silent across all ten probe cycles and must not be enabled`,
      );
    }
    assert(
      F1_7_ENABLED_RTU_CODES.includes("861736076104923"),
      "the ADR 0007 pilot must stay enabled — it is the one already ingesting",
    );
  });

  it("stamps a version that changes when the set changes", () => {
    // The stamp is what makes adoption happen once. If it were a constant like
    // "v1", a later change to the set would never reach a seeded database and
    // the fleet would silently stay as it was.
    assert(
      /^f1\.7-\d{4}-\d{2}-\d{2}$/.test(ENABLED_SET_VERSION),
      `the stamp must carry the date the set was measured, got "${ENABLED_SET_VERSION}"`,
    );
  });
});
