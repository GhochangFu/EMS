import type { AssetRow } from "../api/assets";

type SchematicAsset = Pick<AssetRow, "code">;

/** Returns true when the current scoped asset list contains every schematic asset code. */
export function hasCompleteSchematicAssets(
  assets: readonly SchematicAsset[] | undefined,
  assetCodes: readonly string[],
): boolean {
  if (!assets || assets.length === 0) {
    return false;
  }
  const availableCodes = new Set(assets.map((asset) => asset.code));
  return assetCodes.every((code) => availableCodes.has(code));
}
