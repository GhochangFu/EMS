import { canonicalJson } from "@bms/shared/copilot";

/**
 * `F3.85` PR 4 / ADR 0099 drafter choice 5 — the browser side of the copilot
 * body hash: SHA-256 (hex) of the canonical JSON of `body`, the form the API
 * compares against the stored change. The executor sends `JSON.stringify` of
 * the **same object** it hashes.
 */
export async function bodyHashHex(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
