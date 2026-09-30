import {
  mimicLayoutDeletedResponseSchema,
  mimicLayoutDtoSchema,
  mimicLayoutsListResponseSchema,
} from "@bms/shared/contracts";
import type { Contract, ContractSchema } from "@bms/shared/contracts";
import type {
  MimicLayoutDeletedResponse,
  MimicLayoutDto,
  MimicLayoutNodeKind,
  MimicLayoutsListResponse,
  MimicPanelTone,
  MimicSymbol,
  MimicSymbolLibrarySelection,
} from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.32c` / ADR 0081 — the mimic layout library, `/api/v1/mimic-layouts`.
 *
 * The fetch shape is `api/dashboard-mimic.ts`'s: the 401 reaches `clearSessionOnAuthFailure`
 * before the body is read, and the thrown `ApiError` keeps the status `lib/query-retry.ts` reads
 * (`F4.63`) — the 409s (stale version, slug taken, layout in use) are read from it. Not
 * `adminFetch`: any authenticated role reads the library (owner ruling OQ4).
 */

/** One node in a write body — by `key`, never by id (plan D5). The API's `.strict()` body. */
export type MimicLayoutWriteNode = {
  key: string;
  kind: MimicLayoutNodeKind;
  symbol?: MimicSymbol;
  label: string;
  roleCode?: string;
  tone?: MimicPanelTone;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
};

/** One pipe in a write body: two unit keys (plan D7). */
export type MimicLayoutWritePipe = {
  fromKey: string;
  toKey: string;
};

/** What `PUT /mimic-layouts/:id` takes: the whole layout, replaced in one transaction. */
export type MimicLayoutWriteBody = {
  name: string;
  slug: string;
  canvasW: number;
  canvasH: number;
  nodes: MimicLayoutWriteNode[];
  pipes: MimicLayoutWritePipe[];
  /** The libraries the layout chooses (ADR 0084 decision 8); the API reads an absent list as `["core"]`. */
  symbolLibraries: MimicSymbolLibrarySelection[];
};

/** What `POST /mimic-layouts` takes: the write body plus the owning organization (OQ3). */
export type CreateMimicLayoutBody = MimicLayoutWriteBody & { organizationId: string };

/** What `PUT /mimic-layouts/:id` takes: the write body plus the version it was loaded at. */
export type ReplaceMimicLayoutBody = MimicLayoutWriteBody & { version: number };

async function mimicLayoutsFetch<S extends ContractSchema>(
  path: string,
  schema: S,
  endpoint: string,
  init?: RequestInit,
): Promise<Contract<S>> {
  const res = await fetch(`${base}/api/v1/mimic-layouts${path}`, withAuth(init));
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `${endpoint} ${res.status}`, res.status);
  }
  return checkResponse(schema, await res.json(), endpoint);
}

function jsonInit(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function idPath(id: string): string {
  return `/${encodeURIComponent(id)}`;
}

export function fetchMimicLayouts(): Promise<MimicLayoutsListResponse> {
  return mimicLayoutsFetch("", mimicLayoutsListResponseSchema, "mimic-layouts");
}

export function fetchMimicLayout(id: string): Promise<MimicLayoutDto> {
  return mimicLayoutsFetch(idPath(id), mimicLayoutDtoSchema, "mimic-layouts/:id");
}

export function createMimicLayout(body: CreateMimicLayoutBody): Promise<MimicLayoutDto> {
  return mimicLayoutsFetch("", mimicLayoutDtoSchema, "mimic-layouts", jsonInit("POST", body));
}

export function replaceMimicLayout(id: string, body: ReplaceMimicLayoutBody): Promise<MimicLayoutDto> {
  return mimicLayoutsFetch(idPath(id), mimicLayoutDtoSchema, "mimic-layouts/:id", jsonInit("PUT", body));
}

export function deleteMimicLayout(id: string): Promise<MimicLayoutDeletedResponse> {
  return mimicLayoutsFetch(idPath(id), mimicLayoutDeletedResponseSchema, "mimic-layouts/:id", {
    method: "DELETE",
  });
}
