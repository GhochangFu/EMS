import { randomUUID } from "node:crypto";

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type pg from "pg";

import type { AdminAssetTemplateDto, JwtPayload } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import type { AssetTemplatesStockService } from "./asset-templates-stock.service";
import { assert, loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";
import type { StockAssetTemplateEntry } from "./stock-catalog/types";

/**
 * `F2.13` — the stock catalog's list and import, against a real database
 * (ADR 0052 decisions 4 and 5; plan Task 6b).
 *
 * The service is constructed by hand with a **fixture catalog** through the DI
 * token (`asset-templates.tokens.ts` says why the token stays). Three
 * catalogs, three service instances, built by the `.test.ts`:
 *
 *  - `stock` — {@link buildFixtureCatalog}: a plain entry, a peer-mutation
 *    entry, an entry naming a deliberately INACTIVE point key, and (`E5.2`)
 *    an entry filed under a domain that is not a `bms.asset_domains` row.
 *  - `emptyStock` — `[]`, so the unknown-code 400 is checked with nothing to
 *    list.
 *  - `realStock` — the shipped `STOCK_ASSET_TEMPLATE_CATALOG`, imported whole
 *    against the seeded vocabulary and then published.
 *
 * Every row this suite writes carries `TEST_CODE`, a per-run code, and only
 * that family is deleted — two instances of the suite share one local database
 * (see `TEST_CODE`'s docblock in the lifecycle sibling). The exceptions are the
 * two real imports, whose codes are `electrical-feeder` and (`E5.2`)
 * `mechanical-pump` by definition; each is deleted **by its own id**.
 */
export const TEST_CODE = `F213-STOCK-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** A point key that EXISTS and is INACTIVE — what `assertPointKeysActive` alone refuses. */
export const INACTIVE_KEY = `f213_inactive_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

const PEER_CODE = `${TEST_CODE}-PEER`;
const INACTIVE_CODE = `${TEST_CODE}-INACTIVE`;
const UNKNOWN_DOMAIN_CODE = `${TEST_CODE}-UNKNOWN-DOMAIN`;
const FEEDER_CODE = "electrical-feeder";
const PUMP_CODE = "mechanical-pump";

/**
 * A domain that is not, and will never be, a `bms.asset_domains` row — what
 * `assertAssetDomain` alone refuses. The refusal's *Expected one of* list is
 * read live from the table, so the assertion on it is how this suite proves
 * the `E5.2` seed row `mechanical` exists AND is active on the seeded database
 * without touching the vocabulary. A mutate-and-restore negative (retire
 * `mechanical`, import, restore) is deliberately not written: the seed is
 * `ON CONFLICT (code) DO NOTHING`, so a run that died between the two steps
 * would leave the domain retired on every later boot.
 */
const UNKNOWN_DOMAIN = "f213-not-a-domain";

/** The two real imports' rows, each deleted by its own id in `cleanup`. */
let importedFeederId: string | null = null;
let importedPumpId: string | null = null;

/** Deletes only this run's rows: the `TEST_CODE` family, the two real rows by id, the minted key. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  for (const id of [importedFeederId, importedPumpId]) {
    if (id) {
      await pool.query(`DELETE FROM bms.asset_templates WHERE id = $1`, [id]);
    }
  }
  await pool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [INACTIVE_KEY]);
}

/** Mints the inactive key. Fleet pool: `bms.point_keys` is FORCE-policied and fleet bypasses. */
export async function mintInactiveKey(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, 'F2.13 inactive fixture', false)`,
    [INACTIVE_KEY],
  );
}

const MEASURED = {
  kind: "measured",
  sourceDataKeyPattern: null,
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

/** Built after `loadFixtures`, because the point keys are the seeded organization's. */
export function buildFixtureCatalog(fx: Fixtures): StockAssetTemplateEntry[] {
  const points = [
    { ...MEASURED, pointKey: fx.pointKeys[0], label: "Fixture A", unit: null, required: true, sortOrder: 0, meta: { tier: "core" as const } },
    { ...MEASURED, pointKey: fx.pointKeys[1], label: "Fixture B", unit: null, required: false, sortOrder: 1, meta: { tier: "extended" as const } },
  ];
  const alarms = [
    {
      code: "fixture_high",
      pointKey: fx.pointKeys[0],
      severity: "warning",
      category: "operations",
      message: "Fixture philosophy row — no number.",
    },
  ];
  return [
    {
      code: TEST_CODE,
      name: "Stock fixture",
      assetType: "test_rig",
      domain: "water",
      description: "The catalog's own text.",
      stockVersion: 4,
      content: { contentVersion: 1, alarms },
      points,
    },
    {
      code: PEER_CODE,
      name: "Stock fixture (peer case)",
      assetType: "test_rig",
      domain: "water",
      description: "The catalog's own text — NOT the peer's.",
      stockVersion: 1,
      content: { contentVersion: 1, alarms },
      points,
    },
    {
      code: INACTIVE_CODE,
      name: "Stock fixture (inactive key)",
      assetType: "test_rig",
      domain: "water",
      description: "Names a point key that exists and is inactive.",
      stockVersion: 1,
      content: { contentVersion: 1 },
      points: [
        { ...MEASURED, pointKey: INACTIVE_KEY, label: "Inactive", unit: null, required: true, sortOrder: 0, meta: { tier: "core" as const } },
      ],
    },
    {
      code: UNKNOWN_DOMAIN_CODE,
      name: "Stock fixture (unknown domain)",
      assetType: "test_rig",
      domain: UNKNOWN_DOMAIN,
      description: "Filed under a domain that is not a vocabulary row; its point keys are live.",
      stockVersion: 1,
      content: { contentVersion: 1 },
      points,
    },
  ];
}

async function expectRefusal(
  run: () => Promise<unknown>,
  status: number,
  match: RegExp,
  what: string,
): Promise<string> {
  let caught: unknown = null;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  assert(caught !== null, `${what}: expected a refusal, but the call succeeded`);
  const httpStatus = (caught as { getStatus?: () => number }).getStatus?.();
  const message = caught instanceof Error ? caught.message : String(caught);
  assert(httpStatus === status, `${what}: expected HTTP ${status}, got ${String(httpStatus)} ("${message}")`);
  assert(match.test(message), `${what}: refused with "${message}", which does not match ${match}`);
  return message;
}

async function storedPointCount(pool: pg.Pool, templateId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.template_points WHERE template_id = $1`,
    [templateId],
  );
  return Number(rows[0]?.n ?? "0");
}

/** A second seeded organization — the peer. Never created here; `compose up` verifies the count. */
export async function peerOrganizationId(pool: pg.Pool, ownId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, id LIMIT 1`,
    [ownId],
  );
  const id = rows[0]?.id;
  assert(
    id !== undefined,
    "the peer-mutation case needs a second seeded organization and found none — run pnpm db:seed",
  );
  return id as string;
}

// ---------------------------------------------------------------------------

/** `draft`, version `max + 1`, both stamp columns, points written. */
export async function assertImportLandsAStampedDraft(
  stock: AssetTemplatesStockService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await stock.import(fx.adminJwt, TEST_CODE, fx.organizationId);
  assert(draft.status === "draft", `an import lands as a draft, got ${draft.status}`);
  assert(draft.version === 1, `a fresh code imports at version 1, got ${draft.version}`);
  assert(draft.organizationId === fx.organizationId, "the row belongs to the target organization");
  assert(draft.stockCode === TEST_CODE, `stockCode must be the entry's code, got ${String(draft.stockCode)}`);
  assert(draft.stockVersion === 4, `stockVersion must be the entry's, got ${String(draft.stockVersion)}`);
  assert(draft.points.length === 2, `both points must land, got ${draft.points.length}`);
  assert((await storedPointCount(pool, draft.id)) === 2, "two template_points rows must be stored");
  assert(
    draft.points[0]?.meta !== null && (draft.points[0]?.meta as { tier?: string }).tier === "core",
    "the tier travels with the import",
  );
  return draft;
}

/** Publish, import again: version + 1, still stamped (ADR 0052 decision 4). */
export async function assertReImportOpensTheNextVersion(
  stock: AssetTemplatesStockService,
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
  first: AdminAssetTemplateDto,
): Promise<void> {
  await svc.publish(fx.adminJwt, first.id);
  const second = await stock.import(fx.adminJwt, TEST_CODE, fx.organizationId);
  assert(second.id !== first.id, "a re-import is a new row");
  assert(second.version === first.version + 1, `a re-import opens the next version, got ${second.version}`);
  assert(second.status === "draft", "and it is a draft");
  assert(
    second.stockCode === TEST_CODE && second.stockVersion === 4,
    `the re-import is stamped too, got ${String(second.stockCode)} v${String(second.stockVersion)}`,
  );
}

/**
 * ADR 0049 decision 3 / ADR 0052 decision 5 — the reason this file exists.
 * A peer organization holds a MUTATED row of the same code; the import into
 * another organization must yield the **catalog's** content, not the peer's.
 */
export async function assertImportCopiesTheCatalogNotAPeer(
  stock: AssetTemplatesStockService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const peerOrg = await peerOrganizationId(pool, fx.organizationId);
  // The peer's row: same code, same stamp, everything else edited. Written
  // raw on the fleet pool — this IS the "first customer edited it" state.
  const peerContent = JSON.stringify({
    contentVersion: 1,
    alarms: [
      { code: "peer_alarm", pointKey: fx.pointKeys[0], severity: "critical", message: "the peer's alarm" },
    ],
  });
  await pool.query(
    `INSERT INTO bms.asset_templates
       (organization_id, code, version, name, asset_type, domain, description, status, content,
        stock_code, stock_version, published_at)
     VALUES ($1, $2, 1, 'MUTATED BY THE PEER', 'mutated_rig', 'water', 'the peer''s edit', 'published',
             $3::jsonb, $2, 1, now())`,
    [peerOrg, PEER_CODE, peerContent],
  );

  const imported = await stock.import(fx.adminJwt, PEER_CODE, fx.organizationId);
  assert(imported.organizationId === fx.organizationId, "the import lands in the target organization");
  assert(
    imported.name === "Stock fixture (peer case)",
    `the import must carry the catalog's name, not the peer's — got "${imported.name}"`,
  );
  assert(
    imported.assetType === "test_rig" && imported.description === "The catalog's own text — NOT the peer's.",
    "the import must carry the catalog's assetType and description, not the peer's",
  );
  const alarms = (imported.content as { alarms?: { code: string }[] }).alarms ?? [];
  assert(
    alarms.length === 1 && alarms[0]?.code === "fixture_high",
    `the import must carry the catalog's alarms, not the peer's — got ${JSON.stringify(alarms)}`,
  );
  assert(imported.points.length === 2, "and the catalog's two points");
}

/**
 * ADR 0052 decision 5's "no second insert path": an entry naming a point key
 * that exists but is inactive is refused by `assertPointKeysActive` before any
 * row is written — the guard `0058`'s foreign key cannot express.
 */
export async function assertImportRunsEveryAuthoringGuard(
  stock: AssetTemplatesStockService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const message = await expectRefusal(
    () => stock.import(fx.adminJwt, INACTIVE_CODE, fx.organizationId),
    400,
    /Not in the active point-key catalog/,
    "importing an entry whose point key is inactive",
  );
  assert(message.includes(INACTIVE_KEY), `the refusal must name the key, got "${message}"`);
  const { rowCount } = await pool.query(`SELECT 1 FROM bms.asset_templates WHERE code = $1`, [INACTIVE_CODE]);
  assert(rowCount === 0, "the refusal must come before the insert — a row was written");

  // `E5.2` — the second guard, `assertAssetDomain` (ADR 0031 Amendment 1),
  // with the entry's point keys live so only the domain can refuse it. The
  // list the 400 names is the table's active rows in `sort_order`, so ending
  // in `mechanical` (60) is the proof that the seed row landed and is active.
  const domainMessage = await expectRefusal(
    () => stock.import(fx.adminJwt, UNKNOWN_DOMAIN_CODE, fx.organizationId),
    400,
    new RegExp(`domain "${UNKNOWN_DOMAIN}" is not a live value`),
    "importing an entry filed under a domain that is not a vocabulary row",
  );
  assert(
    /Expected one of: [a-z_, ]*\bmechanical\.$/.test(domainMessage),
    `the refusal must list the live domains ending in "mechanical" — the E5.2 seed row — got "${domainMessage}"`,
  );
  const unknownDomainRows = await pool.query(`SELECT 1 FROM bms.asset_templates WHERE code = $1`, [
    UNKNOWN_DOMAIN_CODE,
  ]);
  assert(unknownDomainRows.rowCount === 0, "the domain refusal must come before the insert — a row was written");
}

/**
 * The shipped feeder, imported whole against the seeded vocabulary: 33 rows
 * land, every key passes `assertPointKeysActive`, all 11 pair-absent alarms
 * survive `assertTemplateAlarmVocabularies` and `assertContentRefsResolve` —
 * then **published**, which re-validates the stored content under the current
 * contract. The single strongest end-to-end proof that a pair-absent alarm is
 * genuinely publishable.
 */
export async function assertTheShippedFeederImportsWholeAgainstTheRealVocabulary(
  realStock: AssetTemplatesStockService,
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  // An open draft of this code in the target organization — left by a crashed
  // run, or a developer's own — would 409 the import. Say so rather than fail
  // as a constraint name; this suite must never delete a row it did not write.
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bms.asset_templates WHERE organization_id = $1 AND code = $2 AND status = 'draft'`,
    [fx.organizationId, FEEDER_CODE],
  );
  assert(
    rowCount === 0,
    `organization ${fx.organizationId} already has an open "${FEEDER_CODE}" draft, so the real import ` +
      "would 409. Publish or delete it, then re-run.",
  );

  const draft = await realStock.import(fx.adminJwt, FEEDER_CODE, fx.organizationId);
  importedFeederId = draft.id;
  assert(draft.stockCode === FEEDER_CODE && draft.stockVersion === 1, "the feeder import is stamped v1");
  assert(draft.points.length === 33, `33 points must land, got ${draft.points.length}`);
  assert((await storedPointCount(pool, draft.id)) === 33, "33 template_points rows must be stored");
  const alarms = (draft.content as { alarms?: Record<string, unknown>[] }).alarms ?? [];
  assert(alarms.length === 11, `11 alarms must survive, got ${alarms.length}`);
  assert(
    alarms.every((alarm) => !("thresholdValue" in alarm) && !("operator" in alarm)),
    "every alarm must still be pair-absent after the round trip",
  );

  const published = await svc.publish(fx.adminJwt, draft.id);
  assert(published.status === "published", `publish must accept the imported feeder, got ${published.status}`);
  assert(published.stockCode === FEEDER_CODE, "publish keeps the stamp");
}

/**
 * `E5.2` Task 6 — **the positive half of the `mechanical` domain's proof**, and
 * the only place a `mechanical` entry travels through `assertAssetDomain`
 * against a real database before step 6.
 *
 * Task 3 proved the seed row is *live* the safe way round: an entry filed under
 * a domain that is not a row is refused with a 400 whose *Expected one of* list
 * — read from the table — ends in `mechanical`. That says the row exists and is
 * active; it cannot say an entry filed under it imports. This does, on the
 * shipped `mechanical-pump`: 20 points land, all ten alarms survive
 * `assertTemplateAlarmVocabularies` and `assertContentRefsResolve` with their
 * `philosophy` objects intact and their threshold pair still absent, and the
 * draft **publishes**, which re-validates the stored content under the current
 * contract.
 *
 * Two of the twenty are `kind: "derived"`, so this is also the first proof that
 * a stock entry's derived points survive an import — their formulas reference
 * measured siblings and their keys are the `E5.2` vocabulary rows.
 */
export async function assertAMechanicalEntryImportsAndPublishes(
  realStock: AssetTemplatesStockService,
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  // Same pre-check as the feeder's, for the same reason: an open draft of this
  // code in the target organization — left by a crashed run, or a developer's
  // own — would 409 the import. Say so rather than fail as a constraint name;
  // this suite must never delete a row it did not write. Drafts only, on
  // purpose: a PUBLISHED leftover (a run that died between `publish` and
  // `cleanup`) does not collide — the next import takes the next version
  // (`F2.13`: a second import of a published code is v2) — so widening this
  // to any status would refuse a run for a state the product allows.
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bms.asset_templates WHERE organization_id = $1 AND code = $2 AND status = 'draft'`,
    [fx.organizationId, PUMP_CODE],
  );
  assert(
    rowCount === 0,
    `organization ${fx.organizationId} already has an open "${PUMP_CODE}" draft, so this import ` +
      "would 409. Publish or delete it, then re-run.",
  );

  const draft = await realStock.import(fx.adminJwt, PUMP_CODE, fx.organizationId);
  importedPumpId = draft.id;
  assert(
    draft.domain === "mechanical",
    `the imported pump must carry domain "mechanical" — the sixth bms.asset_domains row, and the ` +
      `first a pack added through the seed rather than a migration. Got "${draft.domain}".`,
  );
  assert(draft.stockCode === PUMP_CODE && draft.stockVersion === 1, "the pump import is stamped v1");
  assert(draft.points.length === 20, `20 points must land, got ${draft.points.length}`);
  assert((await storedPointCount(pool, draft.id)) === 20, "20 template_points rows must be stored");
  const derivedPoints = draft.points.filter((point) => point.kind === "derived");
  assert(
    derivedPoints.length === 2,
    `both derived points must survive the import — head_m and specific_energy_kwh_kl; got ` +
      `${derivedPoints.length}`,
  );

  const alarms = (draft.content as { alarms?: Record<string, unknown>[] }).alarms ?? [];
  assert(alarms.length === 10, `10 alarms must survive, got ${alarms.length}`);
  assert(
    alarms.every((alarm) => !("thresholdValue" in alarm) && !("operator" in alarm)),
    "every alarm must still be pair-absent after the round trip",
  );
  assert(
    alarms.every((alarm) => {
      const philosophy = alarm.philosophy as Record<string, unknown> | undefined;
      return (
        typeof philosophy === "object" &&
        philosophy !== null &&
        ["cause", "impact", "action"].every(
          (field) => typeof philosophy[field] === "string" && (philosophy[field] as string).length > 0,
        )
      );
    }),
    "every alarm must carry a populated philosophy after the round trip — ADR 0053 decision 5 " +
      "makes cause, impact and action all the meaning an operator gets, because the threshold " +
      "pair is deliberately absent, and a philosophy silently dropped in transit would leave a " +
      "row with no meaning at all",
  );

  const published = await svc.publish(fx.adminJwt, draft.id);
  assert(published.status === "published", `publish must accept the imported pump, got ${published.status}`);
  assert(published.stockCode === PUMP_CODE, "publish keeps the stamp");
}

/** 400, naming the available codes — and still a sentence with an empty catalog. */
export async function assertUnknownCodeIs400NamingTheAvailableCodes(
  stock: AssetTemplatesStockService,
  emptyStock: AssetTemplatesStockService,
  fx: Fixtures,
): Promise<void> {
  const message = await expectRefusal(
    () => stock.import(fx.adminJwt, "NOPE", fx.organizationId),
    400,
    /Unknown stock template "NOPE"/,
    "importing an unknown code",
  );
  for (const code of [TEST_CODE, PEER_CODE, INACTIVE_CODE, UNKNOWN_DOMAIN_CODE]) {
    assert(message.includes(code), `the 400 must name the available code ${code}, got "${message}"`);
  }

  const empty = await expectRefusal(
    () => emptyStock.import(fx.adminJwt, "NOPE", fx.organizationId),
    400,
    /Unknown stock template "NOPE"/,
    "importing an unknown code against an empty catalog",
  );
  assert(
    /catalog is empty/i.test(empty),
    `with nothing to list the message must still read as a sentence and say the catalog is empty, got "${empty}"`,
  );
  assert(!/Available: *$/.test(empty), `an empty catalog must not end in a dangling "Available:", got "${empty}"`);
}

/** ADR 0015 §7 via `assertCanAuthor`: a location admin may not import. */
export async function assertLocationAdminCannotImport(
  stock: AssetTemplatesStockService,
  fx: Fixtures,
): Promise<void> {
  await expectRefusal(
    () => stock.import(fx.locationAdminJwt, TEST_CODE, fx.organizationId),
    403,
    /Location admins cannot author asset templates/,
    "a location admin importing",
  );
}

/** ADR 0052 decision 4: `canManageTemplate` for THAT organization. */
export async function assertForeignOrganizationIsRefused(
  stock: AssetTemplatesStockService,
  fx: Fixtures,
): Promise<void> {
  // An organization_admin with no grant row: ADR 0044 lets the non-admin claim
  // fall back to the JWT, and its grants resolve to [] — outside every
  // organization, including the target.
  const foreignAdmin: JwtPayload = {
    sub: randomUUID(),
    email: `f213-foreign-${randomUUID().slice(0, 8)}@example.invalid`,
    name: "integration:foreign-org-admin",
    role: "organization_admin",
  };
  await expectRefusal(
    () => stock.import(foreignAdmin, TEST_CODE, fx.organizationId),
    403,
    /outside your access scope/,
    "an organization admin of another organization importing",
  );
}

/**
 * `assertCanList` is not decorative: `list()` reads a constant, so without the
 * guard any authenticated principal — a `viewer` included — could enumerate
 * the shipped catalog. The `F3.36` security review found exactly this on the
 * dashboard route.
 */
export async function assertListNeedsAMasterDataRole(stock: AssetTemplatesStockService): Promise<void> {
  const viewer: JwtPayload = {
    sub: randomUUID(),
    email: `f213-viewer-${randomUUID().slice(0, 8)}@example.invalid`,
    name: "integration:viewer",
    role: "viewer",
  };
  let caught: unknown = null;
  try {
    await stock.assertCanList(viewer);
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ForbiddenException, `a viewer must be refused the catalog with a 403, got ${String(caught)}`);
  // And the list itself is what the guard protects — a sanity check that it
  // reads the fixture catalog, so the refusal above is refusing something.
  assert(stock.list().items.length === 4, "the fixture catalog lists its four entries");
}

export { loadFixtures, type Fixtures };
export type { BadRequestException };
