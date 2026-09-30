import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { mimicLibrarySettings, mimicOrgSymbolLibraries, mimicOrgSymbols, mimicSymbolLibraries, mimicSymbols } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MAX_MIMIC_ORG_SYMBOL_KEY_CHARS,
  MAX_MIMIC_ORG_SYMBOLS_PER_LIBRARY,
  MAX_MIMIC_SYMBOL_SVG_BYTES,
} from "@bms/shared";
import type {
  JwtPayload,
  MimicGlobalLibraryStatusDto,
  MimicLibrarySettingDto,
  MimicOrgSymbolDto,
  MimicOrgSymbolLibraryDto,
  MimicSymbolGroupCode,
  MimicSymbolLibrariesResponse,
  MimicSymbolLibraryCode,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { orgSymbolsOf } from "../mimic-layouts/mimic-org-symbols";
import type { OrgSymbolRow } from "../mimic-layouts/mimic-org-symbols";
import type {
  CreateMimicOrgSymbolLibraryBody,
  PutMimicLibrarySettingBody,
  UpdateMimicOrgSymbolBody,
  UpdateMimicOrgSymbolLibraryBody,
} from "./mimic-symbol-libraries.schema";
import { SvgSymbolRefusal, parseSvgSymbol } from "./svg-symbol-parser";

type LibraryRow = typeof mimicOrgSymbolLibraries.$inferSelect;
type SymbolRow = typeof mimicOrgSymbols.$inferSelect;
type Executor = BmsDb | BmsTx;

/** The roles that may manage a library, besides `admin` (the mimic layouts' authors). */
const AUTHOR_ROLES = new Set(["admin", "organization_admin"]);

const UNKNOWN_LIBRARY_MESSAGE = "Unknown symbol library";
const LIBRARY_NOT_FOUND = "Symbol library not found";

/** What the controller hands `uploadSymbol` after the request-shape parses. */
export type MimicSymbolUploadInput = {
  buffer: Buffer;
  declaredType: string;
  /** Decoded (`decodeMulterFilename`) and parsed (`mimicSymbolFilenameSchema`). */
  originalFilename: string;
  name?: string;
  label?: string;
  group?: MimicSymbolGroupCode;
};

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4, 6 and 7 (plan D5, D6) — an organization's own symbol
 * libraries, their uploaded symbols, and the per-organization switch for a global library.
 *
 * **Reads run on `fleetDb`, writes on `tenantDb` inside `withTenant`** — the
 * `MimicLayoutsService` split. The three tables are `FORCE ROW LEVEL SECURITY` (migration
 * `0093`); `bms_fleet` bypasses it, so every fleet read below filters by
 * `readableOrganizationIds` (or the one organization already proved readable) in its own
 * `where`, and that is the read isolation control. A library outside the caller's organizations
 * answers 404, never 403.
 *
 * **Only `admin` and `organization_admin` write**, and only in an organization they manage —
 * the role first, because `canManageOrganization` alone admits a `location_admin` (the `F3.36`
 * finding). The audit row is written inside the mutation's transaction and names the
 * organization (the `e7.1c` gate).
 *
 * **Stored symbols are re-checked on the way out** (`orgSymbolsOf`, `safeParse`): a row that
 * fails the contract is omitted and logged by id, never a 400 for the whole answer (`F4.108`).
 * Retired libraries and symbols are listed with their flags (plan ruling R8): the admin page
 * reactivates them, and a stored drawing still draws them.
 */
@Injectable()
export class MimicSymbolLibrariesService {
  private readonly logger = new Logger(MimicSymbolLibrariesService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * The global libraries with the switch, and the organization libraries with every symbol.
   * `enabled` reads the switch of `organizationId`, or of the caller's only organization; a
   * caller reading several organizations at once sees each global library as enabled — the
   * editor always names one organization.
   */
  async list(jwt: JwtPayload, organizationId?: string): Promise<MimicSymbolLibrariesResponse> {
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (organizationId !== undefined && readable !== null && !readable.includes(organizationId)) {
      throw new NotFoundException("Organization not found");
    }
    const scope = organizationId !== undefined ? [organizationId] : readable;
    const switchOrg = organizationId ?? (readable?.length === 1 ? readable[0] : undefined);
    return {
      global: await this.globalLibraries(switchOrg),
      organization: scope !== null && scope.length === 0 ? [] : await this.organizationLibraries(this.fleetDb, scope),
    };
  }

  async create(jwt: JwtPayload, body: CreateMimicOrgSymbolLibraryBody): Promise<MimicOrgSymbolLibraryDto> {
    const author = await this.assertCanAuthor(jwt, body.organizationId);
    return withTenant(this.tenantDb, body.organizationId, async (tx) => {
      const [library] = await tx
        .insert(mimicOrgSymbolLibraries)
        .values({
          organizationId: body.organizationId,
          code: body.code,
          label: body.label,
          style: body.style,
          licence: body.licence,
          attribution: body.attribution,
          sourceUrl: body.sourceUrl ?? null,
          createdBy: author,
        })
        .returning();
      if (!library) throw new ConflictException("The library could not be created");
      await this.audit.write(
        {
          actor: jwt,
          organizationId: library.organizationId,
          action: "master.mimic_org_symbol_library.create",
          entityType: "mimic_org_symbol_library",
          entityId: library.id,
          payload: { code: library.code, style: library.style },
        },
        tx,
      );
      return this.libraryDto(library, []);
    }).catch((err: unknown) => {
      throw MimicSymbolLibrariesService.translateWriteError(err);
    });
  }

  /** Label, licence, attribution, source or `active` — `active: false` retires (decision 7). */
  async update(jwt: JwtPayload, id: string, body: UpdateMimicOrgSymbolLibraryBody): Promise<MimicOrgSymbolLibraryDto> {
    const existing = await this.fetchReadableLibrary(jwt, id);
    await this.assertCanAuthor(jwt, existing.organizationId);
    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const [library] = await tx
        .update(mimicOrgSymbolLibraries)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.licence !== undefined ? { licence: body.licence } : {}),
          ...(body.attribution !== undefined ? { attribution: body.attribution } : {}),
          ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(mimicOrgSymbolLibraries.id, id))
        .returning();
      if (!library) throw new NotFoundException(LIBRARY_NOT_FOUND);
      await this.audit.write(
        {
          actor: jwt,
          organizationId: library.organizationId,
          action: "master.mimic_org_symbol_library.update",
          entityType: "mimic_org_symbol_library",
          entityId: library.id,
          // The field names only; free text is not an auditor's concern.
          payload: { fields: Object.keys(body).sort(), active: library.active },
        },
        tx,
      );
      const [dto] = await this.organizationLibraries(tx, [library.organizationId], library.id);
      return dto ?? this.libraryDto(library, []);
    });
  }

  /**
   * The upload's access gate: the library is readable (else 404) and the caller may author in
   * its organization (else 403). The controller calls it **before** `requireFile`, so a caller
   * outside the scope never learns whether its file arrived; `uploadSymbol` calls it again.
   */
  async assertCanUploadTo(jwt: JwtPayload, id: string): Promise<{ library: LibraryRow; author: string }> {
    const library = await this.fetchReadableLibrary(jwt, id);
    const author = await this.assertCanAuthor(jwt, library.organizationId);
    return { library, author };
  }

  /**
   * One SVG file becomes one symbol (decision 6): the byte cap and the declared type, then the
   * parser (geometry only; its refusal is the caller's 400, naming an element and never the
   * content), then the name, the per-library cap under a lock on the library row, the insert
   * and the audit. `sha256` is computed from the buffer, never taken from the caller.
   */
  async uploadSymbol(jwt: JwtPayload, id: string, input: MimicSymbolUploadInput): Promise<MimicOrgSymbolDto> {
    const { library, author } = await this.assertCanUploadTo(jwt, id);
    if (input.buffer.length === 0) throw new BadRequestException("Symbol file is required");
    if (input.buffer.length > MAX_MIMIC_SYMBOL_SVG_BYTES) {
      throw new PayloadTooLargeException(`Symbol file exceeds the ${MAX_MIMIC_SYMBOL_SVG_BYTES}-byte limit`);
    }
    if (input.declaredType !== "image/svg+xml") {
      throw new BadRequestException("Only an SVG file (image/svg+xml) is accepted");
    }
    if (!library.active) throw new BadRequestException("A retired library takes no new symbol");
    let parsed: ReturnType<typeof parseSvgSymbol>;
    try {
      parsed = parseSvgSymbol(input.buffer);
    } catch (err) {
      if (err instanceof SvgSymbolRefusal) throw new BadRequestException(err.message);
      throw err;
    }
    const stem = input.originalFilename.replace(/\.[^.]*$/, "").trim();
    const key = MimicSymbolLibrariesService.symbolKeyOf(library.code, input.name, stem);
    const label = MimicSymbolLibrariesService.labelOf(input.label, stem, key);
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");

    return withTenant(this.tenantDb, library.organizationId, async (tx) => {
      // The lock serialises two uploads into one library, so the count cannot be read stale.
      await tx.select({ id: mimicOrgSymbolLibraries.id }).from(mimicOrgSymbolLibraries).where(eq(mimicOrgSymbolLibraries.id, id)).for("update");
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(mimicOrgSymbols)
        .where(eq(mimicOrgSymbols.libraryId, id));
      if (Number(n) >= MAX_MIMIC_ORG_SYMBOLS_PER_LIBRARY) {
        throw new ConflictException(`The library holds ${MAX_MIMIC_ORG_SYMBOLS_PER_LIBRARY} symbols`);
      }
      const [symbol] = await tx
        .insert(mimicOrgSymbols)
        .values({
          organizationId: library.organizationId,
          libraryId: library.id,
          key,
          label,
          groupCode: input.group ?? "general",
          viewBox: parsed.viewBox,
          shapes: parsed.shapes,
          sourceFilename: input.originalFilename,
          sha256,
          createdBy: author,
        })
        .returning();
      if (!symbol) throw new ConflictException("The symbol could not be stored");
      await this.audit.write(
        {
          actor: jwt,
          organizationId: library.organizationId,
          action: "master.mimic_org_symbol.create",
          entityType: "mimic_org_symbol",
          entityId: symbol.id,
          // `shapes` is the count: the geometry itself is up to 200 × 8 KiB and lives in its row.
          payload: { libraryId: library.id, key, sha256, byteSize: input.buffer.length, shapes: parsed.shapes.length },
        },
        tx,
      );
      return this.symbolDto(symbol, library.style);
    }).catch((err: unknown) => {
      throw MimicSymbolLibrariesService.translateWriteError(err);
    });
  }

  /** Label, group or `active` of one symbol of the library. */
  async updateSymbol(jwt: JwtPayload, id: string, symbolId: string, body: UpdateMimicOrgSymbolBody): Promise<MimicOrgSymbolDto> {
    const library = await this.fetchReadableLibrary(jwt, id);
    await this.assertCanAuthor(jwt, library.organizationId);
    return withTenant(this.tenantDb, library.organizationId, async (tx) => {
      const [symbol] = await tx
        .update(mimicOrgSymbols)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.group !== undefined ? { groupCode: body.group } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(mimicOrgSymbols.id, symbolId), eq(mimicOrgSymbols.libraryId, id)))
        .returning();
      if (!symbol) throw new NotFoundException("Mimic symbol not found");
      await this.audit.write(
        {
          actor: jwt,
          organizationId: library.organizationId,
          action: "master.mimic_org_symbol.update",
          entityType: "mimic_org_symbol",
          entityId: symbol.id,
          payload: { libraryId: library.id, key: symbol.key, fields: Object.keys(body).sort(), active: symbol.active },
        },
        tx,
      );
      return this.symbolDto(symbol, library.style);
    });
  }

  /**
   * The per-organization switch for a global library (decision 4). `core` cannot be disabled;
   * an unknown or retired code is one 400 with no echo. An upsert: no row means enabled.
   */
  async putSetting(jwt: JwtPayload, libraryCode: string, body: PutMimicLibrarySettingBody): Promise<MimicLibrarySettingDto> {
    const author = await this.assertCanAuthor(jwt, body.organizationId);
    if (libraryCode === "core" && !body.enabled) {
      throw new BadRequestException("The core library cannot be disabled");
    }
    const [live] = await this.fleetDb
      .select({ code: mimicSymbolLibraries.code })
      .from(mimicSymbolLibraries)
      .where(and(eq(mimicSymbolLibraries.code, libraryCode), eq(mimicSymbolLibraries.active, true)))
      .limit(1);
    if (!live) throw new BadRequestException(UNKNOWN_LIBRARY_MESSAGE);
    return withTenant(this.tenantDb, body.organizationId, async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(mimicLibrarySettings)
        .values({ organizationId: body.organizationId, libraryCode: live.code, enabled: body.enabled, updatedBy: author, updatedAt: now })
        .onConflictDoUpdate({
          target: [mimicLibrarySettings.organizationId, mimicLibrarySettings.libraryCode],
          set: { enabled: body.enabled, updatedBy: author, updatedAt: now },
        })
        .returning();
      if (!row) throw new ConflictException("The setting could not be stored");
      await this.audit.write(
        {
          actor: jwt,
          organizationId: body.organizationId,
          action: "master.mimic_library_setting.update",
          entityType: "mimic_library_setting",
          entityId: null,
          payload: { libraryCode: row.libraryCode, enabled: row.enabled },
        },
        tx,
      );
      return {
        organizationId: row.organizationId,
        libraryCode: row.libraryCode as MimicSymbolLibraryCode,
        enabled: row.enabled,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** The authoring gate, copied from `MimicLayoutsService` (plan D6): the role, then the scope. */
  private async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<string> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (!AUTHOR_ROLES.has(user.role)) {
      throw new ForbiddenException("Only an organization admin can manage symbol libraries");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    return user.id;
  }

  /** The library, if the caller may read its organization; else 404. */
  private async fetchReadableLibrary(jwt: JwtPayload, id: string): Promise<LibraryRow> {
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    const [library] = await this.fleetDb
      .select()
      .from(mimicOrgSymbolLibraries)
      .where(eq(mimicOrgSymbolLibraries.id, id))
      .limit(1);
    if (!library || (readable !== null && !readable.includes(library.organizationId))) {
      throw new NotFoundException(LIBRARY_NOT_FOUND);
    }
    return library;
  }

  private async globalLibraries(organizationId: string | undefined): Promise<MimicGlobalLibraryStatusDto[]> {
    const rows = await this.fleetDb
      .select({
        code: mimicSymbolLibraries.code,
        label: mimicSymbolLibraries.label,
        style: mimicSymbolLibraries.style,
        licence: mimicSymbolLibraries.licence,
        active: mimicSymbolLibraries.active,
        enabled:
          organizationId === undefined
            ? sql<boolean>`true`
            : sql<boolean>`coalesce(${mimicLibrarySettings.enabled}, true)`,
      })
      .from(mimicSymbolLibraries)
      .leftJoin(
        mimicLibrarySettings,
        and(
          eq(mimicLibrarySettings.libraryCode, mimicSymbolLibraries.code),
          // No organization: the join matches nothing, and `enabled` is `true` above.
          organizationId === undefined ? sql`false` : eq(mimicLibrarySettings.organizationId, organizationId),
        ),
      )
      .where(eq(mimicSymbolLibraries.active, true))
      .orderBy(asc(mimicSymbolLibraries.sortOrder), asc(mimicSymbolLibraries.code));
    const retired = await this.fleetDb
      .select({ key: mimicSymbols.key, libraryCode: mimicSymbols.libraryCode })
      .from(mimicSymbols)
      .where(eq(mimicSymbols.active, false))
      .orderBy(asc(mimicSymbols.key));
    return rows.map((row) => ({
      code: row.code as MimicSymbolLibraryCode,
      label: row.label,
      style: row.style as "stroke" | "fill",
      licence: row.licence,
      active: row.active,
      enabled: row.enabled === true,
      inactiveSymbolKeys: retired.filter((symbol) => symbol.libraryCode === row.code).map((symbol) => symbol.key),
    }));
  }

  /**
   * Libraries of `organizationIds` (`null` = every organization, the global admin), retired ones
   * included, each with every symbol that passes the contract. `onlyId` narrows to one library.
   */
  private async organizationLibraries(
    db: Executor,
    organizationIds: readonly string[] | null,
    onlyId?: string,
  ): Promise<MimicOrgSymbolLibraryDto[]> {
    const libraries = await db
      .select()
      .from(mimicOrgSymbolLibraries)
      .where(
        and(
          organizationIds === null ? undefined : inArray(mimicOrgSymbolLibraries.organizationId, [...organizationIds]),
          onlyId === undefined ? undefined : eq(mimicOrgSymbolLibraries.id, onlyId),
        ),
      )
      .orderBy(asc(mimicOrgSymbolLibraries.label), asc(mimicOrgSymbolLibraries.code), asc(mimicOrgSymbolLibraries.id));
    if (libraries.length === 0) return [];
    const symbols = await db
      .select()
      .from(mimicOrgSymbols)
      .where(
        and(
          inArray(
            mimicOrgSymbols.libraryId,
            libraries.map((library) => library.id),
          ),
          inArray(mimicOrgSymbols.organizationId, [...new Set(libraries.map((library) => library.organizationId))]),
        ),
      )
      .orderBy(asc(mimicOrgSymbols.groupCode), asc(mimicOrgSymbols.label), asc(mimicOrgSymbols.key));
    return libraries.map((library) =>
      this.libraryDto(
        library,
        symbols.filter((symbol) => symbol.libraryId === library.id && symbol.organizationId === library.organizationId),
      ),
    );
  }

  private libraryDto(library: LibraryRow, symbols: readonly SymbolRow[]): MimicOrgSymbolLibraryDto {
    return {
      id: library.id,
      organizationId: library.organizationId,
      code: library.code,
      key: `org.${library.code}`,
      label: library.label,
      style: library.style as "stroke" | "fill",
      licence: library.licence,
      attribution: library.attribution,
      sourceUrl: library.sourceUrl,
      active: library.active,
      symbolCount: symbols.length,
      symbols: orgSymbolsOf(
        symbols.map((symbol) => MimicSymbolLibrariesService.symbolRow(symbol, library.style)),
        (message) => this.logger.warn(message),
      ),
      createdAt: library.createdAt.toISOString(),
      updatedAt: library.updatedAt.toISOString(),
    };
  }

  /** One stored symbol as a DTO; a row the contract refuses is a refusal of the write itself. */
  private symbolDto(symbol: SymbolRow, style: string): MimicOrgSymbolDto {
    const [dto] = orgSymbolsOf([MimicSymbolLibrariesService.symbolRow(symbol, style)], (message) =>
      this.logger.warn(message),
    );
    if (!dto) throw new BadRequestException("The symbol is not in the shape grammar");
    return dto;
  }

  private static symbolRow(symbol: SymbolRow, style: string): OrgSymbolRow {
    return {
      id: symbol.id,
      libraryId: symbol.libraryId,
      key: symbol.key,
      label: symbol.label,
      groupCode: symbol.groupCode,
      style,
      viewBox: symbol.viewBox,
      shapes: symbol.shapes,
      active: symbol.active,
      sourceFilename: symbol.sourceFilename,
      sha256: symbol.sha256,
      updatedAt: symbol.updatedAt,
    };
  }

  /**
   * `org.<code>:<name>` (plan R3): the stated name, or the filename stem lower-cased with every
   * run outside `[a-z0-9]` turned into `-` and trimmed of `-`, cut so the key fits 64
   * characters. A stated name that does not fit is a 400; a stem that leaves nothing is a 400.
   */
  static symbolKeyOf(libraryCode: string, name: string | undefined, stem: string): string {
    const prefix = `org.${libraryCode}:`;
    const room = MAX_MIMIC_ORG_SYMBOL_KEY_CHARS - prefix.length;
    if (name) {
      if (name.length > room) throw new BadRequestException("The symbol name is too long for this library");
      return `${prefix}${name}`;
    }
    const derived = stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, room)
      .replace(/-+$/, "");
    if (derived === "") throw new BadRequestException("The file name gives no symbol name; state a name");
    return `${prefix}${derived}`;
  }

  /**
   * An uploaded symbol's label: the stated one, else the filename stem, else the key's name, cut
   * at 64 UTF-16 units on a **code-point boundary**. A bare `.slice(0, 64)` could split a
   * surrogate pair, and node-postgres would store the lone half as U+FFFD; a 64-code-point cut
   * would overflow the PATCH schema's `.max(64)`, so an unchanged label could not be sent back.
   */
  static labelOf(label: string | undefined, stem: string, key: string): string {
    let out = "";
    for (const char of label || stem || key.slice(key.indexOf(":") + 1)) {
      if (out.length + char.length > 64) break;
      out += char;
    }
    return out;
  }

  /**
   * Maps a database refusal by its **constraint name**, never its detail (row security
   * suppresses it). Nothing the caller sent is echoed.
   */
  static translateWriteError(err: unknown): unknown {
    const pg = err as { constraint?: string; cause?: { constraint?: string } } | null;
    const constraint = pg?.constraint ?? pg?.cause?.constraint;
    if (constraint === "mimic_org_symbol_libraries_organization_code_key") {
      return new ConflictException("A library with this code already exists in this organization");
    }
    if (constraint === "mimic_org_symbols_organization_key_key") {
      return new ConflictException("A symbol with this name already exists in this organization");
    }
    return err;
  }
}
