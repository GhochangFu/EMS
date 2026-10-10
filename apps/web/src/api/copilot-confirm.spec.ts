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
