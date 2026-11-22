import { BadRequestException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";

import { deviceProfiles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { deviceProfileCodeSchema } from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { ParsedExcel } from "./onboarding-excel.service";

/** A device profile as the onboarding draft names it: the newest version of one code. */
export type OnboardingProfileRef = { readonly id: string; readonly code: string; readonly version: number };

/** Resolves one profile code of the turn's organization; `null` when it holds none. */
export type DeviceProfileLookup = (code: string) => Promise<OnboardingProfileRef | null>;

/**
 * `F1.2` plan PR 11 (ADR 0141 decision 23) — the newest Modbus TCP version of each code the
 * organization holds, among `codes`. The guided chat (`profile: <code>`) and the workbook's
 * `profile_code` column name a profile by code, which an operator can read off the Device
 * profiles page; the draft stores the resolved row's id, which the commit binds. Read under
 * `withTenant` with the organization in the predicate, so a code another organization holds is
 * simply absent. A code outside the profile code class names no row and is not sent.
 */
export async function newestDeviceProfilesByCode(
  tenantDb: BmsDb,
  organizationId: string,
  codes: readonly string[],
): Promise<Map<string, OnboardingProfileRef>> {
  const wanted = [...new Set(codes)].filter((code) => deviceProfileCodeSchema.safeParse(code).success);
  const found = new Map<string, OnboardingProfileRef>();
  if (wanted.length === 0) {
    return found;
  }
  const rows = await withTenant(tenantDb, organizationId, (tx) =>
    tx
      .select({ id: deviceProfiles.id, code: deviceProfiles.code, version: deviceProfiles.version })
      .from(deviceProfiles)
      .where(
        and(
          eq(deviceProfiles.organizationId, organizationId),
          eq(deviceProfiles.protocol, "modbus_tcp"),
          inArray(deviceProfiles.code, wanted),
        ),
      )
      .orderBy(deviceProfiles.code, desc(deviceProfiles.version)),
  );
  for (const row of rows) {
    if (!found.has(row.code)) {
      found.set(row.code, row);
    }
  }
  return found;
}

/** The one-code lookup the guided chat is handed for its organization. */
export function deviceProfileLookup(tenantDb: BmsDb, organizationId: string): DeviceProfileLookup {
  return async (code) => (await newestDeviceProfilesByCode(tenantDb, organizationId, [code])).get(code) ?? null;
}

/**
 * `F1.2` plan PR 11 — the workbook's `profile_code` cells, resolved for the session's organization
 * (`resolve` is `newestDeviceProfilesByCode` bound to it) and written on each Modbus row as
 * `config.profileId`, before the draft patch is built. A code the organization does not hold is a
 * 400 naming the row, never the cell (§4.3, §9.6); a sheet naming no profile reads nothing.
 */
export async function applyWorkbookProfiles(
  parsed: { readonly rtus: ParsedExcel["rtus"]; readonly rtuProfileCodes?: ParsedExcel["rtuProfileCodes"] },
  resolve: (codes: readonly string[]) => Promise<ReadonlyMap<string, OnboardingProfileRef>>,
): Promise<void> {
  // Optional here only: `parseUpload` always sets it; a spec's stand-in parser may not.
  const named = parsed.rtuProfileCodes ?? [];
  if (named.length === 0) {
    return;
  }
  const found = await resolve(named.map((entry) => entry.code));
  for (const { rtuIndex, code } of named) {
    const profile = found.get(code);
    if (!profile) {
      throw new BadRequestException(
        `RTU row ${rtuIndex + 1} names a profile_code this organization does not hold; copy it from the Device profiles page and upload the workbook again`,
      );
    }
    const rtu = parsed.rtus[rtuIndex];
    rtu.config = { ...rtu.config, profileId: profile.id };
  }
}
