import { expect } from "vitest";

import { mergePendingChanges } from "./copilot-dock-parts";

const card = (id: string, catalogId: string) => ({ id, catalogId });

/** F4.339 (plan R4, code review): a returned discovery card drops the cached commit card it withdrew. */
export function aDiscoveryCardDropsTheCachedCommitCard(): void {
  const merged = mergePendingChanges([card("c1", "onboarding.commit"), card("p1", "dashboard.update")], [card("d1", "onboarding.discovery")]);
  expect(merged.map((c) => c.id)).toEqual(["p1", "d1"]);
}

/** F4.339 PR 9 (ADR 0099 Amendment 18): a returned credential-copy card is server-made, so it drops the cached discovery card. */
export function aCopyCardDropsTheCachedDiscoveryCard(): void {
  const merged = mergePendingChanges([card("d1", "onboarding.discovery")], [card("k1", "onboarding.credentials.copy")]);
  expect(merged.map((c) => c.id)).toEqual(["k1"]);
}

/** A turn that returns no server-made card leaves the cached ones; a returned card replaces its own copy. */
export function aTurnWithoutAServerCardKeepsTheCachedOnes(): void {
  expect(mergePendingChanges([card("c1", "onboarding.commit")], []).map((c) => c.id)).toEqual(["c1"]);
  expect(mergePendingChanges([card("p1", "dashboard.update")], [card("p1", "dashboard.update")]).map((c) => c.id)).toEqual(["p1"]);
}
