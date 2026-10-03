import { getTableName, is, SQL, Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BmsDb } from "@bms/db";

/**
 * `F3.78` — a recording fake of the drizzle surface `UsersService` uses, for
 * `users.service.spec.ts`. It holds no assertions.
 *
 * Every statement is recorded, in order, into one shared {@link Timeline}
 * (which the spec's identity fake writes into too, so "the db insert precedes
 * `setEnabled(true)`" is one index comparison). A statement resolves through
 * the spec's `answer` function, which sees the recorded op.
 *
 * **Honest about `.returning()`.** An `UPDATE` awaited without `.returning()`
 * resolves to a `pg` `QueryResult`-like object, not to an array — exactly what
 * drizzle hands back — so a service that drops `.returning()` and then reads
 * `.length` sees `undefined`, and its empty-result guard stops firing.
 */

export type DbOp = {
  readonly executor: string;
  readonly kind: "select" | "update" | "insert" | "execute";
  /** The table of `from()` / `update()` / `insert()`; `null` for `execute`. */
  readonly table: string | null;
  /** The rendered `where` (select/update) or statement (execute) text. */
  readonly text: string;
  readonly params: readonly unknown[];
  /** `set()` values of an update, `values()` of an insert. */
  readonly values: Record<string, unknown> | null;
  readonly returning: boolean;
};

export type TimelineEntry = { readonly source: "db"; readonly op: DbOp } | { readonly source: "identity"; readonly method: string; readonly args: readonly unknown[] };

export type Timeline = TimelineEntry[];

export type Answer = (op: DbOp) => unknown[] | undefined;

const dialect = new PgDialect();

function render(value: unknown): { text: string; params: unknown[] } {
  if (is(value, SQL)) {
    const query = dialect.sqlToQuery(value);
    return { text: query.sql, params: query.params };
  }
  return { text: "", params: [] };
}

class Builder implements PromiseLike<unknown> {
  private table: string | null = null;
  private condition: unknown = undefined;
  private payload: Record<string, unknown> | null = null;
  private returningCalled = false;

  constructor(
    private readonly executor: string,
    private readonly kind: DbOp["kind"],
    private readonly timeline: Timeline,
    private readonly answer: Answer,
    table?: unknown,
  ) {
    if (table !== undefined) this.setTable(table);
  }

  private setTable(table: unknown): void {
    this.table = is(table, Table) ? getTableName(table as Table) : String(table);
  }

  from(table: unknown): this {
    this.setTable(table);
    return this;
  }
  innerJoin(): this {
    return this;
  }
  leftJoin(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  for(): this {
    return this;
  }
  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }
  set(values: Record<string, unknown>): this {
    this.payload = values;
    return this;
  }
  values(values: Record<string, unknown>): this {
    this.payload = values;
    return this;
  }
  returning(): this {
    this.returningCalled = true;
    return this;
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?: ((value: unknown) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<unknown> {
    const rendered = render(this.condition);
    const op: DbOp = {
      executor: this.executor,
      kind: this.kind,
      table: this.table,
      text: rendered.text,
      params: rendered.params,
      values: this.payload,
      returning: this.returningCalled,
    };
    this.timeline.push({ source: "db", op });
    const rows = this.answer(op) ?? [];
    if (this.kind === "select" || this.returningCalled) {
      return rows;
    }
    // drizzle node-postgres: an UPDATE/INSERT without RETURNING resolves to the QueryResult.
    return { rows: [], rowCount: rows.length, command: this.kind.toUpperCase() };
  }
}

/**
 * A fake `BmsDb` labelled `executor`. `transaction(fn)` hands `fn` a fake
 * labelled `${executor}.tx` that writes into the same timeline.
 */
export function recordingDb(executor: string, timeline: Timeline, answer: Answer): BmsDb {
  const make = (label: string): Record<string, unknown> => {
    const db: Record<string, unknown> = {
      select: () => new Builder(label, "select", timeline, answer),
      update: (table: unknown) => new Builder(label, "update", timeline, answer, table),
      insert: (table: unknown) => new Builder(label, "insert", timeline, answer, table),
      execute: async (query: unknown) => {
        const rendered = render(query);
        const op: DbOp = {
          executor: label,
          kind: "execute",
          table: null,
          text: rendered.text,
          params: rendered.params,
          values: null,
          returning: false,
        };
        timeline.push({ source: "db", op });
        return { rows: answer(op) ?? [] };
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(make(`${label}.tx`)),
    };
    return db;
  };
  return make(executor) as unknown as BmsDb;
}

/** The db ops of a timeline, in order. */
export function dbOps(timeline: Timeline): DbOp[] {
  return timeline.flatMap((entry) => (entry.source === "db" ? [entry.op] : []));
}

/** The index in `timeline` of the first entry `match` accepts, or -1. */
export function indexOf(timeline: Timeline, match: (entry: TimelineEntry) => boolean): number {
  return timeline.findIndex(match);
}
