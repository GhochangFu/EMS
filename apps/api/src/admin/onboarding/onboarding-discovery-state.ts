import { discoveryDtoOf, onboardingDiscoveryStoredSchema } from "@bms/shared";
import type { OnboardingDiscoveryResultDto } from "@bms/shared";

/** The draft key the discovery worker writes (ADR 0103). Server state; never sent to the client. */
export const DISCOVERY_KEY = "_discovery";

/**
 * `draft._discovery` as the DTO the session carries, or `null`.
 *
 * Fails closed: a blob that does not parse as the stored shape reads as no
 * discovery, never as a half-trusted one. The stored shape (with `queuedAt`
 * and the counters) is parsed, then mapped, so the strict DTO never sees a
 * stored-only key (accuracy review #4).
 */
export function readDiscovery(draft: unknown): OnboardingDiscoveryResultDto | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const parsed = onboardingDiscoveryStoredSchema.safeParse(
    (draft as Record<string, unknown>)[DISCOVERY_KEY],
  );
  return parsed.success ? discoveryDtoOf(parsed.data) : null;
}
