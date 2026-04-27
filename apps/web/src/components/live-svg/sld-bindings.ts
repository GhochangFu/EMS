/**
 * Maps seeded `bms.assets.code` values to SLD geometry (mockup `R.sld`).
 * Simulator orders assets by `code asc`; UI resolves by code, not array index.
 */
export type SldFeederBinding = {
  assetCode: string;
  /** Vertical drop x position (mock viewBox 0–900). */
  x: number;
  feederCode: string;
  loadLabel: string;
};

export const SLD_FEEDERS: SldFeederBinding[] = [
  { assetCode: "TX-L1-MV", x: 150, feederCode: "MDB-1", loadLabel: "IT Load A" },
  { assetCode: "SWG-MDB1", x: 270, feederCode: "MDB-2", loadLabel: "IT Load B" },
  { assetCode: "CH-CRAC-101", x: 390, feederCode: "MDB-3", loadLabel: "HVAC" },
  { assetCode: "CH-CRAC-102", x: 510, feederCode: "MDB-4", loadLabel: "Pumps" },
  { assetCode: "UPS-A", x: 630, feederCode: "MDB-5", loadLabel: "Lighting" },
  { assetCode: "PV-INV-01", x: 750, feederCode: "MDB-6", loadLabel: "Services" },
];

/** UPS branch (centre tap) — same UPS asset as MDB-5 feeder for prototype. */
export const SLD_UPS_ASSET_CODE = "UPS-A";

/** Left utility transformer narrative uses main TX asset. */
export const SLD_TX_LEFT_CODE = "TX-L1-MV";

/** Right utility transformer — second incomer (main board) for visual balance. */
export const SLD_TX_RIGHT_CODE = "SWG-MDB1";

const codes = new Set<string>();
for (const f of SLD_FEEDERS) {
  codes.add(f.assetCode);
}
codes.add(SLD_UPS_ASSET_CODE);
codes.add(SLD_TX_LEFT_CODE);
codes.add(SLD_TX_RIGHT_CODE);

/** All asset codes that participate in live telemetry for the SLD. */
export const SLD_TRACKED_ASSET_CODES: string[] = [...codes];
