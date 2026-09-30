import {
  mimicLibrarySettingDtoSchema,
  mimicOrgSymbolDtoSchema,
  mimicOrgSymbolLibraryDtoSchema,
  mimicSymbolLibrariesResponseSchema,
} from "@bms/shared/contracts";
import type { Contract, ContractSchema } from "@bms/shared/contracts";
import type {
  MimicLibrarySettingDto,
  MimicOrgSymbolDto,
  MimicOrgSymbolLibraryDto,
  MimicSymbolGroupCode,
  MimicSymbolLibrariesResponse,
  MimicSymbolLibraryCode,
  MimicSymbolStyle,
} from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.32f` slice 3 (ADR 0086 decisions 4, 6, 7) — `/api/v1/mimic-symbol-libraries`: the catalog
 * an author draws from (the global libraries with the organization's switch, and the
 * organization's own libraries with their symbols), and the writes an administrator makes.
 *
 * The fetch shape is `api/mimic-layouts.ts`': the 401 reaches `clearSessionOnAuthFailure` before
 * the body is read, the thrown `ApiError` keeps the status, and every answer passes its contract
 * through `checkResponse`. Not `adminFetch`: the editor reads the catalog too.
 *
 * **The upload sends no `Content-Type`.** The body is a `FormData`, and the browser writes the
 * `multipart/form-data` header with its boundary; a header set here would carry no boundary and
 * the API could not split the parts.
 */

export type CreateMimicOrgSymbolLibraryBody = {
  organizationId: string;
  code: string;
  label: string;
  style: MimicSymbolStyle;
  licence: string;
  attribution: string;
  sourceUrl?: string | null;
};

export type UpdateMimicOrgSymbolLibraryBody = {
  label?: string;
  licence?: string;
  attribution?: string;
  sourceUrl?: string | null;
  active?: boolean;
};

export type UploadMimicOrgSymbolInput = {
  file: File;
  name?: string;
  label?: string;
  group?: MimicSymbolGroupCode;
};

export type UpdateMimicOrgSymbolBody = {
  label?: string;
  group?: MimicSymbolGroupCode;
  active?: boolean;
};

export type PutMimicLibrarySettingBody = {
  organizationId: string;
  enabled: boolean;
};

async function librariesFetch<S extends ContractSchema>(
  path: string,
  schema: S,
  endpoint: string,
  init?: RequestInit,
): Promise<Contract<S>> {
  const res = await fetch(`${base}/api/v1/mimic-symbol-libraries${path}`, withAuth(init));
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `${endpoint} ${res.status}`, res.status);
  }
  return checkResponse(schema, await res.json(), endpoint);
}

function jsonInit(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function idPath(id: string): string {
  return `/${encodeURIComponent(id)}`;
}

/** `GET /mimic-symbol-libraries[?organizationId=]` — absent: every organization the caller reads. */
export function fetchMimicSymbolLibraries(organizationId?: string): Promise<MimicSymbolLibrariesResponse> {
  const query = organizationId === undefined ? "" : `?organizationId=${encodeURIComponent(organizationId)}`;
  return librariesFetch(query, mimicSymbolLibrariesResponseSchema, "mimic-symbol-libraries");
}

/** `POST /mimic-symbol-libraries` — a new organization library. */
export function createMimicOrgSymbolLibrary(body: CreateMimicOrgSymbolLibraryBody): Promise<MimicOrgSymbolLibraryDto> {
  return librariesFetch("", mimicOrgSymbolLibraryDtoSchema, "mimic-symbol-libraries", jsonInit("POST", body));
}

/** `PATCH /mimic-symbol-libraries/:id` — an organization library's editable fields, `active` included. */
export function updateMimicOrgSymbolLibrary(
  id: string,
  body: UpdateMimicOrgSymbolLibraryBody,
): Promise<MimicOrgSymbolLibraryDto> {
  return librariesFetch(idPath(id), mimicOrgSymbolLibraryDtoSchema, "mimic-symbol-libraries/:id", jsonInit("PATCH", body));
}

/** `POST /mimic-symbol-libraries/:id/symbols` — one SVG file, `file` first, then the optional fields. */
export function uploadMimicOrgSymbol(id: string, input: UploadMimicOrgSymbolInput): Promise<MimicOrgSymbolDto> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.name !== undefined && input.name !== "") form.append("name", input.name);
  if (input.label !== undefined && input.label !== "") form.append("label", input.label);
  if (input.group !== undefined) form.append("group", input.group);
  return librariesFetch(`${idPath(id)}/symbols`, mimicOrgSymbolDtoSchema, "mimic-symbol-libraries/:id/symbols", {
    method: "POST",
    body: form,
  });
}

/** `PATCH /mimic-symbol-libraries/:id/symbols/:symbolId` — one organization symbol's label, group or `active`. */
export function updateMimicOrgSymbol(
  id: string,
  symbolId: string,
  body: UpdateMimicOrgSymbolBody,
): Promise<MimicOrgSymbolDto> {
  return librariesFetch(
    `${idPath(id)}/symbols${idPath(symbolId)}`,
    mimicOrgSymbolDtoSchema,
    "mimic-symbol-libraries/:id/symbols/:symbolId",
    jsonInit("PATCH", body),
  );
}

/** `PUT /mimic-symbol-libraries/settings/:libraryCode` — the organization's switch for a global library. */
export function putMimicLibrarySetting(
  libraryCode: MimicSymbolLibraryCode,
  body: PutMimicLibrarySettingBody,
): Promise<MimicLibrarySettingDto> {
  return librariesFetch(
    `/settings/${encodeURIComponent(libraryCode)}`,
    mimicLibrarySettingDtoSchema,
    "mimic-symbol-libraries/settings/:libraryCode",
    jsonInit("PUT", body),
  );
}
