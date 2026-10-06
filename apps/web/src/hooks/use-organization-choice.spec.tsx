import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { OrganizationsListResponse } from "@bms/shared";

import * as orgApi from "../api/admin/organizations";
import { useOrganizationChoice } from "./use-organization-choice";

/**
 * `F4.212` — the organization choice of the two mimic admin pages. While the read has no data the
 * list is one array reference, so the only-one effect runs once, not on every render.
 * `use-organization-choice.test.tsx` is the Vitest entry point. The read is a spy: an unstubbed
 * read would reach the API on :4000.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useOrganizationChoice(), { wrapper });
}

function organizations(...ids: string[]): OrganizationsListResponse {
  return { items: ids.map((id) => ({ id, code: id.slice(0, 3), name: `Org ${id.slice(0, 3)}`, active: true })) } as OrganizationsListResponse;
}

/** The read never settles, so every render is in the no-data state; the list must be the same
 * array each time. The adjacent positives prove the hook rendered in that state. Mutation:
 * `?? NO_ORGANIZATIONS` => `?? []` reddens this. */
export async function theListKeepsOneReferenceWhileTheReadHasNoData(): Promise<void> {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockReturnValue(new Promise(() => {}));
  const { result, rerender } = mount();
  const first = result.current.organizations;
  rerender();
  expect(result.current.organizations).toBe(first);
  expect(first).toEqual([]);
  expect(result.current.organizationId).toBe("");
}

/** One organization is the only choice and is chosen at once. */
export async function theOnlyOrganizationIsChosen(): Promise<void> {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(organizations(ORG_ID));
  const { result } = mount();
  await waitFor(() => expect(result.current.organizationId).toBe(ORG_ID));
}

/** Two organizations leave the choice to the user. */
export async function twoOrganizationsLeaveTheChoiceOpen(): Promise<void> {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(organizations(ORG_ID, OTHER_ID));
  const { result } = mount();
  await waitFor(() => expect(result.current.organizations).toHaveLength(2));
  expect(result.current.organizationId).toBe("");
}
