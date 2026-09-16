import { expect } from "vitest";
import pg from "pg";

import type { OnboardingCommitResponseDto } from "@bms/shared";

/**
 * `F4.140` — assertions for `OnboardingCommitService.commit` deriving
 * `assets.meta.telemetrySource` from the RTU it inserts in the same
 * transaction. Assertions live here (ADR 0014); the sibling `.test.ts` owns
 * the database lifecycle.
 *
 * Each committed draft is read back through `ownerPool` (`bms_fleet`,
 * `BYPASSRLS`) rather than reused from the in-memory `commit()` result, so a
 * case measures the row `OnboardingCommitService` actually wrote, not the
 * value it happened to return.
 */
export type OnboardingTelemetrySourceCtx = {
  ownerPool: pg.Pool;
  committed: {
    mqttEnabled?: OnboardingCommitResponseDto;
    mqttDisabled?: OnboardingCommitResponseDto;
    simulator?: OnboardingCommitResponseDto;
  };
};

/**
 * `O2`'s guard: the plan requires it assert on O1's own commit without
 * sharing test-execution state with O1's `it()` — so it re-derives the
 * committed asset id from `ctx.committed` (set once in `beforeAll`) and
 * throws rather than silently asserting on `undefined` if that commit did
 * not produce an asset.
 */
function committedAssetId(
  commit: OnboardingCommitResponseDto | undefined,
  label: string,
): string {
  if (!commit || commit.assetIds.length === 0) {
    throw new Error(`F4.140: ${label} draft did not commit an asset`);
  }
  return commit.assetIds[0];
}

async function readAssetMeta(
  ownerPool: pg.Pool,
  assetId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await ownerPool.query<{ meta: Record<string, unknown> | null }>(
    "SELECT meta FROM bms.assets WHERE id = $1",
    [assetId],
  );
  expect(rows.length, "F4140: committed asset id resolves to a row").toBe(1);
  return rows[0].meta;
}

/** O1 — an enabled `mqtt` RTU's onboarded asset is derived `mqtt`. */
export async function assertEnabledMqttAssetGetsMqtt(ctx: OnboardingTelemetrySourceCtx) {
  const assetId = committedAssetId(ctx.committed.mqttEnabled, "mqtt-enabled");
  const meta = await readAssetMeta(ctx.ownerPool, assetId);
  expect(meta?.telemetrySource).toBe("mqtt");
}

/** O2 — the same asset's caller-supplied `meta.telemetryEnabled` survives the merge. */
export async function assertEnabledMqttAssetKeepsItsOtherMetaKey(
  ctx: OnboardingTelemetrySourceCtx,
) {
  const assetId = committedAssetId(ctx.committed.mqttEnabled, "mqtt-enabled");
  const meta = await readAssetMeta(ctx.ownerPool, assetId);
  expect(meta?.telemetryEnabled).toBe("false");
}

/** O3 — a disabled `mqtt` RTU's onboarded asset is derived `catalog`. */
export async function assertDisabledMqttAssetGetsCatalog(ctx: OnboardingTelemetrySourceCtx) {
  const assetId = committedAssetId(ctx.committed.mqttDisabled, "mqtt-disabled");
  const meta = await readAssetMeta(ctx.ownerPool, assetId);
  expect(meta?.telemetrySource).toBe("catalog");
}

/** O4 — a `simulator` RTU's onboarded asset carries an explicit `catalog`, never `undefined`. */
export async function assertSimulatorAssetGetsExplicitCatalog(
  ctx: OnboardingTelemetrySourceCtx,
) {
  const assetId = committedAssetId(ctx.committed.simulator, "simulator");
  const meta = await readAssetMeta(ctx.ownerPool, assetId);
  expect(meta?.telemetrySource).toBe("catalog");
}
