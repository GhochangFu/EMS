import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { getOrganizationId } from "./hierarchy-seed";
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

function loadCatalog(): PheCatalogFile {
  const raw = readFileSync(resolve(process.cwd(), "src/phe-catalog.json"), "utf8");
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

    const ingestEnabled = edgeRtuId === catalog.pilotEdgeRtuId;
    const sourceType = ingestEnabled ? "mqtt" : "catalog";
    const rtuCode = `RTU-${head.RTUCode}`;

    const rtuRes = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.rtus (
        location_id, code, display_name, source_type,
        external_rtu_id, rtu_code, mqtt_topic,
        station_code, station_name, ingest_enabled, meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
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
        meta = EXCLUDED.meta
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
        JSON.stringify({ orgCode: catalog.org.orgCode, pilot: ingestEnabled }),
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
          await pool.query(
            `DELETE FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
            [assetId, bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey)],
          );
          continue;
        }
        const pointKey = bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey);
        await pool.query(
          `
          -- ADR 0018: provenance binds at the point. These are measured points
          -- fed by the asset's gateway, so rtu_id is taken from the asset —
          -- asset_points_source_ref_check rejects a 'measured' row without one.
          INSERT INTO bms.asset_points (
            asset_id, point_key, source_data_key, sensor_code, unit, active,
            rtu_id, source_kind
          )
          VALUES (
            $1, $2, $3, $4, $5, true,
            (SELECT rtu_id FROM bms.assets WHERE id = $1), 'measured'
          )
          ON CONFLICT (asset_id, point_key) DO UPDATE SET
            source_data_key = EXCLUDED.source_data_key,
            sensor_code = EXCLUDED.sensor_code,
            unit = EXCLUDED.unit,
            active = true,
            rtu_id = EXCLUDED.rtu_id,
            source_kind = EXCLUDED.source_kind
          `,
          [assetId, pointKey, sensor.DataKey, sensor.SensorCode, unitLabel(sensor.UnitCode)],
        );
      }
    }
  }
}
