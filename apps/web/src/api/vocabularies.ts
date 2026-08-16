import { vocabulariesResponseSchema } from "@bms/shared/contracts";
import type { VocabulariesResponse } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * The shared TanStack Query key for both vocabularies (ADR 0031 Amendment 1).
 *
 * Exported so every consumer uses the same one: the rules page, the rule
 * builder and the asset admin form all read this, and three different keys
 * would mean three fetches of a nine-row payload and three chances to render a
 * different vocabulary on the same screen.
 */
export const vocabulariesQueryKey = ["vocabularies"] as const;

/** GET /api/v1/vocabularies */
export async function fetchVocabularies(): Promise<VocabulariesResponse> {
  const res = await fetch(`${base}/api/v1/vocabularies`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`vocabularies ${res.status}`);
  }
  return checkResponse(vocabulariesResponseSchema, await res.json(), "vocabularies");
}
