import { createRequire } from "node:module";

/**
 * `F4.5` — `pg` for the harness, loaded from `packages/db` through `createRequire`.
 *
 * The root has no `pg` (it is a dependency of `packages/db` and `apps/api`, and pnpm does not
 * hoist it), and ADR 0124 names `testcontainers` as the only new root dependency. So this loads
 * the copy `packages/db` already resolves, the way 19 `tests/` files load `packages/db/dist`, and
 * types only the surface the harness uses.
 */

export type PgQueryResult<R> = { readonly rows: R[]; readonly rowCount: number | null };

export type PgQueryable = {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
};

export type PgClient = PgQueryable & { connect(): Promise<void> };

type PgModule = {
  Client: new (config: { connectionString: string }) => PgClient;
  Pool: new (config: { connectionString: string; max?: number }) => PgQueryable;
};

const requireFromDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));

export const pg = requireFromDb("pg") as PgModule;
