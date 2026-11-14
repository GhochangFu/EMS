import {
  type TariffCatalogCategory,
  type TariffCatalogSnapshot,
  tariffCatalogSnapshotSchema,
} from "@bms/shared";

import { quoteCell } from "../admin/spreadsheet-guard";

/**
 * `F4.365` (ADR 0134 decisions 1–2, plan D1/D7/D13) — the owner's workbook's
 * **Rate Chart** sheet, parsed into the committed catalog snapshot.
 *
 * Pure: rows arrive as arrays (header row first), already read with formulas
 * off. Every refusal names the sheet row and column. Nothing is guessed: an
 * unknown enum string, a gap in slab bounds or two different fixed bases on
 * one key is a refusal, not a default.
 */

export const RATE_CHART_SHEET = "Rate Chart";
export const RATE_CHART_MAX_ROWS = 5000;

export const RATE_CHART_HEADER = [
  "Category Key",
  "Area ID",
  "State / UT",
  "Discom(s)",
  "Ownership",
  "Category Code",
  "Category",
  "Segment",
  "Supply",
  "Slab No",
  "Slab From (units)",
  "Slab To (units)",
  "Energy Charge (Rs/unit)",
  "Energy Unit",
  "Fixed/Demand Charge (Rs)",
  "Fixed Charge Basis",
  "Wheeling / Reg. Surcharge (Rs/unit)",
  "Notes",
  "Data Status",
  "Tariff Order",
  "Effective From",
  "Source",
] as const;

const COL = {
  key: 0,
  areaId: 1,
  state: 2,
  discoms: 3,
  ownership: 4,
  code: 5,
  name: 6,
  segment: 7,
  supply: 8,
  slabNo: 9,
  from: 10,
  to: 11,
  energyRate: 12,
  energyUnit: 13,
  fixedRate: 14,
  fixedBasis: 15,
  wheelingRate: 16,
  notes: 17,
  dataStatus: 18,
  tariffOrder: 19,
  effectiveFrom: 20,
  sourceUrl: 21,
} as const;

const ENERGY_UNITS: Record<string, "kwh" | "kvah"> = { kWh: "kwh", kVAh: "kvah" };
const FIXED_BASES: Record<string, TariffCatalogCategory["fixedBasis"]> = {
  "Rs/kW/month": "per_kw_month",
  "Rs/kVA/month": "per_kva_month",
  "Rs/HP/month": "per_hp_month",
  "Rs/connection/month": "per_connection_month",
  "Rs/connection/bi-month": "per_connection_bimonth",
};
const DATA_STATUSES: Record<string, TariffCatalogCategory["dataStatus"]> = {
  "Official tariff schedule/order": "official",
  "Secondary source (news/regulator summary)": "secondary",
  "Indicative - verify": "indicative",
};

/** Category columns that must be identical on every row of a key (basis is D7's own rule). */
const CATEGORY_COLUMNS = [
  COL.areaId,
  COL.state,
  COL.discoms,
  COL.ownership,
  COL.code,
  COL.name,
  COL.segment,
  COL.supply,
  COL.energyUnit,
  COL.dataStatus,
  COL.tariffOrder,
  COL.effectiveFrom,
  COL.sourceUrl,
] as const;

type Cell = unknown;
type ParseResult = { ok: true; snapshot: TariffCatalogSnapshot } | { ok: false; problems: string[] };

const text = (cell: Cell): string => (cell === null || cell === undefined ? "" : String(cell).trim());
const where = (row: number, col: number): string => `row ${row + 1}, column "${RATE_CHART_HEADER[col]}"`;

export function parseRateChart(
  rows: readonly (readonly Cell[])[],
  source: { workbook: string; sha256: string },
): ParseResult {
  const problems: string[] = [];
  const header = (rows[0] ?? []).map(text);
  if (RATE_CHART_HEADER.some((title, i) => header[i] !== title)) {
    return { ok: false, problems: [`the header row must be: ${RATE_CHART_HEADER.join(" | ")}`] };
  }
  if (rows.length - 1 > RATE_CHART_MAX_ROWS) {
    return { ok: false, problems: [`more than ${RATE_CHART_MAX_ROWS} data rows`] };
  }

  const num = (r: number, c: number, cell: Cell, blankAs: number | null): number | null => {
    const t = text(cell);
    if (t === "") {
      if (blankAs === null) return null;
      return blankAs;
    }
    const n = typeof cell === "number" ? cell : Number(t);
    if (!Number.isFinite(n) || n < 0) {
      problems.push(`${where(r, c)}: ${quoteCell(t)} is not a number >= 0`);
      return 0;
    }
    return n;
  };

  const groups: { key: string; rows: number[] }[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r += 1) {
    const key = text(rows[r][COL.key]);
    if (key === "") {
      if (rows[r].some((c) => text(c) !== "")) problems.push(`${where(r, COL.key)}: blank key on a non-blank row`);
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.rows.push(r);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`${where(r, COL.key)}: ${quoteCell(key)} appears again after other keys; a key's rows must be contiguous`);
      continue;
    }
    seen.add(key);
    groups.push({ key, rows: [r] });
  }

  const categories: TariffCatalogCategory[] = [];
  for (const group of groups) {
    const first = rows[group.rows[0]];
    for (const r of group.rows.slice(1)) {
      for (const c of CATEGORY_COLUMNS) {
        if (text(rows[r][c]) !== text(first[c])) {
          problems.push(`${where(r, c)}: ${quoteCell(text(rows[r][c]))} differs from the key's first row`);
        }
      }
    }

    const r0 = group.rows[0];
    const energyUnit = ENERGY_UNITS[text(first[COL.energyUnit])];
    if (!energyUnit) problems.push(`${where(r0, COL.energyUnit)}: unknown unit ${quoteCell(text(first[COL.energyUnit]))}`);
    const dataStatus = DATA_STATUSES[text(first[COL.dataStatus])];
    if (!dataStatus) problems.push(`${where(r0, COL.dataStatus)}: unknown status ${quoteCell(text(first[COL.dataStatus]))}`);

    // D7: the one distinct non-blank basis across the key's rows, `none` when all blank.
    const bases = new Set<string>();
    for (const r of group.rows) {
      const b = text(rows[r][COL.fixedBasis]);
      if (b === "") continue;
      if (!FIXED_BASES[b]) problems.push(`${where(r, COL.fixedBasis)}: unknown basis ${quoteCell(b)}`);
      bases.add(b);
    }
    if (bases.size > 1) problems.push(`${where(r0, COL.fixedBasis)}: ${quoteCell(group.key)} mixes bases ${[...bases].join(", ")}`);
    const fixedBasis = bases.size === 1 ? (FIXED_BASES[[...bases][0]] ?? "none") : "none";

    const eff = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text(first[COL.effectiveFrom]));
    if (!eff || eff[1] !== "01") {
      problems.push(`${where(r0, COL.effectiveFrom)}: ${quoteCell(text(first[COL.effectiveFrom]))} is not dd-mm-yyyy on day 01`);
    }
    const effectiveFrom = eff ? `${eff[3]}-${eff[2]}-01` : "";

    const sourceUrl = text(first[COL.sourceUrl]);
    if (sourceUrl !== "" && !/^https?:\/\//.test(sourceUrl)) {
      problems.push(`${where(r0, COL.sourceUrl)}: ${quoteCell(sourceUrl)} is not an http(s) URL`);
    }

    const slabs = group.rows.map((r, i) => {
      const slabNo = num(r, COL.slabNo, rows[r][COL.slabNo], null);
      if (slabNo !== i + 1) problems.push(`${where(r, COL.slabNo)}: expected slab ${i + 1}`);
      const notes = text(rows[r][COL.notes]);
      return {
        slabNo: i + 1,
        fromUnits: num(r, COL.from, rows[r][COL.from], null) ?? -1,
        toUnits: num(r, COL.to, rows[r][COL.to], null),
        energyRate: num(r, COL.energyRate, rows[r][COL.energyRate], null) ?? 0,
        fixedRate: num(r, COL.fixedRate, rows[r][COL.fixedRate], 0) ?? 0,
        wheelingRate: num(r, COL.wheelingRate, rows[r][COL.wheelingRate], 0) ?? 0,
        notes: notes === "" ? null : notes,
      };
    });

    const orNull = (c: number): string | null => (text(first[c]) === "" ? null : text(first[c]));
    categories.push({
      key: group.key,
      areaId: text(first[COL.areaId]),
      state: text(first[COL.state]),
      discoms: text(first[COL.discoms]),
      ownership: text(first[COL.ownership]),
      code: text(first[COL.code]),
      name: text(first[COL.name]),
      segment: text(first[COL.segment]),
      supply: text(first[COL.supply]),
      energyUnit: energyUnit ?? "kwh",
      fixedBasis,
      dataStatus: dataStatus ?? "official",
      tariffOrder: orNull(COL.tariffOrder),
      sourceUrl: sourceUrl === "" ? null : sourceUrl,
      notes: null,
      effectiveFrom,
      slabs,
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  const parsed = tariffCatalogSnapshotSchema.safeParse({
    source: { ...source, sheet: RATE_CHART_SHEET },
    categories,
  });
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => {
        const [, index] = issue.path;
        const key = typeof index === "number" ? categories[index]?.key : undefined;
        return `${key ? `${quoteCell(key)}: ` : ""}${issue.path.slice(2).join(".")} ${issue.message}`;
      }),
    };
  }
  return { ok: true, snapshot: parsed.data };
}

/** Stable JSON: categories sorted by key then effectiveFrom, 2-space indent, trailing newline. */
export function serialiseSnapshot(snapshot: TariffCatalogSnapshot): string {
  const categories = [...snapshot.categories].sort((a, b) =>
    a.key === b.key ? a.effectiveFrom.localeCompare(b.effectiveFrom) : a.key < b.key ? -1 : 1,
  );
  return `${JSON.stringify({ source: snapshot.source, categories }, null, 2)}\n`;
}
