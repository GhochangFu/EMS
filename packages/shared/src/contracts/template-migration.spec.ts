import { expect } from "vitest";

import { templateMigrationAssetDtoSchema } from "./template-migration";

const row = {
  assetId: "a",
  assetCode: "PUMP-01",
  assetRtuName: "Lotapata I",
  assetLocationName: "Lotapata",
  assetName: "Pump",
  fromVersionId: "v1",
  fromVersion: 1,
};

/** Catches the F4.316 name optional rather than required-nullable: a producer that forgets it still parses. */
export function aMigrationAssetWithoutTheRtuNameIsRefused(): void {
  const { assetRtuName: _omitted, ...without } = row;
  expect(templateMigrationAssetDtoSchema.safeParse(without).success).toBe(false);
}

/** Same, for the location name. */
export function aMigrationAssetWithoutTheLocationNameIsRefused(): void {
  const { assetLocationName: _omitted, ...without } = row;
  expect(templateMigrationAssetDtoSchema.safeParse(without).success).toBe(false);
}

/** Catches the names non-nullable: an RTU-less asset has `assetRtuName: null`. */
export function aMigrationAssetWithNullNamesParses(): void {
  expect(
    templateMigrationAssetDtoSchema.safeParse({
      ...row,
      assetRtuName: null,
      assetLocationName: null,
    }).success,
  ).toBe(true);
}
