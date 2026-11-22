import { createServer, type Socket } from "node:net";

import { createMbapFrameAssembler, serveModbusFrame, type ModbusImage } from "@bms/shared/ingest";

/**
 * An in-process Modbus TCP server for tests (ADR 0141 decision 19; `F1.2`
 * plan T4.4). Listens on `127.0.0.1` only, answers each request from the image
 * of the request's unit id through the shared codec's `serveModbusFrame` (the
 * same server half the simulator uses), and never ships: `tsconfig.build.json`
 * excludes `src/testing/**`, and `tests/repo-invariants.test.ts` refuses a
 * runtime import of it.
 */

export type ModbusTestServer = {
  readonly port: number;
  /** Unit id → what it holds. Mutable: a test can change a value between polls. */
  readonly images: Map<number, ModbusImage>;
  /** Requests answered so far. */
  readonly requests: () => number;
  /** Drops every open connection and stops listening. */
  close(): Promise<void>;
};

export async function startModbusTestServer(
  images: Map<number, ModbusImage>,
  options: { port?: number } = {},
): Promise<ModbusTestServer> {
  const sockets = new Set<Socket>();
  let requests = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    const assembler = createMbapFrameAssembler();
    socket.on("data", (chunk: Buffer) => {
      let frames: Uint8Array[];
      try {
        frames = assembler.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        const unitId = frame[6] as number;
        const reply = serveModbusFrame(frame, images.get(unitId) ?? {});
        if (reply !== null) {
          requests += 1;
          socket.write(reply);
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    images,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
