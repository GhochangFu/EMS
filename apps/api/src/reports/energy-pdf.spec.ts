import { createHash } from "node:crypto";

import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import { energyPdfDefinition, LOCAL_ACCESS_POLICY, renderPdf, STANDARD_FONTS } from "./energy-pdf";
import { energyTable } from "./reports.serialise";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function consumer(overrides: Partial<EnergyTopConsumer> = {}): EnergyTopConsumer {
  return {
    assetId: "00000000-0000-4000-8000-000000000001",
    code: "CH-01",
    name: "Chiller 1",
    siteName: "Plant B",
    avgKw: 383.57,
    estimatedKwh: 870.6,
    ...overrides,
  };
}

function preview(overrides: Partial<EnergyReportPreview> = {}): EnergyReportPreview {
  return {
    template: {
      id: "energy_consumption",
      title: "Energy Consumption",
      description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
      formats: ["CSV", "XLSX", "PDF"],
      active: true,
    },
    range: { startDate: "2026-08-01", endDate: "2026-08-07", durationHours: 168 },
    generatedAt: "2026-08-10T12:00:00.000Z",
    summary: {
      window: "custom",
      totalKwh: 2345.17,
      peakKw: 414.66,
      pueEstimate: 1.25,
      indicativeCost: 5042.12,
      tariffPerKwh: 2.15,
      currency: "ZAR",
      asOf: "2026-08-10T12:00:00.000Z",
    },
    sourceTotals: { gridKwh: 2130.37, solarKwh: 126.04, dgKwh: 88.76 },
    topConsumers: [consumer()],
    notes: [],
    ...overrides,
  };
}

/** Every `text` value anywhere inside a pdfmake `Content` tree, depth-first. */
function collectTexts(node: unknown, out: string[]): void {
  if (node == null) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectTexts(item, out);
    }
    return;
  }
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") {
      out.push(record.text);
    } else if (Array.isArray(record.text)) {
      collectTexts(record.text, out);
    }
    for (const value of Object.values(record)) {
      if (value !== record.text) {
        collectTexts(value, out);
      }
    }
  }
}

function textsOf(definition: ReturnType<typeof energyPdfDefinition>): string[] {
  const out: string[] = [];
  collectTexts(definition.content, out);
  return out;
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** ADR 0071 U1 — every cell of `energyTable` reaches the PDF definition. */
export function assertDefinitionCarriesEveryTableCell(input: EnergyReportPreview = preview()): void {
  const definition = energyPdfDefinition(input);
  const texts = textsOf(definition);
  for (const row of energyTable(input)) {
    for (const cell of row) {
      if (typeof cell === "number") {
        assert(
          texts.includes(numberFormat.format(cell)),
          `formatted number ${numberFormat.format(cell)} must appear in the PDF definition`,
        );
      } else {
        assert(texts.includes(cell), `cell ${JSON.stringify(cell)} must appear in the PDF definition`);
      }
    }
  }
}

/** R-2 — money keeps the ISO code beside the amount, never a symbol. */
export function assertMoneyCarriesTheCodeAndNoSymbol(): void {
  const zar = energyPdfDefinition(preview());
  const zarTexts = textsOf(zar);
  assert(zarTexts.includes("ZAR"), "the ZAR cost row must carry the currency code as its own cell");
  const serialised = JSON.stringify(zar);
  for (const symbol of ["₹", "$", "€", "£"]) {
    assert(!serialised.includes(symbol), `no currency symbol (${symbol}) may appear in the PDF definition`);
  }
  assert(!/R\s?\d/.test(serialised), "no 'R '-prefixed amount may appear in the PDF definition");

  // Positive control: a different code changes what appears.
  const inr = energyPdfDefinition(
    preview({ summary: { ...preview().summary, currency: "INR" } }),
  );
  assert(textsOf(inr).includes("INR"), "an INR organization must carry INR, not ZAR, as the positive control");
}

/** R-2 — a null indicative cost renders the table's own U+2014, never a hyphen. */
export function assertNullCostRendersTheDash(): void {
  const definition = energyPdfDefinition(
    preview({ summary: { ...preview().summary, indicativeCost: null } }),
  );
  const texts = textsOf(definition);
  assert(texts.includes("—"), "a null indicative cost must render the em dash U+2014");
  assert(!texts.includes("-"), "a null indicative cost must not render a plain hyphen");
}

/** `renderPdf` produces real PDF bytes: `%PDF-` header, `%%EOF` tail. */
export async function assertRenderProducesAPdf(): Promise<void> {
  const buffer = await renderPdf(energyPdfDefinition(preview()));
  assert(Buffer.isBuffer(buffer), "renderPdf must resolve a Buffer");
  assert(buffer.subarray(0, 5).toString("latin1") === "%PDF-", "the buffer must start with the PDF header");
  const tail = buffer.subarray(Math.max(0, buffer.length - 32)).toString("latin1");
  assert(tail.includes("%%EOF"), "the buffer must end with %%EOF — a stream read before 'end' would miss it");
}

/** Decision 2's fallback-glyph consequence: a non-WinAnsi name does not throw. */
export async function assertNonWinAnsiNameDoesNotThrow(): Promise<void> {
  const input = preview({ topConsumers: [consumer({ name: "冷却塔 1" })] });
  const buffer = await renderPdf(energyPdfDefinition(input));
  assert(buffer.subarray(0, 5).toString("latin1") === "%PDF-", "a non-WinAnsi name must still render a PDF");
}

/**
 * An empty scope — a scoped user with no readable asset — renders too: no
 * consumers, a `null` cost and tariff, and the three U+2014 cells. The
 * post-merge sweep found no row exercised this shape; the API's `[]` scope
 * short-circuits every pool read and reaches the renderer with exactly it.
 */
export async function assertEmptyScopeRendersAPdf(): Promise<void> {
  const input = preview({
    topConsumers: [],
    summary: { ...preview().summary, totalKwh: 0, peakKw: 0, pueEstimate: null, indicativeCost: null, tariffPerKwh: null, currency: null },
    sourceTotals: { gridKwh: 0, solarKwh: 0, dgKwh: 0 },
  });
  const buffer = await renderPdf(energyPdfDefinition(input));
  assert(buffer.subarray(0, 5).toString("latin1") === "%PDF-", "an empty scope must still render a PDF");
  assert(buffer.subarray(-16).toString("latin1").includes("%%EOF"), "an empty-scope PDF must be closed");
}

/** `STANDARD_FONTS` names the standard-14 Helvetica by string, no file. */
export function assertFontsAreTheStandardFourWithNoFile(): void {
  const helvetica = STANDARD_FONTS.Helvetica as Record<string, string>;
  assert(helvetica.normal === "Helvetica", "normal must be the bare Helvetica name");
  assert(helvetica.bold === "Helvetica-Bold", "bold must be the bare Helvetica-Bold name");
  assert(helvetica.italics === "Helvetica-Oblique", "italics must be the bare Helvetica-Oblique name");
  assert(
    helvetica.bolditalics === "Helvetica-BoldOblique",
    "bolditalics must be the bare Helvetica-BoldOblique name",
  );
  for (const value of Object.values(helvetica)) {
    assert(!value.toLowerCase().endsWith(".ttf"), `${value} must not name a font file`);
  }
}

// ---------------------------------------------------------------------------
// Amendment 1 item 5 — the resource access policy (measured, step-5 review)
// ---------------------------------------------------------------------------

const STANDARD_14_NAMES = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"];

/** The policy allows exactly the four Standard-14 names and nothing else. */
export function assertLocalPolicyAllowsExactlyTheStandardFour(): void {
  for (const name of STANDARD_14_NAMES) {
    assert(LOCAL_ACCESS_POLICY(name) === true, `${name} must be allowed by the local access policy`);
  }
  for (const path of ["Helvetica.ttf", "/usr/share/fonts/Helvetica.ttf", "C:\\Windows\\Fonts\\arial.ttf", "/etc/passwd", "Times-Roman", ""]) {
    assert(LOCAL_ACCESS_POLICY(path) === false, `${JSON.stringify(path)} must be denied by the local access policy`);
  }
}

/** Both policies are set, so `createPdf` emits no `console.warn` (the two-line residual is gone). */
export async function assertRenderEmitsNoWarning(): Promise<void> {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    const buffer = await renderPdf(energyPdfDefinition(preview()));
    assert(buffer.subarray(0, 5).toString("latin1") === "%PDF-", "the positive control must still render a PDF");
  } finally {
    console.warn = original;
  }
  assert(warns.length === 0, `renderPdf must emit no console.warn, got ${JSON.stringify(warns)}`);
}

/**
 * A definition naming a local file path is refused **by the policy** — the
 * message is pdfmake's `denied by resource access policy`, not the
 * `Invalid image ... ENOENT` an un-policied render throws for the same path
 * (measured: without the policy the ENOENT is what surfaces, so a message
 * assertion is what separates "refused" from "not found").
 */
export async function assertRenderRefusesALocalFilePath(): Promise<void> {
  const definition = energyPdfDefinition(preview());
  const hostile = { ...definition, content: [{ image: "/etc/passwd" }] };
  let caught: unknown;
  try {
    await renderPdf(hostile);
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof Error, "a local file path in the definition must reject");
  const message = caught instanceof Error ? caught.message : String(caught);
  assert(
    message.includes("denied by resource access policy"),
    `the rejection must come from the access policy, got: ${message.split("\n")[0]}`,
  );
  assert(!message.includes("Invalid image"), "the refusal must precede the image open, not be its ENOENT");
}

// ---------------------------------------------------------------------------
// `F4.303` U12 (ADR 0108 Amendment 6 item 8, owner Q9; owner ruling Q-B) — compare on the PDF.
// ---------------------------------------------------------------------------

/**
 * `energyPdfDefinition(preview())` on `main` before `F4.303` (captured at `550dfecc`,
 * `JSON.stringify` — the footer is a function and is pinned by its own output below).
 */
const MAIN_DEFINITION_JSON =
  '{"pageSize":"A4","pageOrientation":"portrait","pageMargins":40,"defaultStyle":{"font":"Helvetica","fontSize":9},"content":[{"text":"Energy Consumption","fontSize":16,"bold":true,"margin":[0,0,0,2]},{"text":"2026-08-01 to 2026-08-07","fontSize":9,"margin":[0,0,0,2]},{"text":"Generated at 2026-08-10T12:00:00.000Z","fontSize":8,"margin":[0,0,0,10]},{"table":{"headerRows":1,"widths":["*","*"],"body":[[{"text":"Report"},{"text":"Energy Consumption"}],[{"text":"Start date"},{"text":"2026-08-01"}],[{"text":"End date"},{"text":"2026-08-07"}],[{"text":"Generated at"},{"text":"2026-08-10T12:00:00.000Z"}]]},"margin":[0,0,0,10]},{"table":{"headerRows":1,"widths":["*","*","*"],"body":[[{"text":"Metric"},{"text":"Value"},{"text":"Unit"}],[{"text":"Total energy"},{"text":"2,345.17","alignment":"right"},{"text":"kWh"}],[{"text":"Peak demand"},{"text":"414.66","alignment":"right"},{"text":"kW"}],[{"text":"PUE estimate"},{"text":"1.25","alignment":"right"},{"text":""}],[{"text":"Indicative cost"},{"text":"5,042.12","alignment":"right"},{"text":"ZAR"}],[{"text":"Tariff"},{"text":"2.15","alignment":"right"},{"text":"ZAR/kWh"}]]},"margin":[0,0,0,10]},{"table":{"headerRows":1,"widths":["*","*","*"],"body":[[{"text":"Source"},{"text":"Energy"},{"text":"Unit"}],[{"text":"Grid"},{"text":"2,130.37","alignment":"right"},{"text":"kWh"}],[{"text":"Solar"},{"text":"126.04","alignment":"right"},{"text":"kWh"}],[{"text":"Nominal DG"},{"text":"88.76","alignment":"right"},{"text":"kWh"}]]},"margin":[0,0,0,10]},{"table":{"headerRows":1,"widths":["*","*","*","*","*"],"body":[[{"text":"Asset code"},{"text":"Asset name"},{"text":"Site"},{"text":"Avg kW"},{"text":"Estimated kWh"}],[{"text":"CH-01"},{"text":"Chiller 1"},{"text":"Plant B"},{"text":"383.57","alignment":"right"},{"text":"870.6","alignment":"right"}]]},"margin":[0,0,0,10]}]}';

/**
 * The SHA-256 of `renderPdf` over that definition with `info.creationDate` pinned to the
 * epoch, on `main` before `F4.303` (owner ruling Q-B: pdfmake's creation date proved pinnable,
 * so the byte claim is made as well as the definition claim).
 */
export const MAIN_PDF_SHA256 = "8ba5d430b815c87cc4208ab6ca8c638565cdf3e798832aabc367abea7d827c68";

/** The previous period the compare claims read: 100 kWh against the fixture's 2345.17. */
export function previousPreview(): EnergyReportPreview {
  return preview({
    range: { startDate: "2026-07-25", endDate: "2026-07-31", durationHours: 168 },
    summary: { ...preview().summary, totalKwh: 100 },
  });
}

/** Without a previous period the definition is `main`'s, the footer included. */
export function assertDefinitionWithoutPreviousIsMain(): void {
  const definition = energyPdfDefinition(preview());
  const json = JSON.stringify(definition);
  assert(json === MAIN_DEFINITION_JSON, `the no-compare definition must be main's, got ${json}`);
  assert(
    JSON.stringify(energyPdfDefinition(preview(), undefined)) === json,
    "energyPdfDefinition(preview, undefined) must equal energyPdfDefinition(preview)",
  );
  const footer = definition.footer as (page: number, pages: number) => unknown;
  assert(
    JSON.stringify(footer(1, 2)) === JSON.stringify({ text: "1 / 2", alignment: "center", fontSize: 8 }),
    "the footer must be main's",
  );
}

/** Without a previous period, the PDF bytes (creation date pinned) are `main`'s. */
export async function assertPdfBytesWithoutPreviousAreMain(): Promise<void> {
  const buffer = await renderPdf({ ...energyPdfDefinition(preview()), info: { creationDate: new Date(0) } });
  const sha = createHash("sha256").update(buffer).digest("hex");
  assert(sha === MAIN_PDF_SHA256, `the no-compare PDF bytes must be main's, got sha256 ${sha}`);
}

function tablesOf(definition: ReturnType<typeof energyPdfDefinition>): { body: { text: string }[][]; widths: unknown[] }[] {
  return (definition.content as { table?: { body: { text: string }[][]; widths: unknown[] } }[])
    .flatMap((node) => (node.table === undefined ? [] : [node.table]));
}

/** With a previous period, the metric table is five columns wide with the Previous and Change cells. */
export function assertDefinitionWithPreviousCarriesFiveColumnMetricTable(): void {
  const metric = tablesOf(energyPdfDefinition(preview(), previousPreview())).find(
    (table) => table.body[0]?.[0]?.text === "Metric",
  );
  assert(metric !== undefined, "the metric table must be present");
  assert(metric?.widths.length === 5, `the metric table must be five columns wide, got ${metric?.widths.length}`);
  assert(
    JSON.stringify(metric?.body[0]?.map((cell) => cell.text)) === JSON.stringify(["Metric", "Value", "Unit", "Previous", "Change"]),
    `the metric header must carry Previous and Change, got ${JSON.stringify(metric?.body[0])}`,
  );
  assert(
    JSON.stringify(metric?.body[1]?.map((cell) => cell.text)) === JSON.stringify(["Total energy", "2,345.17", "kWh", "100", "2,245.2"]),
    `the total energy row must carry the previous value and the change, got ${JSON.stringify(metric?.body[1])}`,
  );
}

/** With a previous period, the head table carries the `Previous period` row after `End date`. */
export function assertDefinitionWithPreviousCarriesTheHeadRow(): void {
  const head = tablesOf(energyPdfDefinition(preview(), previousPreview())).find(
    (table) => table.body[0]?.[0]?.text === "Report",
  );
  const texts = head?.body.map((row) => row.map((cell) => cell.text)) ?? [];
  const end = texts.findIndex((row) => row[0] === "End date");
  assert(
    JSON.stringify(texts[end + 1]) === JSON.stringify(["Previous period", "2026-07-25 to 2026-07-31"]),
    `the head table must carry the previous period after End date, got ${JSON.stringify(texts[end + 1])}`,
  );
}

/** The base fixture, for `reports.service.spec.ts`'s byte claims over the same preview. */
export { preview as energyPreviewFixture };
