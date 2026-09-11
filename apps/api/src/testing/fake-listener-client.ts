import type { ListenerClient, ListenerNotification } from "../database/notify-listener";

/**
 * A `pg.Client` stand-in for the `LISTEN` loop specs (`F3.11`, ADR 0064
 * Amendment 1 A2).
 *
 * This is `telemetry-listener.spec.ts`'s `makeFake`, exported for the specs
 * the generic loop gained — `notify-listener.spec.ts` and `alarm-notify.spec.ts`.
 * The telemetry spec deliberately keeps its own private copy: that file being
 * unchanged byte for byte is the gate on the extraction, so it may not import
 * from here.
 *
 * `emitError` **throws when no handler is registered**, which is not test
 * theatre — `pg.Client` is an `EventEmitter` and an `error` event with no
 * listener really does throw. Modelling that is what makes the
 * "handler attached before connect" test meaningful rather than decorative.
 */
export type FakeListenerClient = {
  client: ListenerClient;
  queries: string[];
  connects: number;
  ends: number;
  /** Registration order, so "was `error` attached before `connect()`" is checkable. */
  events: string[];
  emitError(err: Error): void;
  emitEnd(): void;
  emitNotification(payload: string | undefined): void;
};

export function makeFakeListenerClient(options: { failConnect?: string } = {}): FakeListenerClient {
  const handlers: {
    notification?: (msg: ListenerNotification) => void;
    error?: (err: Error) => void;
    end?: () => void;
  } = {};
  const fake: FakeListenerClient = {
    queries: [],
    connects: 0,
    ends: 0,
    events: [],
    client: {
      async connect(): Promise<void> {
        fake.connects += 1;
        fake.events.push("connect");
        if (options.failConnect !== undefined) {
          throw new Error(options.failConnect);
        }
      },
      async query(sql: string): Promise<unknown> {
        fake.queries.push(sql);
        return undefined;
      },
      on(event: string, listener: unknown): unknown {
        fake.events.push(event);
        if (event === "notification") {
          handlers.notification = listener as (msg: ListenerNotification) => void;
        } else if (event === "error") {
          handlers.error = listener as (err: Error) => void;
        } else if (event === "end") {
          handlers.end = listener as () => void;
        }
        return fake.client;
      },
      async end(): Promise<void> {
        fake.ends += 1;
      },
    } as unknown as ListenerClient,
    emitError(err: Error): void {
      if (handlers.error === undefined) {
        throw new Error("unhandled 'error' event: no listener registered");
      }
      handlers.error(err);
    },
    emitEnd(): void {
      handlers.end?.();
    },
    emitNotification(payload: string | undefined): void {
      handlers.notification?.({ payload });
    },
  };
  return fake;
}

/** Lets a listener loop advance past its pending microtasks and timers. */
export async function flushListener(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
