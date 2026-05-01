import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

export const CR_ELECTRICAL_CODES = [
  "CR-UTILITY-11KV",
  "CR-XFMR-100KVA",
  "CR-MAIN-BUS",
  "CR-UPS-OUT-BUS",
  "CR-Q1",
  "CR-Q2",
  "CR-Q3",
  "CR-Q4",
  "CR-Q5",
  "CR-Q6",
  "CR-Q7",
  "CR-Q8",
  "CR-Q9",
  "CR-Q10",
  "CR-Q11",
  "CR-Q12",
  "CR-UPS-1",
  "CR-UPS-2",
  "CR-BATT-1",
  "CR-BATT-2",
  "CR-HVAC-1",
  "CR-HVAC-2",
  "CR-LIGHT-AUX",
] as const;

export const CR_IT_CODES = [
  "CR-NET-RACK",
  "CR-VW-SRV-RACK",
  "CR-NET-RACK-PDU-A",
  "CR-NET-RACK-PDU-B",
  "CR-VW-RACK-PDU-A",
  "CR-VW-RACK-PDU-B",
] as const;

export const CR_ENVIRONMENT_CODES = [
  "CR-ENV-OP-CONSOLE",
  "CR-ENV-VIDEOWALL",
  "CR-ENV-RACK-A",
  "CR-ENV-RACK-B",
  "CR-ENV-BATTERY-ROOM",
  "CR-ENV-UPS-ROOM",
  "CR-LEAK-01",
  "CR-LEAK-02",
  "CR-LEAK-03",
  "CR-LEAK-04",
  "CR-SMOKE-01",
  "CR-SMOKE-02",
  "CR-SMOKE-03",
  "CR-SMOKE-04",
] as const;

export const CR_TRACKED_ASSET_CODES = [
  ...CR_ELECTRICAL_CODES,
  ...CR_IT_CODES,
  ...CR_ENVIRONMENT_CODES,
];

export const CR_POINT_KEYS = [
  ...CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  ...CONTROL_ROOM_UPS_POINT_KEYS,
  ...CONTROL_ROOM_IT_POINT_KEYS,
  ...HVAC_POINT_KEYS,
  ...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
] as const;

export type CrBreakerBinding = {
  code: string;
  label: string;
  position: string;
  rating: string;
  tripCause: string;
};

export const CR_BREAKERS: CrBreakerBinding[] = [
  { code: "CR-Q1", label: "Q1 · Main MCCB", position: "Main Panel", rating: "100 A", tripCause: "-" },
  { code: "CR-Q2", label: "Q2 · UPS-1 IN", position: "MCB Section A", rating: "40 A", tripCause: "-" },
  { code: "CR-Q3", label: "Q3 · UPS-2 IN", position: "MCB Section A", rating: "40 A", tripCause: "-" },
  { code: "CR-Q4", label: "Q4 · UPS-1 OUT", position: "UPS-1 Output", rating: "40 A", tripCause: "-" },
  { code: "CR-Q5", label: "Q5 · UPS-2 OUT", position: "UPS-2 Output", rating: "40 A", tripCause: "-" },
  { code: "CR-Q6", label: "Q6 · Net Rack PDU-A", position: "Load Bus", rating: "16 A", tripCause: "-" },
  { code: "CR-Q7", label: "Q7 · Net Rack PDU-B", position: "Load Bus", rating: "16 A", tripCause: "-" },
  { code: "CR-Q8", label: "Q8 · VW Rack PDU-A", position: "Load Bus", rating: "16 A", tripCause: "-" },
  { code: "CR-Q9", label: "Q9 · VW Rack PDU-B", position: "Load Bus", rating: "16 A", tripCause: "high I^2t" },
  { code: "CR-Q10", label: "Q10 · HVAC-1", position: "Mains", rating: "25 A", tripCause: "-" },
  { code: "CR-Q11", label: "Q11 · HVAC-2", position: "Mains", rating: "25 A", tripCause: "manual" },
  { code: "CR-Q12", label: "Q12 · CR Lighting", position: "Mains", rating: "10 A", tripCause: "-" },
];

export const CR_SERVERS = [
  { rack: "Network Rack", id: "CORE-SW-01", type: "Core Switch L3", watts: 280 },
  { rack: "Network Rack", id: "CORE-SW-02", type: "Core Switch L3 (HA)", watts: 275 },
  { rack: "Network Rack", id: "FW-PRI", type: "Firewall (Primary)", watts: 340 },
  { rack: "Network Rack", id: "FW-SEC", type: "Firewall (Standby)", watts: 310 },
  { rack: "Network Rack", id: "AGG-SW-01", type: "Aggregation Switch", watts: 220 },
  { rack: "Network Rack", id: "OOB-MGT", type: "OOB Management Switch", watts: 120 },
  { rack: "Videowall Server Rack", id: "VW-CTRL-01", type: "Videowall Controller", watts: 520 },
  { rack: "Videowall Server Rack", id: "VW-CTRL-02", type: "Videowall Failover", watts: 340 },
  { rack: "Videowall Server Rack", id: "VW-MEDIA", type: "Media Aggregator", watts: 280 },
  { rack: "Videowall Server Rack", id: "VW-NVR", type: "CCTV NVR (32-ch)", watts: 180 },
] as const;
