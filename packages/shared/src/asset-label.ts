/**
 * `F4.316` / ADR 0111 — the one place an asset is named for a person.
 *
 * `<code> · <RTU display name>`, or `<code> · <location name>` when the asset has no RTU, or the
 * bare code when neither is known. The RTU wins over the location because the RTU is the more
 * specific answer to "which one": the same code can sit under two RTUs of one site.
 *
 * Pure and zod-free, so the api, the web, the exports and the copilot all print the same string.
 */
export const ASSET_LABEL_SEPARATOR = " · ";

/** The three facts a label is built from. */
export interface AssetLabelParts {
  readonly code: string;
  readonly rtuName: string | null;
  readonly locationName: string | null;
}

/** The DTO shape most call sites hold (`assetCode` / `assetRtuName` / `assetLocationName`). */
export interface AssetLabelRow {
  readonly assetCode: string;
  readonly assetRtuName: string | null;
  readonly assetLocationName: string | null;
}

/** The code and its `where` (RTU name, else location name, else null), for a screen that styles them apart. */
export function assetLabelParts(parts: AssetLabelParts): {
  code: string;
  where: string | null;
} {
  return { code: parts.code, where: parts.rtuName ?? parts.locationName };
}

/** `<code> · <RTU>`, `<code> · <location>` when there is no RTU, else the bare code. */
export function assetLabel(parts: AssetLabelParts): string {
  const { code, where } = assetLabelParts(parts);
  return where === null ? code : `${code}${ASSET_LABEL_SEPARATOR}${where}`;
}

/** `assetLabel` over a DTO row's `assetCode` / `assetRtuName` / `assetLocationName`. */
export function assetLabelOf(row: AssetLabelRow): string {
  return assetLabel({
    code: row.assetCode,
    rtuName: row.assetRtuName,
    locationName: row.assetLocationName,
  });
}
