import { ASSET_LABEL_SEPARATOR, assetLabelParts } from "@bms/shared";

/**
 * F4.316 / ADR 0111 — the `· where` half of an asset's label, under a code cell that already
 * prints the bare code. The rule (RTU, else location, else nothing) is `assetLabelParts`, the one
 * formatter; the text wraps and is never truncated.
 */
export function AssetWhere({
  code,
  rtuName,
  locationName,
  className = "",
}: {
  code: string;
  rtuName: string | null;
  locationName: string | null;
  className?: string;
}) {
  const { where } = assetLabelParts({ code, rtuName, locationName });
  if (where === null) return null;
  return (
    <div className={`break-words font-sans text-[11px] text-ink-muted ${className}`.trim()}>
      {`${ASSET_LABEL_SEPARATOR.trim()} ${where}`}
    </div>
  );
}
