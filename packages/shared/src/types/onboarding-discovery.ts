/**
 * `F3.24b` onboarding discovery (ADR 0103) — the types, each `z.infer`red from
 * its schema in `../contracts/onboarding-discovery` (ADR 0030 decision 2).
 */
import type { z } from "zod";

import type * as C from "../contracts/onboarding-discovery";

export type StartOnboardingDiscoveryBody = z.infer<typeof C.startOnboardingDiscoveryBodySchema>;
export type StartOnboardingDiscoveryResponseDto = z.infer<
  typeof C.startOnboardingDiscoveryResponseDtoSchema
>;
export type OnboardingDiscoveryResultDto = z.infer<typeof C.onboardingDiscoveryResultDtoSchema>;
export type OnboardingDiscoveryStored = z.infer<typeof C.onboardingDiscoveryStoredSchema>;
export type OnboardingDiscoveryDevice = z.infer<typeof C.onboardingDiscoveryDeviceSchema>;
export type OnboardingDiscoveryKey = z.infer<typeof C.onboardingDiscoveryKeySchema>;
export type OnboardingDiscoveryStatus = z.infer<typeof C.onboardingDiscoveryStatusSchema>;
export type OnboardingDiscoveryErrorClass = z.infer<typeof C.onboardingDiscoveryErrorClassSchema>;
