import { copilotTelemetryImportPreviewSchema } from "@bms/shared/contracts";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18; owner ruling 2026-10-24, drafter
 * choices 4 and 10) — what the telemetry import card shows from its card-only
 * `preview`: the route's own preview counts, up to 20 of its rejected rows and
 * up to 50 of the `asset_points` mappings the commit would create. The commit
 * stays the authority: a row the preview accepts can still be rejected then.
 */
export function ImportPreviewCard({ preview }: { preview: unknown }) {
  const parsed = copilotTelemetryImportPreviewSchema.safeParse(preview);
  if (!parsed.success) return null;
  const { totalRows, acceptedCount, rejectedCount, rejected, mappingsToCreate } = parsed.data;
  return (
    <section data-testid="copilot-import-preview" aria-label="Import preview" className="mt-2 space-y-1 text-[11px] text-ink">
      <p>{`${acceptedCount} of ${totalRows} rows accepted, ${rejectedCount} rejected.`}</p>
      {rejected.length > 0 && (
        <ul aria-label="Rejected rows" className="list-disc pl-4">
          {rejected.map((row) => (
            <li key={`${row.rowNumber}-${row.field ?? ""}`}>{`Row ${row.rowNumber}${row.field ? ` (${row.field})` : ""}: ${row.reason}`}</li>
          ))}
        </ul>
      )}
      {mappingsToCreate.length > 0 && (
        <ul aria-label="Point mappings to create" className="list-disc pl-4">
          {mappingsToCreate.map((mapping) => (
            <li key={`${mapping.assetCode}/${mapping.pointKey}`}>{`${mapping.assetCode}/${mapping.pointKey}`}</li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted">Conflicting readings are rejected.</p>
      <p className="text-ink-muted">The file stays in this browser until Confirm; the commit is the authority.</p>
    </section>
  );
}
