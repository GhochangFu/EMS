import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deviceProfileDtoSchema,
  deviceProfileListSchema,
  stockDeviceProfileListSchema,
} from "@bms/shared/contracts";
import type {
  CreateDeviceProfileBody,
  DeviceProfileDto,
  DeviceProfileList,
  SaveDeviceProfileVersionBody,
  StockDeviceProfileList,
} from "@bms/shared/contracts";

import { adminFetch } from "./client";

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T6.1) — the device profiles API,
 * `/admin/device-profiles`, and the TanStack Query hooks the profiles screen
 * reads it through (AGENTS.md §4.2).
 *
 * **There is no update and no delete.** Every save is a POST of a new version
 * (plan P2), so this module has no PATCH, PUT or DELETE and must not grow one:
 * the API has no such route and the table grants neither.
 */

const BASE = "/admin/device-profiles";
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** Every query this module owns starts here, so one invalidation refreshes them all. */
const ROOT_KEY = ["admin", "device-profiles"] as const;

/** The query key of one organization's profile list. */
export function deviceProfilesKey(organizationId: string) {
  return [...ROOT_KEY, "organization", organizationId] as const;
}

const STOCK_KEY = [...ROOT_KEY, "stock"] as const;

/** Every version of every profile of one organization, by code, newest version first. */
export async function fetchDeviceProfiles(organizationId: string): Promise<DeviceProfileList> {
  return adminFetch(`${BASE}?organizationId=${encodeURIComponent(organizationId)}`, deviceProfileListSchema);
}

/** The stock profiles the repository ships (decision 14). */
export async function fetchStockDeviceProfiles(): Promise<StockDeviceProfileList> {
  return adminFetch(`${BASE}/stock`, stockDeviceProfileListSchema);
}

/** A new profile at version 1. */
export async function createDeviceProfile(body: CreateDeviceProfileBody): Promise<DeviceProfileDto> {
  return adminFetch(BASE, deviceProfileDtoSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/**
 * The next version of `id`'s code. `body.baseVersion` is the version the
 * editor was opened on; the API answers 409 when a newer version exists.
 */
export async function saveDeviceProfileVersion(
  id: string,
  body: SaveDeviceProfileVersionBody,
): Promise<DeviceProfileDto> {
  return adminFetch(`${BASE}/${encodeURIComponent(id)}/versions`, deviceProfileDtoSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** `id`'s row under a new code, version 1, in the same organization. */
export async function copyDeviceProfile(id: string, code: string): Promise<DeviceProfileDto> {
  return adminFetch(`${BASE}/${encodeURIComponent(id)}/copy`, deviceProfileDtoSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ code }),
  });
}

/** A stock profile copied into the organization's own rows. */
export async function importStockDeviceProfile(code: string, organizationId: string): Promise<DeviceProfileDto> {
  return adminFetch(`${BASE}/stock/${encodeURIComponent(code)}/import`, deviceProfileDtoSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ organizationId }),
  });
}

/** One organization's profiles; idle until an organization is chosen (the list is 400 without one). */
export function useDeviceProfiles(organizationId: string) {
  return useQuery({
    queryKey: deviceProfilesKey(organizationId),
    queryFn: () => fetchDeviceProfiles(organizationId),
    enabled: organizationId !== "",
  });
}

/** The stock list, read only once the import panel is open. */
export function useStockDeviceProfiles(enabled: boolean) {
  return useQuery({ queryKey: STOCK_KEY, queryFn: fetchStockDeviceProfiles, enabled });
}

/** Every write refreshes the organization lists it may have changed. */
function useInvalidateProfiles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROOT_KEY });
}

/** Creates a profile at version 1, then refreshes the profile queries. */
export function useCreateDeviceProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({ mutationFn: createDeviceProfile, onSuccess: invalidate });
}

/** Saves the next version of a profile from `body.baseVersion`, then refreshes the profile queries. */
export function useSaveDeviceProfileVersion() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SaveDeviceProfileVersionBody }) =>
      saveDeviceProfileVersion(id, body),
    onSuccess: invalidate,
  });
}

/** Copies a profile under a new code at version 1, then refreshes the profile queries. */
export function useCopyDeviceProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) => copyDeviceProfile(id, code),
    onSuccess: invalidate,
  });
}

/** Imports a stock profile into an organization, then refreshes the profile queries. */
export function useImportStockDeviceProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ code, organizationId }: { code: string; organizationId: string }) =>
      importStockDeviceProfile(code, organizationId),
    onSuccess: invalidate,
  });
}
