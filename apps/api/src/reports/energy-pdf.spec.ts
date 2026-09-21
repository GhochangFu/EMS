import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import { energyPdfDefinition, renderPdf, STANDARD_FONTS } from "./energy-pdf";
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
