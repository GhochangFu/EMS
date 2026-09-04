import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { stockAssetTemplateDtoSchema } from "@bms/shared";
import type { AdminAssetTemplateDto, JwtPayload, StockAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { createAssetTemplateBodySchema } from "./asset-templates.schema";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { STOCK_ASSET_TEMPLATE_CATALOG_TOKEN } from "./asset-templates.tokens";
import type { StockAssetTemplateEntry } from "./stock-catalog/types";

/**
 * The stock asset-template catalog surface — `F2.13`, ADR 0052 decisions 4
 * and 5. Two operations: **list** what the repository ships, and **import** one
 * entry into a real `bms.asset_templates` draft the organization then owns.
 *
 * ---
 *
 * **THE IMPORT COPIES FROM THE REPOSITORY, NEVER FROM A PEER ORGANIZATION.**
 *
 * ADR 0049 decision 3 states the property this exists to provide, and states it
 * *because* it is easy to lose: *"A plant onboarded later receives the stock
 * current at its import, not whatever the first customer edited — that is the
 * property the stock catalog exists to provide, and it is stated here so it is
 * not lost to an implementation that copies from a peer organization instead."*
 * The obvious wrong implementation is not a silly one — copying an existing
 * row of the same `code` is a smaller query and produces a plausible result,
 * right up until the first customer edits their feeder template and every
 * plant onboarded afterwards inherits *their* edits. The test that catches it
 * mutates a peer organization's row and asserts the import still yields the
 * **catalog's** content (`asset-templates-stock.integration.spec.ts`).
 *
 * **THIS SERVICE DOES NOT INSERT** (ADR 0052 decision 5). `import` calls
 * `AssetTemplatesAdminService.create` with the entry's body, the target
 * organization and the stamp — so every guard an authored draft passes, an
 * import passes: `assertPointKeysActive`, `assertAssetDomain`, the alarm
 * vocabularies, the content reference check. Since `F2.16` the import also
 * runs `createAssetTemplateBodySchema` itself — the 256 KB content cap, the
 * prototype-key ban, the bms-calc-v1 formula parse and the `.strict()` key
 * set — on the same object `checkEntry` parses at build time
 * (`stock-catalog.spec.ts`), rather than trusting that build-time pass to
 * still hold at import time. Nothing the catalog says can bypass a rule the
 * form enforces, and there is no second write path to keep honest.
 *
 * **THE CATALOG ARRIVES THROUGH A DI TOKEN**, not an import, even though a
 * real entry ships — `asset-templates.tokens.ts` records the three test cases
 * that need a catalog the shipped one is not (the peer-mutation property, the
 * empty-catalog 400, the inactive-key guard).
 */
@Injectable()
export class AssetTemplatesStockService {
  constructor(
    @Inject(STOCK_ASSET_TEMPLATE_CATALOG_TOKEN)
    private readonly catalog: readonly StockAssetTemplateEntry[],
    private readonly accessControl: AccessControlService,
    private readonly templates: AssetTemplatesAdminService,
  ) {}

  /**
   * The catalog is master data, so listing it needs a master-data role.
   *
   * A separate method rather than a check inside `list()`, because `list()`
   * reads no database and takes no actor — making it async purely to hold a
   * guard would hide that. The controller calls this first. **Not
   * decorative**: without it any authenticated principal, a `viewer` included,
   * could enumerate the shipped catalog — the `F3.36` security finding.
   */
  async assertCanList(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
  }

  /**
   * What the repository ships, projected to the listed shape. Reads no
   * database — this is code.
   *
   * `StockAssetTemplateDto` is the entry's *listed* projection (ADR 0052
   * decision 2): the same fields minus nothing, `content` as a bare record.
   * `stock-catalog.spec.ts` parses every shipped entry through this schema at
   * build time, so the parse here cannot fail for a shipped entry — it is the
   * projection, not a second validation.
   */
  list(): { items: StockAssetTemplateDto[] } {
    return { items: this.catalog.map((entry) => stockAssetTemplateDtoSchema.parse(entry)) };
  }

  /**
   * Import one stock entry into an organization, as a **draft** at
   * `max(version) + 1`, stamped, audited as `master.asset_template.import`.
   *
   * Re-importing a code the organization already holds opens the next version
   * — taking a newer release is the same act (decision 4). The partial draft
   * index refuses a second concurrent import; `create` translates that to a
   * 409 naming the code.
   *
   * Authorization is checked **before** the code lookup, so an actor outside
   * the organization learns nothing from the 400's list of available codes.
   * `create` checks it again; the second check is cheap and keeps `create`
   * self-contained for every other caller.
   */
  async import(jwt: JwtPayload, code: string, organizationId: string): Promise<AdminAssetTemplateDto> {
    await this.templates.assertCanAuthor(jwt, organizationId);

    const entry = this.catalog.find((candidate) => candidate.code === code);
    if (!entry) {
      const available = this.catalog.map((candidate) => candidate.code);
      throw new BadRequestException(
        `Unknown stock template "${code}". ` +
          (available.length === 0
            ? "The catalog is empty — nothing can be imported."
            : `Available: ${available.join(", ")}.`),
      );
    }

    // The create body is `.strict()`; `stockVersion` is not a body field. It
    // travels as the stamp — `create`'s third argument — beside the code. The
    // destructure must run BEFORE the parse below: parsing the whole `entry`
    // (stockVersion included) would make `.strict()` refuse every import with
    // "Unrecognized key(s) in object: 'stockVersion'".
    const { stockVersion, ...body } = entry;

    // `F2.16` — until this line, nothing here ever ran
    // `createAssetTemplateBodySchema` on an import; the 256 KB content cap,
    // the prototype-key ban, the bms-calc-v1 formula parse and the `.strict()`
    // key set only guarded a stock entry at BUILD time, via `checkEntry` in
    // `stock-catalog.spec.ts`. That build-time check stays — it is what keeps
    // a malformed entry from ever shipping — but it is not a substitute for
    // running the same contract at the moment the entry is turned into a
    // create call, which is what every other caller of `create` goes through.
    //
    // This is also the ONLY create-time path where the 256 KB cap can ever
    // bind: `asset-templates-content.schema.ts:78-82` records that Express's
    // body parser answers 413 at 100 KB, so on `POST /` the schema's own cap
    // is unreachable. A stock import carries its content from code, not the
    // HTTP body, so it is the one path the byte cap actually protects — and
    // the one path that was not applying it.
    //
    // A `ZodError` here propagates rather than being caught and rewrapped:
    // `importStock` (asset-templates.controller.ts:116-118) already catches
    // `ZodError` and answers `BadRequestException(err.flatten())` — the same
    // 400 body `POST /` returns for the identical schema. Propagating keeps
    // this the one service method in `apps/api` whose refusal is a
    // `ZodError` rather than a Nest HTTP exception, and its only caller
    // already maps it; converting it here would bury the schema's own
    // message behind a generic "Bad Request Exception".
    //
    // The parsed OUTPUT, not the raw entry, is what reaches `create` — Zod's
    // defaults (`kind`, `required`, `sortOrder`) are applied identically to a
    // hand-authored draft and an import. Measured against all 27 shipped
    // catalog entries: 27 pass, and all 27 parse to output deep-equal to
    // their input, so no shipped entry's shape changes here.
    const parsed = createAssetTemplateBodySchema.parse({ organizationId, ...body });
    return this.templates.create(jwt, parsed, { stockCode: entry.code, stockVersion });
  }
}
