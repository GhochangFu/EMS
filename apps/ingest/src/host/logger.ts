import type { AdapterLogger } from "../adapter/types.js";

/**
 * The host's logger (ADR 0016 §Dependencies).
 *
 * "No logging library. `AdapterLogger` is a three-method interface implemented
 * by the host over `process.stdout.write` with JSON lines." One structured line
 * per event, so `docker logs` stays greppable and swapping in Pino later is a
 * one-file change.
 *
 * `console.*` is forbidden by AGENTS.md §4.5, which is also §5 rule 10 for
 * adapters — they get one of these, bound to `{ endpointKey, protocol }`, and
 * have no other way to say anything.
 */

export type HostLogger = AdapterLogger & {
  /** Returns a logger that adds `fields` to every line. */
  child(fields: Record<string, unknown>): HostLogger;
};

export type LogWriter = (line: string) => void;

const defaultWriter: LogWriter = (line) => {
  process.stdout.write(line);
};

export function createHostLogger(
  base: Record<string, unknown> = {},
  write: LogWriter = defaultWriter,
): HostLogger {
  function emit(level: string, message: string, fields?: Record<string, unknown>): void {
    const line = {
      // `time` first so a truncated line is still sortable.
      time: new Date().toISOString(),
      level,
      component: "ingest-host",
      ...base,
      ...fields,
      message,
    };
    let serialised: string;
    try {
      serialised = JSON.stringify(line);
    } catch {
      // A circular or non-serialisable field must not take down the caller —
      // logging is never allowed to be the thing that breaks ingest.
      serialised = JSON.stringify({
        time: line.time,
        level,
        component: "ingest-host",
        message,
        note: "fields omitted: not serialisable",
      });
    }
    write(`${serialised}\n`);
  }

  return {
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createHostLogger({ ...base, ...fields }, write),
  };
}
