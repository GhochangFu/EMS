import { expect, vi } from "vitest";

import { ApiError } from "../../lib/api-error";
import { deleteAdminDashboardTemplateDraft } from "./dashboard-templates";

/**
 * `DELETE /admin/dashboard-templates/:id` answers 204 with no body
 * (`dashboard-templates.controller.ts`, `@HttpCode(HttpStatus.NO_CONTENT)`).
 * The client used to run it through `adminFetch`, which reads `res.json()`:
 * the delete succeeded on the server, and the page showed "Unexpected end of
 * JSON input" and stayed on the deleted draft's page. The URL and init `fetch`
 * receives are the observable surface (`point-key-states.spec.ts`'s shape).
 * `dashboard-templates.delete.test.ts` is the Vitest entry.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ID = "11111111-1111-4111-8111-111111111111";

function stubFetch(status: number, body: string | null): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(body, { status });
  });
  return () => seen;
}

/** An empty 204 resolves, and the call is a DELETE of `/:id`. */
export async function anEmpty204Resolves(): Promise<void> {
  const seen = stubFetch(204, null);
  await expect(deleteAdminDashboardTemplateDraft(ID)).resolves.toBeUndefined();
  expect(seen().url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${ID}`);
  expect(seen().init.method).toBe("DELETE");
}

/** A refusal (a published version) is an `ApiError` with its status and the server's body. */
export async function a409IsAnApiErrorWithItsStatus(): Promise<void> {
  const envelope = '{"statusCode":409,"message":"Only a draft can be deleted","error":"Conflict"}';
  stubFetch(409, envelope);
  const error = await deleteAdminDashboardTemplateDraft(ID).then(
    () => {
      throw new Error("expected the call to reject, and it resolved");
    },
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).message).toContain("Only a draft can be deleted");
}
