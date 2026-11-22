import { type DeviceProfile, deviceProfileSchema } from "../../ingest-modbus";

/**
 * The stock Modbus device profiles (ADR 0141 decision 14, `F1.2`).
 *
 * One JSON file per meter beside this index, each citing the public manual
 * its registers were read from (`source: { document, revision, pages }`) and
 * shipped with `verified: false` until a real device has been read (decision
 * 21). An organization imports a stock profile as a copy into its own rows;
 * no row is shared. Empty until plan PR 9 adds the meters: each adds one JSON
 * import and one entry in `STOCK_FILES`.
 *
 * `stock-profiles.spec.ts` validates every entry; the parse below also means
 * a malformed file fails at import rather than reaching an organization.
 */
const STOCK_FILES: readonly unknown[] = [];

export const STOCK_MODBUS_PROFILES: readonly DeviceProfile[] = STOCK_FILES.map((file) =>
  deviceProfileSchema.parse(file),
);
