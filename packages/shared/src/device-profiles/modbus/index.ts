import { type DeviceProfile, deviceProfileSchema } from "../../ingest-modbus";
import elmeasureLgPlus5310 from "./elmeasure-lg-plus-5310.json";
import selecMfm384CCe from "./selec-mfm384-c-ce.json";

/**
 * The stock Modbus device profiles (ADR 0141 decision 14, `F1.2`).
 *
 * One JSON file per meter beside this index, each citing the public manual
 * its registers were read from (`source: { document, revision, pages }`) and
 * shipped with `verified: false` until a real device has been read (decision
 * 21). An organization imports a stock profile as a copy into its own rows;
 * no row is shared. Each meter is one JSON import and one entry in
 * `STOCK_FILES` (plan PR 9).
 *
 * `stock-profiles.spec.ts` validates every entry; the parse below also means
 * a malformed file fails at import rather than reaching an organization.
 */
// Append-only; the simulator's unit ids follow this order (unit n = entry n,
// `apps/sim/src/modbus-sim.js`, `docs/local-setup.md`). S6 in
// `stock-profiles.spec.ts` pins the first two.
const STOCK_FILES: readonly unknown[] = [elmeasureLgPlus5310, selecMfm384CCe];

export const STOCK_MODBUS_PROFILES: readonly DeviceProfile[] = STOCK_FILES.map((file) =>
  deviceProfileSchema.parse(file),
);
