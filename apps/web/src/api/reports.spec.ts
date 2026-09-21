import { expect, vi } from "vitest";

import { reportFileDtoSchema } from "@bms/shared/contracts";
import type { ReportFileDto } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import {
  deleteReportFile,
  downloadEnergyReportCsv,
  downloadEnergyReportPdf,
  downloadReportFile,
  fetchReportFiles,
  saveEnergyReportFile,
} from "./reports";

/**
 * `F3.5a` Unit 10 — the web client for the four report-file routes, plus the
 * `saveBlob` extraction's no-behaviour-change proof.
 *
 * ## Environment
 *
 * `node`, the `asset-images.spec.ts` shape. `saveBlob` touches `document` and
 * `URL`, neither a Node global, so every row below stubs both — `stubGlobal`,
 * not `spyOn`, because the properties are absent to start with.
 */

const INPUT = { startDate: "2026-09-01", endDate: "2026-09-07" };
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

const DTO: ReportFileDto = reportFileDtoSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: ORGANIZATION_ID,
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
  locationIds: [],
  contentType: "application/pdf",
  byteSize: 2048,
  sha256: "a".repeat(64),
  filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
  deliveryStatus: "none",
  deliveryError: null,
  scheduleId: null,
  createdBy: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-09-16T10:00:00.000Z",
});

/** Records the last anchor `saveBlob` built, so the download rows can name it. */
type AnchorStub = { href: string; download: string; click: () => void; remove: () => void };

function stubDom(): { lastAnchor: () => AnchorStub | undefined } {
  let lastAnchor: AnchorStub | undefined;
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor: AnchorStub = {
        href: "",
        download: "",
        click: vi.fn(),
        remove: vi.fn(),
      };
      lastAnchor = anchor;
      return anchor;
    },
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:x"),
    revokeObjectURL: vi.fn(),
  });
  return { lastAnchor: () => lastAnchor };
}

type SeenRequest = { url: string; init: RequestInit };

/**
 * Captures the `url` and the `init` of the single request the call under test
 * makes, and answers with one status and one body — the `asset-images.spec.ts`
 * shape. Step-5 false-green 2: the earlier capture dropped the URL, so a row
 * could only ever assert on `init`, and `toBeDefined()` on a default `{}`
 * gated nothing. `url` is `String(...)`-ed defensively: the client passes a
 * string today, but `fetch` accepts a `URL` or a `Request` too.
 */
function captureFetch(status: number, body: BodyInit | null): () => SeenRequest {
  let seen: SeenRequest = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    seen = { url: String(url), init: init ?? {} };
    return new Response(body, { status });
  });
  return () => seen;
}

/** The absence shape this repository keeps being caught by — see `onboarding.spec.ts`. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/**
 * `saveEnergyReportFile` posts exactly `{ startDate, endDate, format }` when
 * no organization is given.
 *
 * The body is read back and each field asserted **by key** — not by
 * structural equality on positional strings — because a swapped-argument bug
 * (`format`/`organizationId` both plain strings) would still produce an
 * object with the right two keys if the assertion only checked shape.
 */
export async function saveWithoutOrganizationPostsExactlyThreeFields(): Promise<void> {
  const seen = captureFetch(201, JSON.stringify(DTO));

  await saveEnergyReportFile(INPUT, "pdf");

  const { url, init } = seen();
  expect(url.endsWith("/reports/energy/files")).toBe(true);
  expect(init.method).toBe("POST");
  const body = JSON.parse(init.body as string) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["endDate", "format", "startDate"]);
  expect(body.startDate).toBe(INPUT.startDate);
  expect(body.endDate).toBe(INPUT.endDate);
  expect(body.format).toBe("pdf");
}

/**
 * `saveEnergyReportFile` adds `organizationId` when it is given — read back
 * by key, so the two same-typed positional strings (`format`,
 * `organizationId`) cannot be silently swapped without reddening this row.
 */
export async function saveWithOrganizationAddsItByKey(): Promise<void> {
  const seen = captureFetch(201, JSON.stringify(DTO));

  await saveEnergyReportFile(INPUT, "xlsx", ORGANIZATION_ID);

  const body = JSON.parse(seen().init.body as string) as Record<string, unknown>;
  expect(body.format).toBe("xlsx");
  expect(body.organizationId).toBe(ORGANIZATION_ID);
}

/**
 * `downloadEnergyReportPdf` hits `export.pdf` — the path suffix, not
 * `export.csv` — and names the `.pdf` anchor. The query string is checked
 * for the two dates so a route that dropped them would redden too.
 */
export async function downloadPdfHitsExportPdf(): Promise<void> {
  const seen = captureFetch(200, "pdf-bytes");
  const { lastAnchor } = stubDom();

  await downloadEnergyReportPdf(INPUT);

  const { url, init } = seen();
  const [path, query] = url.split("?");
  expect(path?.endsWith("/reports/energy/export.pdf")).toBe(true);
  expect(query).toContain(`startDate=${INPUT.startDate}`);
  expect(query).toContain(`endDate=${INPUT.endDate}`);
  expect(init.method ?? "GET").toBe("GET");
  expect(lastAnchor()?.download).toBe(
    `energy-consumption-${INPUT.startDate}-to-${INPUT.endDate}.pdf`,
  );
}

/**
 * The `saveBlob` extraction changed no behaviour: `downloadEnergyReportCsv`
 * still names the `.csv` anchor — the one gate that proves it.
 */
export async function downloadCsvStillNamesTheCsvAnchor(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  const { lastAnchor } = stubDom();

  await downloadEnergyReportCsv(INPUT);

  expect(seen().url.split("?")[0]?.endsWith("/reports/energy/export.csv")).toBe(true);
  expect(lastAnchor()?.download).toBe(
    `energy-consumption-${INPUT.startDate}-to-${INPUT.endDate}.csv`,
  );
}

/** `downloadReportFile` hits `/reports/files/<id>/download` and names the anchor `file.filename`. */
export async function downloadReportFileNamesTheAnchorAfterTheDto(): Promise<void> {
  const seen = captureFetch(200, "pdf-bytes");
  const { lastAnchor } = stubDom();

  await downloadReportFile(DTO);

  const { url, init } = seen();
  expect(url.endsWith(`/reports/files/${DTO.id}/download`)).toBe(true);
  expect(init.method ?? "GET").toBe("GET");
  expect(lastAnchor()?.download).toBe(DTO.filename);
}

/** `deleteReportFile` sends `DELETE /reports/files/<id>` and resolves on 204. */
export async function deleteResolvesOnA204(): Promise<void> {
  const seen = captureFetch(204, null);

  await expect(deleteReportFile(DTO.id)).resolves.toBeUndefined();

  const { url, init } = seen();
  expect(url.endsWith(`/reports/files/${DTO.id}`)).toBe(true);
  expect(init.method).toBe("DELETE");
}

/** `deleteReportFile` throws `ApiError` with `status === 403` on 403. */
export async function deleteThrowsApiErrorCarryingA403(): Promise<void> {
  captureFetch(403, JSON.stringify({ statusCode: 403, message: "Report file is outside your access scope" }));

  const err = await rejection(deleteReportFile(DTO.id));

  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(403);
}

/** `fetchReportFiles` reads through `adminFetch`'s contract check. */
export async function fetchReportFilesReturnsTheList(): Promise<void> {
  const seen = captureFetch(200, JSON.stringify([DTO]));

  const files = await fetchReportFiles();

  expect(seen().url.endsWith("/reports/files")).toBe(true);
  expect(files).toEqual([DTO]);
}
