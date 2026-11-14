import { expect, vi } from "vitest";

import { fetchRuleList, fetchRules } from "./rules";

/**
 * `F4.361` U8 (ADR 0132 decision 3) — what the Rule Engine's list client puts on the wire. The
 * panel spec replaces `fetchRuleList` with a spy, so the URL handed to `fetch` is only observable here.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function capture(): () => string {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  return () => url;
}

/** No filter is no query string at all. */
export async function anEmptyFilterSendsNoQueryString(): Promise<void> {
  const seen = capture();
  await fetchRuleList({});
  expect(seen()).toBe(`${BASE}/api/v1/rules`);
}

/** Each of the four keys is sent under the API's own parameter name, and only the set ones. */
export async function eachKeyIsSent(): Promise<void> {
  for (const key of ["organizationId", "locationId", "assetGroupId", "assetId"] as const) {
    const seen = capture();
    await fetchRuleList({ [key]: "abc" });
    expect(seen()).toBe(`${BASE}/api/v1/rules?${key}=abc`);
  }
  const seen = capture();
  await fetchRuleList({ organizationId: "o", assetId: "a" });
  expect(new URL(seen()).searchParams.toString()).toBe("organizationId=o&assetId=a");
}

/** `fetchRules` stays unfiltered and parameterless: nine call sites hand it to React Query bare. */
export async function fetchRulesTakesNoParametersAndSendsNothing(): Promise<void> {
  expect(fetchRules.length).toBe(0);
  const seen = capture();
  await fetchRules();
  expect(seen()).toBe(`${BASE}/api/v1/rules`);
}
