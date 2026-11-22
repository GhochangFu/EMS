import { connect as netConnect } from "node:net";

import {
  createMbapFrameAssembler,
  decodeAdu,
  decodeReadResponse,
  encodeReadRequest,
  type ModbusReadReply,
  type ModbusReadRequest,
} from "@bms/shared/ingest";

/**
 * The read-only Modbus TCP transport (ADR 0141 decisions 4 and 5; `F1.2`
 * plan C4, T4.2).
 *
 * One socket per endpoint, **sequential** requests: a request is written only
 * after the one before it settled, so a serial gateway behind the socket is
 * never handed two at once. Each request carries a fresh transaction id; a
 * reply is matched by that id and the unit id, and a reply that matches no
 * pending request is dropped (Messaging Implementation Guide §4.4.1.3) — a
 * late answer to a timed-out request can never become another request's value.
 *
 * **No timer of its own.** The request deadline and the inter-request delay are
 * one-shot, injected, created and cleared inside one `request()` (ADR 0016 §5
 * rule 4); nothing here schedules a read. The socket factory is injected too, so
 * every test runs without a socket.
 *
 * Errors carry a fixed message and no bytes, host or port: the adapter turns
 * them into `good: false` samples or a rejected `poll()`, and the host logs the
 * reason (AGENTS.md §9.6).
 */

/** The socket surface the transport needs; `node:net`'s socket, narrowed. */
export type ModbusSocket = {
  write(data: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  destroy(): void;
};

/** Opens a connected socket, or rejects. Honours `signal`. */
export type ModbusSocketFactory = (host: string, port: number, signal: AbortSignal) => Promise<ModbusSocket>;

/** Arms one deadline; returns its cancel. One-shot, never repeating. */
export type ModbusDeadline = (ms: number, onExpire: () => void) => () => void;

/** Waits once, for the inter-request delay. Resolves early when `signal` aborts. */
export type ModbusDelay = (ms: number, signal: AbortSignal) => Promise<void>;

export class ModbusTimeoutError extends Error {
  constructor() {
    super("Modbus request timed out");
    this.name = "ModbusTimeoutError";
  }
}

export class ModbusTransportClosedError extends Error {
  constructor() {
    super("Modbus connection closed");
    this.name = "ModbusTransportClosedError";
  }
}

export type ModbusTransport = {
  /** One read, sequential with every other. Resolves a reply (an exception reply included) or rejects. */
  request(unitId: number, read: ModbusReadRequest): Promise<ModbusReadReply>;
  /** Destroys the socket. Idempotent. */
  close(): void;
  readonly closed: boolean;
};

export type ModbusTransportOptions = {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly interRequestDelayMs: number;
  readonly signal: AbortSignal;
  readonly socketFactory: ModbusSocketFactory;
  readonly deadline: ModbusDeadline;
  readonly delay: ModbusDelay;
};

type Pending = {
  readonly transactionId: number;
  readonly unitId: number;
  readonly read: ModbusReadRequest;
  resolve(reply: ModbusReadReply): void;
  reject(error: Error): void;
};

export async function openModbusTransport(options: ModbusTransportOptions): Promise<ModbusTransport> {
  const socket = await options.socketFactory(options.host, options.port, options.signal);
  const assembler = createMbapFrameAssembler();
  let closed = false;
  let pending: Pending | undefined;
  let nextTransactionId = 1;
  let chain: Promise<unknown> = Promise.resolve();
  let requestsSent = 0;

  const shut = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const waiting = pending;
    pending = undefined;
    waiting?.reject(new ModbusTransportClosedError());
    socket.destroy();
  };

  socket.onClose(shut);
  options.signal.addEventListener("abort", shut, { once: true });
  if (options.signal.aborted) {
    shut();
  }

  socket.onData((chunk) => {
    let frames: Uint8Array[];
    try {
      frames = assembler.push(chunk);
    } catch {
      // A length past the bound or a foreign protocol: the stream cannot be
      // resynchronised, so the socket goes and the host reconnects (P10).
      shut();
      return;
    }
    for (const frame of frames) {
      let adu: ReturnType<typeof decodeAdu>;
      try {
        adu = decodeAdu(frame);
      } catch {
        continue;
      }
      const current = pending;
      if (current === undefined || adu.transactionId !== current.transactionId || adu.unitId !== current.unitId) {
        continue;
      }
      pending = undefined;
      try {
        current.resolve(decodeReadResponse(adu.pdu, current.read));
      } catch (error) {
        current.reject(error instanceof Error ? error : new Error("malformed Modbus reply"));
      }
    }
  });

  const send = async (unitId: number, read: ModbusReadRequest): Promise<ModbusReadReply> => {
    if (closed) {
      throw new ModbusTransportClosedError();
    }
    if (requestsSent > 0 && options.interRequestDelayMs > 0) {
      await options.delay(options.interRequestDelayMs, options.signal);
      if (closed) {
        throw new ModbusTransportClosedError();
      }
    }
    const transactionId = nextTransactionId;
    nextTransactionId = (nextTransactionId + 1) & 0xffff;
    const frame = encodeReadRequest({ ...read, transactionId, unitId });
    requestsSent += 1;
    return new Promise<ModbusReadReply>((resolve, reject) => {
      let cancel = (): void => undefined;
      const settle = <T>(fn: (value: T) => void) => (value: T) => {
        cancel();
        fn(value);
      };
      pending = { transactionId, unitId, read, resolve: settle(resolve), reject: settle(reject) };
      cancel = options.deadline(options.timeoutMs, () => {
        if (pending?.transactionId === transactionId) {
          pending = undefined;
          reject(new ModbusTimeoutError());
        }
      });
      socket.write(frame);
    });
  };

  return {
    request(unitId, read) {
      const result = chain.then(() => send(unitId, read));
      chain = result.catch(() => undefined);
      return result;
    },
    close: shut,
    get closed() {
      return closed;
    },
  };
}

/** `node:net`, narrowed to `ModbusSocket`. Rejects on a connect error or an abort. */
export const realSocketFactory: ModbusSocketFactory = (host, port, signal) =>
  new Promise<ModbusSocket>((resolve, reject) => {
    const socket = netConnect({ host, port });
    socket.setNoDelay(true);
    const fail = (): void => {
      socket.destroy();
      reject(new ModbusTransportClosedError());
    };
    const onAbort = (): void => fail();
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("error", fail);
    socket.once("connect", () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("error", fail);
      // A later socket error is followed by `close`, which the transport handles.
      socket.on("error", () => undefined);
      resolve({
        write: (data) => {
          socket.write(data);
        },
        onData: (listener) => {
          socket.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
        },
        onClose: (listener) => {
          socket.once("close", listener);
        },
        destroy: () => {
          socket.destroy();
        },
      });
    });
  });

/** A one-shot `setTimeout`, cleared by the returned function. */
export const realDeadline: ModbusDeadline = (ms, onExpire) => {
  const handle = setTimeout(onExpire, ms);
  return () => clearTimeout(handle);
};

/** One wait for the inter-request delay; ends early on abort. */
export const realDelay: ModbusDelay = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const handle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(handle);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
