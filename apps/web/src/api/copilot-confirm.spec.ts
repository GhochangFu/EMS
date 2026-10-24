import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { bodyHashHex } from "../lib/copilot-body-hash";
import { useAuthStore } from "../stores/auth-store";
import { confirmCopilotChange } from "./copilot-confirm";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — the web executor puts the stored
 * method, path and body on the wire with the `X-Copilot-Change` header. The
 * request handed to `fetch` is the only place this is observable, so each
 * case reads it. `node` environment, as `asset-health.spec.ts`.
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const VECTOR_SHA256 = "cd46abb94645a78c7ce4802b707895cda25a3e69932ec5040b0fcb7abc663b64";

const CHANGE: CopilotPendingChangeDto = {
  id: "33333333-3333-4333-8333-333333333333",
  catalogId: "dashboards.create",
  method: "POST",
  path: "/api/v1/dashboards",
  body: { b: [{ z: 1, a: null }], a: "x" },
  summary: "Create the dashboard Ops",
  risk: "create",
  proposedAt: "2026-10-10T00:00:00.000Z",
  expiresAt: "2026-10-10T01:00:00.000Z",
  ifMatch: null,
};

type Seen = { url: string; init: RequestInit };

function capture(response: () => Response): () => Seen {
  let seen: Seen | null = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return response();
  });
  return () => {
    if (seen === null) throw new Error("fetch was not called");
    return seen;
  };
}

export async function itSendsTheStoredRequestWithTheHeader(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture(() => new Response(JSON.stringify({ id: "dash-1" }), { status: 201 }));
  expect(await confirmCopilotChange(CHANGE)).toEqual({ id: "dash-1" });
  const { url, init } = seen();
  expect(url).toBe(`${BASE}/api/v1/dashboards`);
  expect(init.method).toBe("POST");
  const headers = new Headers(init.headers);
  expect(headers.get("X-Copilot-Change")).toBe(CHANGE.id);
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("Authorization")).toBe("Bearer token-1");
  expect(init.body).toBe(JSON.stringify(CHANGE.body));
  // What is sent hashes to the literal the API compares against.
  expect(await bodyHashHex(JSON.parse(init.body as string))).toBe(VECTOR_SHA256);
}

/** A bodyless entry sends `"{}"`, never an empty request. */
export async function aBodylessChangeSendsBraces(): Promise<void> {
  const seen = capture(() => new Response(null, { status: 204 }));
  expect(await confirmCopilotChange({ ...CHANGE, method: "PUT", path: "/api/v1/dashboards/d1/publish", body: {} })).toBeNull();
  expect(seen().init.body).toBe("{}");
  expect(seen().init.method).toBe("PUT");
}

/** A path that is not an `/api/v1/` path never reaches `fetch`, so the token cannot leave the API origin. */
export async function aNonApiPathIsRefusedBeforeFetch(): Promise<void> {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  for (const path of [".attacker.example/x", "@attacker.example/x", "//attacker.example/x", "/api/v1//attacker.example", "/api/v1/\\x", "/api/v1/@attacker.example"]) {
    let caught: unknown;
    try {
      await confirmCopilotChange({ ...CHANGE, path });
    } catch (err) {
      caught = err;
    }
    expect(caught, path).toBeInstanceOf(ApiError);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
}

/** A refusal is an `ApiError` with the server's status and text. */
export async function aRefusalIsAnApiError(): Promise<void> {
  capture(() => new Response('{"message":"This copilot change cannot be applied","statusCode":409}', { status: 409 }));
  let caught: unknown;
  try {
    await confirmCopilotChange(CHANGE);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).status).toBe(409);
  expect((caught as ApiError).message).toContain("This copilot change cannot be applied");
}

/**
 * `F3.86` PR 2 / ADR 0099 decision 3 — a `clientOnly` value typed on the card
 * is in the sent body and nowhere else: the stored change is unchanged, and
 * what is sent hashes, without that key, to the stored body's hash. Mutation:
 * send `change.body` alone → the "contains" assertion reddens.
 */
export async function aClientOnlyValueIsSentBesideTheStoredBody(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "user-1" }), { status: 201 }));
  const before = JSON.parse(JSON.stringify(CHANGE.body)) as unknown;
  await confirmCopilotChange(CHANGE, { temporaryPassword: "typed-on-the-card-7" });
  const sent = JSON.parse(seen().init.body as string) as Record<string, unknown>;
  expect(sent.temporaryPassword).toBe("typed-on-the-card-7");
  expect(new Headers(seen().init.headers).get("X-Copilot-Change")).toBe(CHANGE.id);
  // The stored change is not touched (the positive beside the absence).
  expect(CHANGE.body).toEqual(before);
  expect(JSON.stringify(CHANGE)).not.toContain("typed-on-the-card-7");
  const { temporaryPassword: _typed, ...rest } = sent;
  expect(await bodyHashHex(rest)).toBe(VECTOR_SHA256);
}

/**
 * `F3.87` PR 5 (D15, owner ruling Q5) — a layout replace's stored `baseline` is for the card
 * alone: the sent body is the stored body without it, every other key kept, and it hashes to the
 * hash of that body. Mutation: send `change.body` whole → the absence assertion reddens.
 */
export async function aReplaceIsSentWithoutItsBaseline(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "layout-1" }), { status: 200 }));
  const write = { version: 2, name: "Raw water", slug: "raw-water", canvasW: 120, canvasH: 80, nodes: [], pipes: [], symbolLibraries: ["core"] };
  const change: CopilotPendingChangeDto = {
    ...CHANGE,
    catalogId: "mimicLayout.replace",
    method: "PUT",
    path: "/api/v1/mimic-layouts/55555555-5555-4555-8555-555555555555",
    body: { ...write, baseline: { version: 2, nodes: [], pipes: [] } },
    risk: "edit",
  };
  await confirmCopilotChange(change);
  const sent = JSON.parse(seen().init.body as string) as Record<string, unknown>;
  expect(Object.keys(sent)).not.toContain("baseline");
  expect(sent).toEqual(write);
  expect(await bodyHashHex(sent)).toBe(await bodyHashHex(write));
  // The stored change keeps its baseline (the card reads it); the strip is a copy.
  expect(change.body.baseline).toEqual({ version: 2, nodes: [], pipes: [] });
}

/** An entry with no `cardOnly` key sends its stored body unchanged (the strip names nothing for it). */
export async function aChangeWithNoCardOnlyKeySendsItsBodyWhole(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "layout-2" }), { status: 201 }));
  const change: CopilotPendingChangeDto = { ...CHANGE, catalogId: "mimicLayout.create", body: { baseline: "kept", a: "x" } };
  await confirmCopilotChange(change);
  expect(JSON.parse(seen().init.body as string)).toEqual({ baseline: "kept", a: "x" });
}

/** `F3.87` PR 6b: a symbol upload card as the turn stored it — the text fields, the file's name and hash, the SVG text. */
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
export const UPLOAD_CHANGE: CopilotPendingChangeDto = {
  ...CHANGE,
  catalogId: "mimicSymbol.upload",
  path: "/api/v1/mimic-symbol-libraries/66666666-6666-4666-8666-666666666666/symbols",
  body: { name: "pump-x", label: "Pump X", filename: "pump-x.svg", fileSha256: "a".repeat(64), svgText: SVG_TEXT },
  summary: 'Upload the symbol "Pump X" (pump-x) to the library "Plant".',
};

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan §8.4) — an upload entry's Confirm is the real
 * multipart call: a `FormData` with the stored text fields and the SVG text as the `file` part
 * under the stored filename, the header, and no explicit `Content-Type` (the browser writes the
 * boundary).
 */
export async function anUploadIsSentAsFormData(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture(() => new Response(JSON.stringify({ id: "sym-1" }), { status: 201 }));
  expect(await confirmCopilotChange(UPLOAD_CHANGE)).toEqual({ id: "sym-1" });
  const { url, init } = seen();
  expect(url).toBe(`${BASE}${UPLOAD_CHANGE.path}`);
  expect(init.method).toBe("POST");
  const headers = new Headers(init.headers);
  expect(headers.get("X-Copilot-Change")).toBe(UPLOAD_CHANGE.id);
  expect(headers.get("Authorization")).toBe("Bearer token-1");
  expect(headers.get("Content-Type")).toBeNull();
  expect(init.body).toBeInstanceOf(FormData);
  const form = init.body as FormData;
  expect([...form.keys()].sort()).toEqual(["file", "label", "name"]);
  expect(form.get("name")).toBe("pump-x");
  expect(form.get("label")).toBe("Pump X");
  const file = form.get("file") as File;
  expect(file.name).toBe("pump-x.svg");
  expect(file.type).toBe("image/svg+xml");
  expect(await file.text()).toBe(SVG_TEXT);
}

/** The SVG text, the filename and the hash are never form fields; `group` is sent only when the card holds it. */
export async function anUploadSendsNoCardOnlyOrHashField(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "sym-1" }), { status: 201 }));
  await confirmCopilotChange({ ...UPLOAD_CHANGE, body: { ...UPLOAD_CHANGE.body, group: "water" } });
  const form = seen().init.body as FormData;
  expect(form.has("svgText")).toBe(false);
  expect(form.has("fileSha256")).toBe(false);
  expect(form.has("filename")).toBe(false);
  expect(form.get("group")).toBe("water");
}

/** `F4.247` (ADR 0099 Amendment 5 C2): a precondition is sent quoted, beside the change header. Mutation: send it unquoted. */
export async function aPreconditionIsSentAsAQuotedIfMatch(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "dash-1" }), { status: 200 }));
  await confirmCopilotChange({ ...CHANGE, ifMatch: "2026-10-20T10:00:00.000Z" });
  const headers = new Headers(seen().init.headers);
  expect(headers.get("If-Match")).toBe('"2026-10-20T10:00:00.000Z"');
  expect(headers.get("X-Copilot-Change")).toBe(CHANGE.id);
}

/** No precondition, no header — and the change header still goes (adjacent positive). Mutation: send `"null"`. */
export async function noPreconditionSendsNoIfMatch(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "dash-1" }), { status: 201 }));
  await confirmCopilotChange(CHANGE);
  const headers = new Headers(seen().init.headers);
  expect(headers.get("If-Match")).toBeNull();
  expect(headers.get("X-Copilot-Change")).toBe(CHANGE.id);
}

/** Critique C11: an older API sends no `ifMatch` at all. Mutation: test `!== null` — `"undefined"` is sent. */
export async function aMissingIfMatchFromAnOlderApiSendsNoHeader(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "dash-1" }), { status: 201 }));
  const { ifMatch: _ifMatch, ...older } = CHANGE;
  await confirmCopilotChange(older as CopilotPendingChangeDto);
  expect(new Headers(seen().init.headers).get("If-Match")).toBeNull();
}

/** The multipart branch carries it too. Mutation: add it to the JSON branch only. */
export async function anUploadSendsItsIfMatch(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "sym-1" }), { status: 201 }));
  await confirmCopilotChange({ ...UPLOAD_CHANGE, ifMatch: "2026-10-20T10:00:00.000Z" });
  expect(new Headers(seen().init.headers).get("If-Match")).toBe('"2026-10-20T10:00:00.000Z"');
}

/** `F4.279` (Q12): a webhook channel create, its recipients stored for the card alone. */
const WEBHOOK_CREATE: CopilotPendingChangeDto = {
  ...CHANGE,
  catalogId: "notificationChannel.create",
  path: "/api/v1/notifications/channels",
  body: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    code: "hook",
    name: "Hook",
    kind: "webhook",
    config: { to: ["a@example.test"] },
    recipients: [{ channelId: null, name: "Hook", kind: "webhook", targets: ["(typed on Confirm)"] }],
  },
};

/** `F4.279` (Q12): the typed URL is sent nested in `config`, beside the keys `config` already holds. */
export async function aTypedUrlIsSentAtItsNestedPath(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "c-1" }), { status: 201 }));
  await confirmCopilotChange(WEBHOOK_CREATE, { secret: "", "config.url": "https://hooks.example.test/x" });
  const sent = JSON.parse(seen().init.body as string) as Record<string, unknown>;
  expect(sent.config).toEqual({ to: ["a@example.test"], url: "https://hooks.example.test/x" });
}

/** `F4.279` (Q10): a blank optional secret is not sent, so the route keeps (or stores no) secret. */
export async function aBlankSecretIsNotSent(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ id: "c-1" }), { status: 201 }));
  await confirmCopilotChange(WEBHOOK_CREATE, { secret: "", "config.url": "https://hooks.example.test/x" });
  const sent = JSON.parse(seen().init.body as string) as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["code", "config", "kind", "name", "organizationId"]);
}

/** `F4.283` (ADR 0099 Amendment 8 Q19): a telemetry import card; the browser kept the file. */
export const IMPORT_CHANGE: CopilotPendingChangeDto = {
  ...CHANGE,
  catalogId: "telemetry.import",
  path: "/api/v1/admin/telemetry/import/commit",
  body: {
    sourceKind: "manual",
    conflictPolicy: "reject",
    filename: "readings.csv",
    fileSha256: "b".repeat(64),
    preview: { totalRows: 2, acceptedCount: 2, rejectedCount: 0, rejected: [], mappingsToCreate: [] },
  },
  summary: 'Import the readings in "readings.csv" into Org X (conflicting readings are rejected).',
};

/** The kept `File` goes as the `file` part under the stored name, beside the import's own fields. */
export async function aFileUploadSendsTheKeptFileAndItsFields(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ written: 2 }), { status: 200 }));
  const kept = new File(["asset_code,point_key,value,time\n"], "renamed-on-disk.csv", { type: "text/csv" });
  await confirmCopilotChange(IMPORT_CHANGE, {}, kept);
  const form = seen().init.body as FormData;
  const file = form.get("file") as File;
  expect({ keys: [...form.keys()].sort(), name: file.name, text: await file.text() }).toEqual({
    keys: ["conflictPolicy", "file", "sourceKind"],
    name: "readings.csv",
    text: "asset_code,point_key,value,time\n",
  });
}

/** The card-only preview and the stored hash are never form fields. */
export async function aFileUploadSendsNoPreviewOrHash(): Promise<void> {
  const seen = capture(() => new Response(JSON.stringify({ written: 2 }), { status: 200 }));
  await confirmCopilotChange(IMPORT_CHANGE, {}, new File(["x"], "readings.csv"));
  const form = seen().init.body as FormData;
  expect([form.has("preview"), form.has("fileSha256"), form.has("filename")]).toEqual([false, false, false]);
}

/** Without the kept file there is nothing to send: refused before `fetch`. */
export async function aFileUploadWithoutTheFileIsRefusedBeforeFetch(): Promise<void> {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  await expect(confirmCopilotChange(IMPORT_CHANGE)).rejects.toBeInstanceOf(ApiError);
  expect(fetchSpy).not.toHaveBeenCalled();
}
