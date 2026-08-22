import { createHash } from "node:crypto";

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

/** Bhutnirghat I, the ADR 0007 pilot — in the enabled set. */
const ENABLED = "861736076104923";
/** Banchukamari I — silent across all ten cycles, so held out of the set. */
const HELD_BACK = "861736076133666";

describe("F1.7 ingest-enabled set", () => {
  it("seeds a new RTU from the measured set", () => {
    const fresh = resolveIngestEnabled({ rtuCode: ENABLED, existing: null });
    assert(fresh.ingestEnabled, "a publishing RTU is enabled when first seeded");
    assert(fresh.reason === "seeded", `expected "seeded", got "${fresh.reason}"`);

    // A silent RTU stays `catalog`, which keeps `meta.telemetrySource` off
    // `mqtt` and so keeps the simulator feeding its dashboards. Enabling one
    // would take 88 points from simulated to dead.
    const quiet = resolveIngestEnabled({ rtuCode: HELD_BACK, existing: null });
    assert(!quiet.ingestEnabled, "a silent RTU is not enabled");
  });

  it("adopts the set once on a database seeded before it existed", () => {
    const adopted = resolveIngestEnabled({
      rtuCode: ENABLED,
      existing: { ingestEnabled: false, enabledSetVersion: null },
    });
    assert(adopted.ingestEnabled, "an unstamped row takes the set");
    assert(adopted.reason === "adopted", `expected "adopted", got "${adopted.reason}"`);

    // A stamp from an older set is also unadopted for the current one.
    const stale = resolveIngestEnabled({
      rtuCode: ENABLED,
      existing: { ingestEnabled: false, enabledSetVersion: "f1.7-1999-01-01" },
    });
    assert(stale.reason === "adopted", "a row stamped with an older set is re-adopted");
  });

  it("leaves an adopted row to the operator, in both directions", () => {
    // The defect this exists for: an operator switches a flapping station off,
    // and the next seed must not switch it back on.
    const disabled = resolveIngestEnabled({
      rtuCode: ENABLED,
      existing: { ingestEnabled: false, enabledSetVersion: ENABLED_SET_VERSION },
    });
    assert(!disabled.ingestEnabled, "the seed must not re-enable what an operator disabled");
    assert(disabled.reason === "operator", `expected "operator", got "${disabled.reason}"`);

    // And the mirror, which matters just as much: an operator may enable a
    // station the probe found silent — it may have come back, and they can see
    // that on the health endpoint. The seed must not switch it off either.
    const enabled = resolveIngestEnabled({
      rtuCode: HELD_BACK,
      existing: { ingestEnabled: true, enabledSetVersion: ENABLED_SET_VERSION },
    });
    assert(enabled.ingestEnabled, "the seed must not disable what an operator enabled");
  });

  it("carries exactly the five RTUs that beat the simulator", () => {
    assert(
      F1_7_ENABLED_RTU_CODES.length === 5,
      `the enabled set is five RTUs, got ${F1_7_ENABLED_RTU_CODES.length}`,
    );
    assert(
      new Set(F1_7_ENABLED_RTU_CODES).size === 5,
      "the set carries no duplicate — a repeat would silently shrink it",
    );
    // Named rather than counted, because the cost of a careless edit is a dead
    // dashboard: enabling an RTU makes `apps/sim` skip its assets, so a station
    // that cannot deliver a readable value goes from simulated to nothing.
    const heldBack: ReadonlyArray<readonly [string, string]> = [
      ["861736076133666", "Banchukamari I — silent in all ten probe cycles"],
      ["861736076133757", "Banchukamari II — silent in all ten probe cycles"],
      ["861736076133609", "Bilsi II — silent in all ten probe cycles"],
      ["861736076081915", "Salkumarhat I — 17 of 27 keys carry no reading (F4.55)"],
      ["861736076128260", "Salkumarhat II — 17 of 27 keys carry no reading (F4.55)"],
      ["861736076128211", "Mora Nodir Kuthi II — clock -3:02:36, never in a window (F4.54)"],
      ["861736076128245", "Bhutnirghat II — clock -0:21:34, never in a window (F4.54)"],
    ];
    for (const [code, why] of heldBack) {
      assert(
        !F1_7_ENABLED_RTU_CODES.includes(code),
        `${code} must not be enabled: ${why}`,
      );
    }
    assert(
      F1_7_ENABLED_RTU_CODES.includes("861736076104923"),
      "the ADR 0007 pilot must stay enabled — it is the one already ingesting",
    );

    // Pinned positively, and this is not belt-and-braces over the checks above.
    // Measured with the digest fix already in place: swapping `868019069263896`
    // for `999999999999999` kept the count at five, tripped no held-back code,
    // kept the pilot, and moved the digest in lockstep with the set — so all
    // 125 tests stayed green. Deriving the stamp from the set stops the stamp
    // going stale; it cannot pin WHICH RTUs are in the set, because the test
    // recomputes from the same list it is checking. Only naming them does that,
    // and these five are field measurements — changing one is a claim about a
    // pump house that should cost a deliberate edit here.
    const expected = [
      "861736076080040", // Lotapata II
      "861736076104923", // Bhutnirghat I — the ADR 0007 pilot
      "861736076116638", // Bilsi I
      "861736076128187", // Mora Nodir Kuthi I
      "868019069263896", // Lotapata I
    ];
    const actual = [...F1_7_ENABLED_RTU_CODES].sort();
    assert(
      actual.join(",") === expected.join(","),
      `the enabled set must be exactly the five measured RTUs.\n  expected: ${expected.join(" ")}\n  actual:   ${actual.join(" ")}`,
    );
  });

  it("moves the stamp whenever the set moves", () => {
    // The defect this replaces: the old assertion checked the stamp's SHAPE, so
    // swapping one IMEI for another left it untouched and all 125 tests green.
    // Every already-seeded database would have kept the old set for ever with
    // nothing saying so. Asserting a pinned digest literal would be the same
    // defect wearing a hash, because the edit that changes the set would bump
    // the literal too — so this recomputes it from the set itself.
    const digest = createHash("sha256")
      .update([...F1_7_ENABLED_RTU_CODES].sort().join(","))
      .digest("hex")
      .slice(0, 8);
    assert(
      ENABLED_SET_VERSION.endsWith(`-${digest}`),
      `the stamp must end in the set's own digest "${digest}", got "${ENABLED_SET_VERSION}"`,
    );
    assert(
      /^f1\.7-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/.test(ENABLED_SET_VERSION),
      `the stamp must carry the measurement date and the digest, got "${ENABLED_SET_VERSION}"`,
    );
    // Reordering is not a change of set, so it must NOT force a re-adoption
    // across the whole fleet.
    const reordered = createHash("sha256")
      .update([...F1_7_ENABLED_RTU_CODES].reverse().sort().join(","))
      .digest("hex")
      .slice(0, 8);
    assert(reordered === digest, "the digest must not depend on the order of the list");
  });
});
