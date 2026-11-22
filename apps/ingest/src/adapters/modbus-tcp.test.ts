import { describe, it } from "vitest";

import { runAdapterContractTests } from "../adapter/adapter-contract.spec.js";
import { modbusTcpAdapterFactory } from "./modbus-tcp.js";
import {
  assertALostSocketRejectsAndReadsDisconnected,
  assertARecoveredBlockLogsOnce,
  assertATimeoutFailsOnlyItsUnit,
  assertAnExceptionFailsOnlyItsBlock,
  assertAnOutOfRangeValueIsNotGood,
  assertBitsAreRead,
  assertOnlyMappedKeysAreRead,
  assertTheEndpointKeyIsHostAndPort,
  assertTheFactoryShape,
  assertValuesAreScaledAndCarryTheDeviceKeyAndNoTime,
  modbusContractFixtures,
} from "./modbus-tcp.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("modbus_tcp adapter (F1.2)", () => {
  it("satisfies the shared adapter contract", async () => {
    await runAdapterContractTests(modbusTcpAdapterFactory, modbusContractFixtures);
  });

  it("A1 the factory shape", async () => {
    await assertTheFactoryShape();
  });

  it("A2 the endpoint key is host and port", async () => {
    await assertTheEndpointKeyIsHostAndPort();
  });

  it("A3 values are scaled and carry the device key and no time", async () => {
    await assertValuesAreScaledAndCarryTheDeviceKeyAndNoTime();
  });

  it("A4 an exception fails only its block", async () => {
    await assertAnExceptionFailsOnlyItsBlock();
  });

  it("A5 a timeout fails only its unit", async () => {
    await assertATimeoutFailsOnlyItsUnit();
  });

  it("A6 an out of range value is not good", async () => {
    await assertAnOutOfRangeValueIsNotGood();
  });

  it("A7 only mapped keys are read", async () => {
    await assertOnlyMappedKeysAreRead();
  });

  it("A8 a lost socket rejects and reads disconnected", async () => {
    await assertALostSocketRejectsAndReadsDisconnected();
  });

  it("A9 bits are read", async () => {
    await assertBitsAreRead();
  });

  it("A10 a recovered block logs once", async () => {
    await assertARecoveredBlockLogsOnce();
  });
});
