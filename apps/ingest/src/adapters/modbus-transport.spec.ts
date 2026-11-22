import { decodeAdu, encodeReadRequest, serveModbusFrame, type ModbusImage } from "@bms/shared/ingest";
import { expect } from "vitest";

import {
  openModbusTransport,
  type ModbusDeadline,
  type ModbusSocket,
  type ModbusSocketFactory,
} from "./modbus-transport.js";

/**
 * `F1.2` plan T4.2 / ADR 0141 decisions 4, 5 — the read-only Modbus TCP
 * transport over an injected socket factory and an injected one-shot deadline.
 * No real socket and no real timer: every case drives both by hand.
 *
 * Assertions live here; `modbus-transport.test.ts` is the vitest entry point.
 */

type FakeSocket = ModbusSocket & {
  readonly written: Uint8Array[];
  destroyed: boolean;
  receive(bytes: Uint8Array): void;
  closeFromPeer(): void;
};

function fakeSocket(): FakeSocket {
  let onData: ((chunk: Uint8Array) => void) | undefined;
  let onClose: (() => void) | undefined;
  const socket: FakeSocket = {
    written: [],
    destroyed: false,
    write(data) {
      socket.written.push(data);
    },
    onData(listener) {
      onData = listener;
    },
    onClose(listener) {
      onClose = listener;
    },
    destroy() {
      if (!socket.destroyed) {
        socket.destroyed = true;
        onClose?.();
      }
    },
    receive(bytes) {
      onData?.(bytes);
    },
    closeFromPeer() {
      socket.destroy();
    },
  };
  return socket;
}

/** A deadline the test fires by hand. */
function manualDeadlines(): { deadline: ModbusDeadline; fire(): void; armed(): number } {
  const pending: { expire: () => void; live: boolean }[] = [];
  return {
    deadline: (_ms, expire) => {
      const entry = { expire, live: true };
      pending.push(entry);
      return () => {
        entry.live = false;
      };
    },
    fire() {
      const entry = pending.find((p) => p.live);
      if (entry !== undefined) {
        entry.live = false;
        entry.expire();
      }
    },
    armed: () => pending.filter((p) => p.live).length,
  };
}

const IMAGE: ModbusImage = { holding: new Map([[0, 11], [1, 22], [2, 33]]) };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function open(options: { interRequestDelayMs?: number } = {}) {
  const socket = fakeSocket();
  const deadlines = manualDeadlines();
  const delays: number[] = [];
  const controller = new AbortController();
  const factory: ModbusSocketFactory = async () => socket;
  const transport = await openModbusTransport({
    host: "10.0.0.5",
    port: 502,
    timeoutMs: 1_000,
    interRequestDelayMs: options.interRequestDelayMs ?? 0,
    signal: controller.signal,
    socketFactory: factory,
    deadline: deadlines.deadline,
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  return { socket, deadlines, delays, controller, transport };
}

/** Answers the last request the socket received from `image`, optionally rewriting it first. */
function answer(socket: FakeSocket, image: ModbusImage = IMAGE): Uint8Array {
  const request = socket.written[socket.written.length - 1] as Uint8Array;
  const reply = serveModbusFrame(request, image) as Uint8Array;
  socket.receive(reply);
  return reply;
}

export async function assertARequestIsAnsweredByItsReply(): Promise<void> {
  const { socket, transport } = await open();
  const reading = transport.request(7, { functionCode: 3, address: 0, quantity: 2 });
  await tick();
  expect(socket.written).toHaveLength(1);
  const sent = decodeAdu(socket.written[0] as Uint8Array);
  expect(sent.unitId).toBe(7);
  expect([...sent.pdu]).toEqual([0x03, 0x00, 0x00, 0x00, 0x02]);
  answer(socket);
  await expect(reading).resolves.toEqual({ kind: "registers", registers: [11, 22] });
}

export async function assertTransactionIdsAdvance(): Promise<void> {
  const { socket, transport } = await open();
  const first = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  answer(socket);
  await first;
  const second = transport.request(1, { functionCode: 3, address: 1, quantity: 1 });
  await tick();
  answer(socket);
  await second;
  const ids = socket.written.map((frame) => decodeAdu(frame).transactionId);
  expect(ids[1]).toBe(((ids[0] as number) + 1) & 0xffff);
}

export async function assertAReplyForAnOldIdIsDroppedAndTheNextStillResolves(): Promise<void> {
  const { socket, transport, deadlines } = await open();
  const first = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  const stale = socket.written[0] as Uint8Array;
  deadlines.fire();
  await expect(first).rejects.toMatchObject({ name: "ModbusTimeoutError" });
  const second = transport.request(1, { functionCode: 3, address: 2, quantity: 1 });
  await tick();
  // The late reply to the first request arrives first: dropped, never a value for the second.
  socket.receive(serveModbusFrame(stale, IMAGE) as Uint8Array);
  await tick();
  answer(socket);
  await expect(second).resolves.toEqual({ kind: "registers", registers: [33] });
}

export async function assertAReplyFromAnotherUnitIsDropped(): Promise<void> {
  const { socket, transport, deadlines } = await open();
  const reading = transport.request(5, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  const request = decodeAdu(socket.written[0] as Uint8Array);
  socket.receive(
    serveModbusFrame(
      encodeReadRequest({ transactionId: request.transactionId, unitId: 6, functionCode: 3, address: 0, quantity: 1 }),
      IMAGE,
    ) as Uint8Array,
  );
  await tick();
  deadlines.fire();
  await expect(reading).rejects.toMatchObject({ name: "ModbusTimeoutError" });
}

export async function assertADeadlineRejectsOneRequestAndLeavesTheSocketUsable(): Promise<void> {
  const { socket, transport, deadlines } = await open();
  const first = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  expect(deadlines.armed()).toBe(1);
  deadlines.fire();
  await expect(first).rejects.toMatchObject({ name: "ModbusTimeoutError" });
  expect(socket.destroyed).toBe(false);
  expect(transport.closed).toBe(false);
  const second = transport.request(1, { functionCode: 3, address: 1, quantity: 1 });
  await tick();
  answer(socket);
  await expect(second).resolves.toEqual({ kind: "registers", registers: [22] });
  expect(deadlines.armed()).toBe(0);
}

export async function assertASocketCloseRejectsThePendingAndEveryLaterRequest(): Promise<void> {
  const { socket, transport } = await open();
  const pending = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  socket.closeFromPeer();
  await expect(pending).rejects.toMatchObject({ name: "ModbusTransportClosedError" });
  expect(transport.closed).toBe(true);
  await expect(transport.request(1, { functionCode: 3, address: 0, quantity: 1 })).rejects.toMatchObject({
    name: "ModbusTransportClosedError",
  });
  expect(socket.written).toHaveLength(1);
}

export async function assertAbortDestroysTheSocket(): Promise<void> {
  const { socket, transport, controller } = await open();
  const pending = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  controller.abort();
  expect(socket.destroyed).toBe(true);
  await expect(pending).rejects.toMatchObject({ name: "ModbusTransportClosedError" });
}

export async function assertRequestsNeverOverlap(): Promise<void> {
  const { socket, transport } = await open({ interRequestDelayMs: 50 });
  const a = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  const b = transport.request(1, { functionCode: 3, address: 1, quantity: 1 });
  await tick();
  expect(socket.written).toHaveLength(1);
  answer(socket);
  await a;
  await tick();
  await tick();
  expect(socket.written).toHaveLength(2);
  answer(socket);
  await expect(b).resolves.toEqual({ kind: "registers", registers: [22] });
}

export async function assertTheInterRequestDelayIsWaitedBetweenRequests(): Promise<void> {
  const { socket, transport, delays } = await open({ interRequestDelayMs: 50 });
  const a = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  answer(socket);
  await a;
  const b = transport.request(1, { functionCode: 3, address: 1, quantity: 1 });
  await tick();
  await tick();
  answer(socket);
  await b;
  expect(delays).toEqual([50]);
}

export async function assertGarbagePastTheFrameBoundClosesTheSocket(): Promise<void> {
  const { socket, transport } = await open();
  const pending = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  // A header claiming 300 bytes: past the 254 the specification allows.
  socket.receive(Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x01, 0x2c, 0x01, 0x03]));
  await expect(pending).rejects.toMatchObject({ name: "ModbusTransportClosedError" });
  expect(socket.destroyed).toBe(true);
}

export async function assertAnExceptionReplyIsAValueNotAnError(): Promise<void> {
  const { socket, transport } = await open();
  const reading = transport.request(1, { functionCode: 3, address: 40, quantity: 1 });
  await tick();
  answer(socket);
  await expect(reading).resolves.toEqual({ kind: "exception", exceptionCode: 2 });
}

export async function assertTheErrorsCarryNoBytesOrHost(): Promise<void> {
  const { socket, transport, deadlines } = await open();
  const first = transport.request(1, { functionCode: 3, address: 0, quantity: 1 });
  await tick();
  deadlines.fire();
  const timeout = (await first.catch((error: unknown) => error)) as Error;
  socket.closeFromPeer();
  const closed = (await transport
    .request(1, { functionCode: 3, address: 0, quantity: 1 })
    .catch((error: unknown) => error)) as Error;
  for (const error of [timeout, closed]) {
    expect(error.message).not.toMatch(/10\.0\.0\.5|502/);
  }
}
