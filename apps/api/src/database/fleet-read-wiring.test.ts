import { describe, it } from "vitest";

import {
  assertAlarmNotifyServiceFleetSlot,
  assertAlarmRaiserTenantSlot,
  assertConformedServiceSlots,
  assertRuleSweepServiceTenantSlot,
  assertUnconditionalFleetReadSlots,
  assertWorkerHostFleetSlot,
  assertWorkerHostTenantSlot,
} from "./fleet-read-wiring.spec";

/**
 * `E7.1b` — Vitest entry point for the pool-token/constructor-slot wiring guard.
 * Assertions live in the sibling `.spec` (ADR 0014).
 */
describe("E7.1b — services inject the right pool token in the right constructor slot", () => {
  it("unconditional cross-org readers inject the fleet pool in the read slot", () => {
    assertUnconditionalFleetReadSlots();
  });

  it("the four conformed decision-1 services inject both tokens in the right slots", () => {
    assertConformedServiceSlots();
  });

  it("F4.24 WorkerHostService injects the tenant pool in slot 1", () => {
    assertWorkerHostTenantSlot();
  });

  it("F4.24 WorkerHostService injects the fleet pool in slot 2", () => {
    assertWorkerHostFleetSlot();
  });

  it("F3.11 RuleSweepService injects the tenant pool in slot 0", () => {
    assertRuleSweepServiceTenantSlot();
  });

  it("F3.11 AlarmRaiser injects the tenant pool in slot 0", () => {
    assertAlarmRaiserTenantSlot();
  });

  it("F3.11 AlarmNotifyService injects the fleet pool in slot 0", () => {
    assertAlarmNotifyServiceFleetSlot();
  });
});
