import { mkdirSync, writeFileSync } from "node:fs";

import {
  AUTH_DIR,
  FIXTURES_FILE,
  ROLES,
  apiGet,
  authFile,
  login,
  storageStateFor,
  type Fixtures,
  type Role,
} from "./src/api.js";

/**
 * ADR 0100 decision 6 — sign in once per seeded role and save each session as
 * a Playwright `storageState`; resolve the seeded ids the specs need. Runs
 * after the `webServer`s answer, so the API is up. The files are git-ignored
 * and rewritten every run.
 */
type Coded = { id: string; code: string; organizationCode?: string };

export class E2eFixtureError extends Error {
  override readonly name = "E2eFixtureError";
}

function one(items: readonly Coded[], what: string, match: (item: Coded) => boolean): string {
  const found = items.filter(match);
  if (found.length !== 1) {
    throw new E2eFixtureError(
      `global setup expected exactly one ${what} in the seeded database, found ${found.length}. ` +
        "Run `pnpm --filter @bms/db roles && pnpm db:migrate && pnpm db:seed` against DATABASE_URL.",
    );
  }
  return found[0].id;
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });

  let adminToken = "";
  for (const role of Object.keys(ROLES) as Role[]) {
    const session = await login(role);
    writeFileSync(authFile(role), JSON.stringify(storageStateFor(session), null, 2));
    if (role === "admin") adminToken = session.accessToken;
  }

  const [orgs, locations, assets] = await Promise.all([
    apiGet<{ items: Coded[] }>("/api/v1/admin/organizations", adminToken),
    apiGet<{ items: Coded[] }>("/api/v1/admin/locations", adminToken),
    apiGet<{ items: Coded[] }>("/api/v1/admin/assets", adminToken),
  ]);
  const eskom = (item: Coded): boolean => item.organizationCode === "ESKOM";
  const fixtures: Fixtures = {
    eskomOrganizationId: one(orgs.items, "organization ESKOM", (o) => o.code === "ESKOM"),
    wcLocationId: one(locations.items, "ESKOM location RSMOC-WC", (l) => eskom(l) && l.code === "RSMOC-WC"),
    gautengLocationId: one(locations.items, "ESKOM location CSMOC-GP", (l) => eskom(l) && l.code === "CSMOC-GP"),
    crMainBusAssetId: one(assets.items, "ESKOM asset CR-MAIN-BUS", (a) => eskom(a) && a.code === "CR-MAIN-BUS"),
  };
  writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
}
