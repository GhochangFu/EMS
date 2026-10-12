import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { proposeHarness } from "./copilot-propose-tools.spec";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F3.86` PR 6 review — the resolver's `onboardingSession` target. Only a
 * server-made change has it (the onboarding commit, ADR 0099 decision 7), so
 * the resolver refuses it before any read: every seam it holds throws when
 * touched, and records the touch. No propose tool reaches it either. Vitest
 * entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const JWT = { sub: "f386-resolver-unit", role: "admin" } as JwtPayload;

/** A seam that records each property read and throws, so a refusal that reads anything fails loudly. */
function untouchable(name: string, touched: string[]): never {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        touched.push(`${name}.${String(key)}`);
        throw new Error(`F3.86: the resolver touched ${name}.${String(key)}`);
      },
    },
  ) as never;
}

/** The onboarding commit is refused with no database read and no access check. */
export async function anOnboardingSessionTargetIsRefusedBeforeAnyRead(): Promise<void> {
  const entry = catalogEntry("onboarding.commit");
  expect(entry?.target.kind).toBe("onboardingSession");
  const touched: string[] = [];
  const resolver = new CopilotTargetResolver(
    untouchable("tenantDb", touched),
    untouchable("access", touched),
    untouchable("users", touched),
    untouchable("grants", touched),
  );
  const resolved = await resolver.resolve(entry!, { id: SESSION }, { draftHash: "c".repeat(64) }, [ORG], JWT, ORG);
  expect(resolved).toBeNull();
  expect(touched).toEqual([]);
}

/** No propose tool reaches the entry: the model's call is an unknown tool, nothing is resolved or stored. */
export async function noProposeToolProposesTheOnboardingCommit(): Promise<void> {
  const entry = catalogEntry("onboarding.commit")!;
  const h = proposeHarness();
  const result = await h.tools.dispatch(proposeToolName(entry), { id: SESSION, body: { draftHash: "c".repeat(64) } }, h.ctx());
  expect(result.ok).toBe(false);
  expect(h.resolved).toEqual([]);
  expect(h.stored).toEqual([]);
}
