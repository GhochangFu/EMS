/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 6 (security review M3) — the units a
 * fact line may carry to the provider, matched exactly. A unit is free text on
 * an asset point; anything not on this list makes the card not sendable (facts
 * only, no call), so no organization's own words ride along as a "unit".
 *
 * Built from the units the repository uses (point-key and asset-template
 * catalogs, seeds, the simulator) plus the common engineering units of the
 * same families. Widen it here, by hand, when a real point needs another; never
 * accept a pattern.
 */
export const FINDINGS_UNIT_ALLOW_LIST: readonly string[] = [
  // Temperature
  "°C", "°F", "C", "K",
  // Ratios and states
  "%", "PF", "state",
  // Power and energy
  "W", "kW", "MW", "kw", "Wh", "kWh", "MWh", "kwh",
  "VA", "kVA", "kVAh", "kvah", "VAR", "kVAR", "kVAr", "kVArh",
  // Electrical
  "V", "kV", "A", "mA", "Hz",
  // Pressure
  "Pa", "kPa", "bar", "mbar", "psi",
  // Water quality
  "ppm", "pH", "NTU", "µS/cm", "mg/L",
  // Volume and flow
  "L", "kL", "KL", "m³", "m3", "L/s", "L/min", "L/h", "kL/h", "KL/hr", "m³/h", "m3/h", "m3/hr",
  // Speed, time, length, area, mass, light, sound
  "rpm", "s", "ms", "min", "h", "mm", "cm", "m", "m2", "ft2", "sqft", "kg", "t", "lux", "dB",
];
