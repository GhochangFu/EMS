import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { getOrganizationId } from "./hierarchy-seed";
import { ENABLED_SET_VERSION, resolveIngestEnabled } from "./ingest-enabled-set";
import { assets, locations } from "./schema/bms-schema";

type PheCatalogRow = {
  EdgeRTUId: number;
  RTUCode: string;
  MqttTopic: string;
  RTUDisplayName: string;
  StationId: number;
  StationCode: string;
  StationName: string;
  Latitude: number;
  Longitude: number;
  OrgCode: string;
  OrgName: string;
  DeviceId: number;
  DeviceCode: string;
  DeviceName: string;
  DeviceDisplayName: string;
  DeviceTypeCode: string;
  ModelDeviceCode: string;
  DeviceSensorId: number;
  SensorCode: string;
  SensorName: string;
  DataKey: string;
  UnitCode: string | null;
};

type PheCatalogFile = {
  org: { orgId: number; orgCode: string; orgName: string };
  pilotEdgeRtuId: number;
  rows: PheCatalogRow[];
};

/** Maps TeleCash sensor codes to BMS `point_key` values. */
export function bmsPointKeyForSensor(sensorCode: string, dataKey: string): string {
  const bySensor: Record<string, string> = {
    TKW: "kw",
    TKWH: "kwh_total",
    APV: "voltage_l1_v",
    APF: "pf",
    FR: "frequency_hz",
    IR: "current_ir",
    IY: "current_iy",
    IB: "current_ib",
    VRY: "voltage_vry",
    VYB: "voltage_vyb",
    VBR: "voltage_vbr",
    VRN: "voltage_vrn",
    VYN: "voltage_vyn",
    VBN: "voltage_vbn",
    TKVA: "kva",
    TKVAR: "kvar",
    PMP_ONOFF: "breaker_main",
    CPMP_ONOFF: "chlorine_pump_on",
    BC: "battery_charge_pct",
    NS: "network_strength",
    CPS: "controller_power_status",
    TS: "device_timestamp",
  };
  return bySensor[sensorCode] ?? dataKey.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function deviceDomain(deviceCode: string, modelCode: string): string {
  if (deviceCode.startsWith("PUMP") || modelCode.startsWith("PUMP")) {
    return "electrical";
  }
  if (deviceCode.startsWith("MFM") || modelCode.startsWith("MFM")) {
    return "electrical";
  }
  if (deviceCode.startsWith("AIRSP") || modelCode.startsWith("AIRSP")) {
    return "environment";
  }
  return "electrical";
}

function stationSlug(stationName: string): string {
  return `phe-${stationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function assetCode(deviceCode: string): string {
  return `PHE-${deviceCode}`;
}

function unitLabel(unitCode: string | null): string | null {
  if (!unitCode || unitCode === "NA") {
    return null;
  }
  return unitCode;
}

/**
 * Where the catalog might be, tried in order.
 *
 * `resolve(process.cwd(), "src/phe-catalog.json")` alone only worked because
 * `pnpm db:seed` happens to run with `packages/db` as its working directory.
 * Every other caller got `ENOENT` on a path assembled from its own cwd, and
 * `F1.7`'s two-pass seed test is the first other caller.
 *
 * **Resolving from the module would be the better fix and is not available
 * here.** `import.meta.url` is a `TS1470` error because `tsconfig.build.json`
 * emits CommonJS, and `__dirname` does not exist when Vitest loads this file as
 * ESM — so naming the candidates is the one thing that works in both. Caught by
 * `tsc` and not by the suite: the runner and the build disagree about the module
 * format, so a green test proved nothing about the shipped output.
 */
const CATALOG_CANDIDATES = ["src/phe-catalog.json", "packages/db/src/phe-catalog.json"];

function loadCatalog(): PheCatalogFile {
  const path = CATALOG_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) =>
    existsSync(p),
  );
  if (path === undefined) {
    // Loud and specific: an empty catalog would seed zero RTUs and read as "the
    // fleet is gone" rather than "the file was not found".
    throw new Error(
      `phe-catalog.json not found from ${process.cwd()}; tried ${CATALOG_CANDIDATES.join(", ")}`,
    );
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PheCatalogFile;
}

/** Seeds PHEWB catalog: Station → location, EdgeRTU → rtus, devices → assets. */
export async function seedPheCatalog(db: BmsDb, pool: pg.Pool): Promise<void> {
  const catalog = loadCatalog();
  const phewbOrgId = await getOrganizationId(pool, "PHEWB");
  const stationIds = [...new Set(catalog.rows.map((r) => r.StationId))];

  const stationLocationIds = new Map<number, string>();

  for (const stationId of stationIds) {
    const stationRows = catalog.rows.filter((r) => r.StationId === stationId);
    const head = stationRows[0];
    if (!head) {
      continue;
    }

    const slug = stationSlug(head.StationName);
    const locationCode = `PHE-${head.StationCode}`;

    const existingLocation = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.slug, slug), eq(locations.organizationId, phewbOrgId)))
      .limit(1);

    let locationId = existingLocation[0]?.id;
    const locationValues = {
      organizationId: phewbOrgId,
      code: locationCode,
      slug,
      name: head.StationName,
      type: "rsmoc" as const,
      province: "West Bengal",
      capital: null,
      latitude: Number(head.Latitude),
      longitude: Number(head.Longitude),
      active: true,
      meta: {
        phe: {
          orgId: catalog.org.orgId,
          orgCode: catalog.org.orgCode,
          stationId,
          stationCode: head.StationCode,
          stationName: head.StationName,
        },
      },
      updatedAt: new Date(),
    };

    if (locationId) {
      await db.update(locations).set(locationValues).where(eq(locations.id, locationId));
    } else {
      const [created] = await db
        .insert(locations)
        .values(locationValues)
        .returning({ id: locations.id });
      locationId = created?.id;
    }
    if (!locationId) {
      continue;
    }
    stationLocationIds.set(stationId, locationId);
  }

  const rtuIds = [...new Set(catalog.rows.map((r) => r.EdgeRTUId))];
  const rtuIdByExternal = new Map<number, string>();
  /** `rtu_code` → why `ingest_enabled` ended up where it did, summarised below. */
  const reasons = new Map<string, string>();

  for (const edgeRtuId of rtuIds) {
    const rtuRows = catalog.rows.filter((r) => r.EdgeRTUId === edgeRtuId);
    const head = rtuRows[0];
    if (!head) {
      continue;
    }

    const locationId = stationLocationIds.get(head.StationId);
    if (!locationId) {
      continue;
    }

    // What the database already thinks, read before the upsert overwrites it.
    // `ingest_enabled` stopped being the seed's to assert on every run at
    // `F1.7`: the admin RTU screen writes this column, and re-asserting it here
    // reverted an operator's decision on the next `pnpm db:seed` — which CI
    // runs on every PR. `resolveIngestEnabled` owns the rule; see its comment.
    const existingRtu = await pool.query<{
      ingest_enabled: boolean;
      enabled_set_version: string | null;
    }>(
      `SELECT ingest_enabled, meta->>'enabledSetVersion' AS enabled_set_version
       FROM bms.rtus WHERE external_rtu_id = $1`,
      [edgeRtuId],
    );
    const existingRow = existingRtu.rows[0];
    const resolved = resolveIngestEnabled({
      rtuCode: head.RTUCode,
      existing:
        existingRow === undefined
          ? null
          : {
              ingestEnabled: existingRow.ingest_enabled,
              enabledSetVersion: existingRow.enabled_set_version,
            },
    });
    const ingestEnabled = resolved.ingestEnabled;
    // Logged because `ResolveIngestEnabledResult.reason` promises it — "so the
    // seed can log it and an operator can tell an adoption from an override
    // without reading this file" — and until now nothing did, which is the same
    // class of untrue docblock this branch already fixed once in `renderHealth`.
    //
    // It is also the missing signal. The review reverted this whole mechanism
    // and every test stayed green; with this line, a reverted seed prints no
    // `reason` at all and the CI log says so. `operator` on a run nobody
    // expected is the other thing worth seeing — it means the database is
    // holding a decision the catalog does not know about.
    reasons.set(head.RTUCode, resolved.reason);
    // Derived from the *resolved* value, not from the catalog's opinion, so the
    // invariant the simulator depends on holds however the row got here: an
    // RTU is `mqtt` on both `rtus.source_type` and its assets'
    // `meta.telemetrySource`, or on neither. Split them and ingest and
    // `apps/sim` write the same points.
    const sourceType = ingestEnabled ? "mqtt" : "catalog";
    const rtuCode = `RTU-${head.RTUCode}`;

    // `meta` is merged rather than replaced on conflict. It is a shared bag —
    // the admin RTU API accepts arbitrary keys — so `meta = EXCLUDED.meta`
    // deleted whatever an operator or another process had put there, on every
    // `pnpm db:seed`, which CI runs on every PR. That was survivable while the
    // seed was the only writer. It stopped being survivable at `F1.7`, because
    // `enabledSetVersion` now lives in this column and decides who owns
    // `ingest_enabled`: lose the key and the next seed reverts the operator.
    // The `||` idiom is `hierarchy-seed.ts`'s. Merging makes a *removed* key
    // sticky, which costs nothing here — all three keys are rewritten every run.
    const rtuRes = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.rtus (
        location_id, code, display_name, source_type,
        external_rtu_id, rtu_code, mqtt_topic,
        station_code, station_name, ingest_enabled, meta,
        organization_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (external_rtu_id) WHERE external_rtu_id IS NOT NULL DO UPDATE SET
        location_id = EXCLUDED.location_id,
        code = EXCLUDED.code,
        display_name = EXCLUDED.display_name,
        source_type = EXCLUDED.source_type,
        rtu_code = EXCLUDED.rtu_code,
        mqtt_topic = EXCLUDED.mqtt_topic,
        station_code = EXCLUDED.station_code,
        station_name = EXCLUDED.station_name,
        ingest_enabled = EXCLUDED.ingest_enabled,
        organization_id = EXCLUDED.organization_id,
        -- Merged, not replaced: see the note above this query.
        meta = COALESCE(bms.rtus.meta, '{}'::jsonb) || EXCLUDED.meta
      RETURNING id
      `,
      [
        locationId,
        rtuCode,
        head.RTUDisplayName,
        sourceType,
        edgeRtuId,
        head.RTUCode,
        head.MqttTopic,
        head.StationCode,
        head.StationName,
        ingestEnabled,
        JSON.stringify({
          orgCode: catalog.org.orgCode,
          // `pilot` still means the ADR 0007 RTU specifically, not "ingesting".
          // Nine RTUs ingest now; one of them is the pilot.
          pilot: edgeRtuId === catalog.pilotEdgeRtuId,
          // The stamp that makes this row the operator's from here on.
          enabledSetVersion: ENABLED_SET_VERSION,
        }),
        phewbOrgId,
      ],
    );

    const rtuUuid = rtuRes.rows[0]?.id;
    if (rtuUuid) {
      rtuIdByExternal.set(edgeRtuId, rtuUuid);
    }

    const deviceIds = [...new Set(rtuRows.map((r) => r.DeviceId))];
    for (const deviceId of deviceIds) {
      const deviceRows = rtuRows.filter((r) => r.DeviceId === deviceId);
      const deviceHead = deviceRows[0];
      if (!deviceHead) {
        continue;
      }

      const code = assetCode(deviceHead.DeviceCode);
      const telemetrySource = ingestEnabled ? "mqtt" : "catalog";
      const meta = {
        telemetrySource,
        phe: {
          deviceId: deviceHead.DeviceId,
          deviceCode: deviceHead.DeviceCode,
          modelDeviceCode: deviceHead.ModelDeviceCode,
          deviceTypeCode: deviceHead.DeviceTypeCode,
        },
      };

      const existingAsset = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.code, code))
        .limit(1);

      let assetId = existingAsset[0]?.id;
      const rtuUuidForAsset = rtuIdByExternal.get(edgeRtuId);
      if (!rtuUuidForAsset) {
        continue;
      }

      const assetValues = {
        organizationId: phewbOrgId,
        code,
        name: deviceHead.DeviceDisplayName || deviceHead.DeviceName,
        siteName: head.StationName,
        locationId,
        rtuId: rtuUuidForAsset,
        domain: deviceDomain(deviceHead.DeviceCode, deviceHead.ModelDeviceCode),
        meta,
      };

      if (assetId) {
        await db.update(assets).set(assetValues).where(eq(assets.id, assetId));
      } else {
        const [created] = await db.insert(assets).values(assetValues).returning({ id: assets.id });
        assetId = created?.id;
      }
      if (!assetId) {
        continue;
      }

      for (const sensor of deviceRows) {
        // `TS` is the envelope's own timestamp, which the ingest adapter
        // consumes as the sample time (`ENVELOPE_KEYS` in
        // `apps/ingest/src/adapters/mqtt.ts`). Cataloguing it as a measured
        // point would assert a provenance that is false by construction: the
        // row could never arrive, and if it somehow did its value would be its
        // own `time` in epoch milliseconds. A mapped point that silently never
        // arrives is the defect this seed's `NS`/`network_strength` row spent
        // its life demonstrating — do not add a second one.
        if (sensor.SensorCode === "TS") {
          // Databases seeded before this skip carry the row already, and a seed
          // that only stops *writing* the mistake never converges. It has no
          // telemetry to lose — that is the whole point.
          //
          // Migration `0025` does the same delete unconditionally, and is the
          // durable half: this one only fires while a catalog row with
          // `SensorCode = 'TS'` still exists to iterate, and `phe-catalog.json`
          // is a vendor export that may reasonably stop carrying one.
          await pool.query(
            `DELETE FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
            [assetId, bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey)],
          );
          continue;
        }
        const pointKey = bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey);

        // `F3.39` / ADR 0051 decision 4 — REGISTER THE CODE BEFORE THE ROW
        // THAT REFERENCES IT. `asset_points.point_key` is a foreign key into
        // `bms.point_keys` from migration `0057`, and this seed maps 15 codes
        // that no other seed path writes: `kwh_total`, `kva`, six `voltage_v*`,
        // three `current_i*`, `chlorine_pump_on`, `battery_charge_pct`,
        // `network_strength` and `controller_power_status`. They come from
        // `bmsPointKeyForSensor`'s TeleCash map, which is their only source of
        // truth.
        //
        // **This is not belt-and-braces for what `0057` already did.** That
        // migration admits the orphans on a database that HAS them; a cold
        // start has none, because `bms.asset_points` is still empty when it
        // runs. Without this the very first `pnpm db:seed` on an empty volume
        // fails here with `asset_points_point_key_point_keys_code_fk` and
        // `compose up` never completes. Measured on a scratch database before
        // this block existed, not reasoned about.
        //
        // Written inline rather than hoisted to a one-time pass on purpose: the
        // dependency is one statement above the row that needs it, so it cannot
        // be moved or deleted without the reason being visible.
        //
        // `name` uses `initcap(replace(...))`, which is the exact expression
        // `0057` uses, so a repaired row and a seeded one are indistinguishable.
        // `COALESCE` on conflict, never `EXCLUDED.unit`: this seed re-runs on
        // every `compose up`, `0057` admitted these codes with a NULL unit, and
        // an admin who fills one in must not have it reverted at the next boot.
        await pool.query(
          `
          INSERT INTO bms.point_keys (code, name, domain, unit, active)
          -- \`$1\` is cast on both uses: without it Postgres deduces varchar
          -- from the column and text from \`replace()\` and refuses the
          -- statement with "inconsistent types deduced for parameter $1".
          VALUES ($1::text, initcap(replace($1::text, '_', ' ')), $2, nullif($3::text, ''), true)
          ON CONFLICT (code) DO UPDATE SET
            unit = COALESCE(bms.point_keys.unit, EXCLUDED.unit)
          `,
          [pointKey, assetValues.domain, unitLabel(sensor.UnitCode)],
        );

        await pool.query(
          `
          -- ADR 0018: provenance binds at the point. These are measured points
          -- fed by the asset's gateway, so rtu_id is taken from the asset —
          -- asset_points_source_ref_check rejects a 'measured' row without one.
          INSERT INTO bms.asset_points (
            asset_id, point_key, source_data_key, sensor_code, unit, active,
            rtu_id, source_kind, organization_id
          )
          VALUES (
            $1, $2, $3, $4, $5, true,
            (SELECT rtu_id FROM bms.assets WHERE id = $1), 'measured', $6
          )
          ON CONFLICT (asset_id, point_key) DO UPDATE SET
            source_data_key = EXCLUDED.source_data_key,
            sensor_code = EXCLUDED.sensor_code,
            unit = EXCLUDED.unit,
            active = true,
            rtu_id = EXCLUDED.rtu_id,
            source_kind = EXCLUDED.source_kind,
            organization_id = EXCLUDED.organization_id
          `,
          [assetId, pointKey, sensor.DataKey, sensor.SensorCode, unitLabel(sensor.UnitCode), phewbOrgId],
        );
      }
    }
  }

  reportIngestEnabledReasons(reasons);
}

/**
 * One line saying who decided `ingest_enabled` for each RTU, and why.
 *
 * `stderr` via `console.error`, matching `migrate.ts`, `seed.ts` and
 * `refresh-aggregates.ts` — §4.5 reserves `console.log` for the Pino logger and
 * these CLI scripts have no Nest container to resolve one from.
 *
 * **`operator` is the interesting word.** It means the database is holding a
 * decision this catalog does not know about, which is correct and invisible
 * until something prints it. `adopted` on a run nobody expected means the stamp
 * went missing — see the `meta` merge above for how that used to happen.
 */
function reportIngestEnabledReasons(reasons: ReadonlyMap<string, string>): void {
  const byReason = new Map<string, number>();
  for (const reason of reasons.values()) {
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const summary = [...byReason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(" ");
  console.error(`phe ingest_enabled: ${summary || "no rtus"} (set ${ENABLED_SET_VERSION})`);
}
