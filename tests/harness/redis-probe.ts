import net from "node:net";

/**
 * `F4.5` — the smallest Redis client the harness test needs (AUTH, SELECT, SET, GET, QUIT), so
 * proving per-worker index isolation does not add a Redis client to the root's dependencies. Not
 * for use by suites: they reach Redis through `openIntegrationQueueClient` and BullMQ.
 *
 * Replies are parsed as bytes (a RESP bulk length counts bytes, not UTF-16 units). An error
 * reply rejects the command that caused it, and a closed socket rejects every pending command,
 * so a failure surfaces as a rejected promise rather than a hang.
 */

type Reply = string | null;

type Waiter = { resolve: (reply: Reply) => void; reject: (err: Error) => void };

export type ProbeClient = {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<Reply>;
  quit(): Promise<void>;
};

function encode(args: readonly string[]): string {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")}`;
}

/** Connects to `redis://[:password@]host:port[/index]`, authenticates, and selects the index. */
export async function createClient(url: string): Promise<ProbeClient> {
  const parsed = new URL(url);
  const index = parsed.pathname.replace(/^\//, "") || "0";
  const password = decodeURIComponent(parsed.password);
  const socket = net.connect(Number(parsed.port || 6379), parsed.hostname);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  let buffer = Buffer.alloc(0);
  const waiting: Waiter[] = [];
  const failAll = (err: Error): void => {
    for (const waiter of waiting.splice(0)) {
      waiter.reject(err);
    }
  };
  socket.on("error", failAll);
  socket.on("close", () => {
    failAll(new Error("redis-probe: connection closed"));
  });

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end < 0) return;
      const head = buffer.subarray(0, end).toString("utf8");
      if (head.startsWith("$")) {
        const length = Number(head.slice(1));
        if (length < 0) {
          buffer = buffer.subarray(end + 2);
          waiting.shift()?.resolve(null);
          continue;
        }
        if (buffer.length < end + 2 + length + 2) return;
        const value = buffer.subarray(end + 2, end + 2 + length).toString("utf8");
        buffer = buffer.subarray(end + 2 + length + 2);
        waiting.shift()?.resolve(value);
        continue;
      }
      buffer = buffer.subarray(end + 2);
      if (head.startsWith("-")) {
        waiting.shift()?.reject(new Error(`redis-probe: ${head.slice(1)}`));
        continue;
      }
      waiting.shift()?.resolve(head.slice(1));
    }
  });

  const send = (...args: string[]): Promise<Reply> =>
    new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      socket.write(encode(args));
    });

  if (password) {
    await send("AUTH", password);
  }
  await send("SELECT", index);
  return {
    set: async (key, value) => {
      await send("SET", key, value);
    },
    get: (key) => send("GET", key),
    quit: async () => {
      await send("QUIT");
      socket.end();
    },
  };
}
