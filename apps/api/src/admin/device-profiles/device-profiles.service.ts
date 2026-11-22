import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z, type ZodError } from "zod";

import { deviceProfiles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  copyDeviceProfileBodySchema,
  createDeviceProfileBodySchema,
  deviceProfileCodeSchema,
  importStockDeviceProfileBodySchema,
  listDeviceProfilesQuerySchema,
  saveDeviceProfileVersionBodySchema,
} from "@bms/shared";
import type {
  DeviceProfile,
  DeviceProfileDto,
  DeviceProfileList,
  JwtPayload,
  ModbusRegister,
  StockDeviceProfileList,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { constraintOf, translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";

/**
 * `F1.2` — the stock Modbus profiles, injected so a test can hand the service
 * a list the repository does not ship (the `asset-templates.tokens.ts`
 * reason): the peer-edit import property needs an entry, and the shipped list
 * is empty until plan PR 9. `admin.module.ts` provides `STOCK_MODBUS_PROFILES`.
 */
export const STOCK_DEVICE_PROFILES_TOKEN = Symbol("STOCK_DEVICE_PROFILES");

/** The one protocol a profile has in v1 (the table's CHECK). */
const PROTOCOL = "modbus_tcp";

export const WRITE_ROLE_MESSAGE =
  "Device profiles are written by the global admin or an organization admin of the profile's organization";
/** One 404 for a missing row and a row of an organization the caller may not reach: it names neither. */
export const PROFILE_NOT_FOUND_MESSAGE = "Device profile not found";
export const ORGANIZATION_NOT_FOUND_MESSAGE = "Organization not found";
export const STOCK_PROFILE_NOT_FOUND_MESSAGE = "Stock device profile not found";
export const STALE_BASE_MESSAGE =
  "This profile has a newer version than the one you edited; reload it and make your change again";

const idSchema = z.string().uuid();

type ProfileRow = typeof deviceProfiles.$inferSelect;

/**
 * `F1.2` (ADR 0141 decisions 12–14, Amendment 2 (b); plan T5.2, C11) — an
 * organization's Modbus device profiles, `bms.device_profiles`.
 *
 * **Append-only.** Every save is a new row at `max(version) + 1` and no row is
 * ever updated or deleted (P2): the table grants `bms_tenant` SELECT and
 * INSERT only (migration `0164`), so this service issues neither. A save
 * names the version it was edited from (`baseVersion`); a base that is not the
 * newest is a 409, and two saves racing from the same base are settled by the
 * unique key `(organization_id, protocol, code, version)` — the loser's
 * INSERT raises `23505`, answered 409. Never `SELECT … FOR UPDATE`, which
 * needs UPDATE.
 *
 * **`verified` (P2).** A create, an edit and a copy write `false`; only an
 * import copies the stock file's value. `created_by` is the caller's
 * `bms.users` id, never a body field.
 *
 * **Pools.** Rows are read and written on the tenant pool inside
 * `withTenant(organizationId)`, so FORCE RLS bounds every statement. The one
 * fleet read is `organizationOf`, which maps a `:id` to its organization and
 * nothing else, so the gate can run before the tenant transaction opens.
 *
 * **Gates (403 → 400 → 404 → 409, §4.7).** The role gate runs before any body
 * is parsed. Reads are any master-data user's who may manage the organization
 * (`canManageOrganization`, the asset-template read rule), so a location admin
 * binding an RTU can read its organization's profiles. Writes are the global
 * `admin` and an `organization_admin` with a direct grant on the organization
 * (`isOrganizationLevelAdmin`, the gate ADR 0141 Amendment 1 (c) names for the
 * organization's poll interval): a role outside those two is 403 before the
 * body; an organization the caller may not reach is the same 404 as a missing
 * one.
 *
 * **Stock import** copies from the repository list, never from a peer
 * organization's row of the same code (`asset-templates-stock.service.ts`).
 *
 * **Audit (§9.6).** Every write audits on its own transaction with the
 * organization id, the code, the version and the register count — never the
 * register list.
 */
@Injectable()
export class DeviceProfilesAdminService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    @Inject(STOCK_DEVICE_PROFILES_TOKEN) private readonly stock: readonly DeviceProfile[],
  ) {}

  /** Every version of every profile of one organization, by code, newest version first. */
  async list(jwt: JwtPayload, query: unknown): Promise<DeviceProfileList> {
    await this.accessControl.requireMasterDataUser(jwt);
    const { organizationId } = parseBody(listDeviceProfilesQuerySchema.safeParse(query));
    await this.assertReadable(jwt, organizationId, ORGANIZATION_NOT_FOUND_MESSAGE);
    const rows = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select()
        .from(deviceProfiles)
        .where(eq(deviceProfiles.organizationId, organizationId))
        .orderBy(asc(deviceProfiles.code), desc(deviceProfiles.version)),
    );
    return rows.map(toDeviceProfileDto);
  }

  async getById(jwt: JwtPayload, id: string): Promise<DeviceProfileDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const profileId = parseId(id);
    const organizationId = await this.organizationOf(profileId);
    await this.assertReadable(jwt, organizationId, PROFILE_NOT_FOUND_MESSAGE);
    return toDeviceProfileDto(
      await withTenant(this.tenantDb, organizationId, (tx) => readRow(tx, profileId)),
    );
  }

  /** A new profile at version 1, `verified: false`. A code the organization holds is a 409. */
  async create(jwt: JwtPayload, input: unknown): Promise<DeviceProfileDto> {
    const userId = await this.requireWriter(jwt);
    const body = parseBody(createDeviceProfileBodySchema.safeParse(input));
    await this.assertWritable(jwt, body.organizationId, ORGANIZATION_NOT_FOUND_MESSAGE);
    return this.insert(jwt, body.organizationId, {
      action: "master.device_profile.create",
      values: {
        code: body.code,
        version: 1,
        vendor: body.vendor,
        model: body.model,
        source: body.source,
        verified: false,
        registers: body.registers,
        stockCode: null,
        stockVersion: null,
        createdBy: userId,
      },
      payload: {},
      onUnique: () => new ConflictException(`A device profile with code "${body.code}" already exists`),
    });
  }

  /**
   * The next version of `:id`'s code, from the version the editor was opened
   * on. A stale base is a 409 before the INSERT; a race from the same base is
   * the unique key's 409.
   */
  async saveVersion(jwt: JwtPayload, id: string, input: unknown): Promise<DeviceProfileDto> {
    const userId = await this.requireWriter(jwt);
    const profileId = parseId(id);
    const body = parseBody(saveDeviceProfileVersionBodySchema.safeParse(input));
    const organizationId = await this.organizationOf(profileId);
    await this.assertWritable(jwt, organizationId, PROFILE_NOT_FOUND_MESSAGE);
    return this.insert(jwt, organizationId, {
      action: "master.device_profile.save_version",
      values: async (tx) => {
        const base = await readRow(tx, profileId);
        const newest = await newestVersion(tx, organizationId, base.code);
        if (body.baseVersion !== newest) {
          throw new ConflictException(STALE_BASE_MESSAGE);
        }
        return {
          code: base.code,
          version: newest + 1,
          vendor: body.vendor,
          model: body.model,
          source: body.source,
          verified: false,
          registers: body.registers,
          stockCode: null,
          stockVersion: null,
          createdBy: userId,
        };
      },
      payload: { baseVersion: body.baseVersion },
      onUnique: () => new ConflictException(STALE_BASE_MESSAGE),
    });
  }

  /** `:id`'s row under a new code at version 1, in the same organization, `verified: false`. */
  async copy(jwt: JwtPayload, id: string, input: unknown): Promise<DeviceProfileDto> {
    const userId = await this.requireWriter(jwt);
    const profileId = parseId(id);
    const body = parseBody(copyDeviceProfileBodySchema.safeParse(input));
    const organizationId = await this.organizationOf(profileId);
    await this.assertWritable(jwt, organizationId, PROFILE_NOT_FOUND_MESSAGE);
    let copiedFrom: { code: string; version: number } | null = null;
    return this.insert(jwt, organizationId, {
      action: "master.device_profile.copy",
      values: async (tx) => {
        const from = await readRow(tx, profileId);
        copiedFrom = { code: from.code, version: from.version };
        return {
          code: body.code,
          version: 1,
          vendor: from.vendor,
          model: from.model,
          source: from.source as DeviceProfile["source"],
          verified: false,
          registers: from.registers as ModbusRegister[],
          stockCode: null,
          stockVersion: null,
          createdBy: userId,
        };
      },
      payload: () => ({ copiedFrom }),
      onUnique: () => new ConflictException(`A device profile with code "${body.code}" already exists`),
    });
  }

  /** What the repository ships. Reads no database. */
  async listStock(jwt: JwtPayload): Promise<StockDeviceProfileList> {
    await this.accessControl.requireMasterDataUser(jwt);
    return this.stock.map((entry) => ({ ...entry }));
  }

  /**
   * One stock profile into an organization, at `max(version) + 1` of its code
   * (1 for a code it does not hold), carrying the file's `verified` and
   * stamped with the file's code and version. The registers come from the
   * repository list, never from another organization's row.
   */
  async importStock(jwt: JwtPayload, code: string, input: unknown): Promise<DeviceProfileDto> {
    const userId = await this.requireWriter(jwt);
    const stockCode = parseStockCode(code);
    const body = parseBody(importStockDeviceProfileBodySchema.safeParse(input));
    // The organization before the code, so a caller outside it learns nothing of the list.
    await this.assertWritable(jwt, body.organizationId, ORGANIZATION_NOT_FOUND_MESSAGE);
    const entry = this.stock.find((candidate) => candidate.code === stockCode);
    if (!entry) {
      throw new NotFoundException(STOCK_PROFILE_NOT_FOUND_MESSAGE);
    }
    return this.insert(jwt, body.organizationId, {
      action: "master.device_profile.import",
      values: async (tx) => ({
        code: entry.code,
        version: (await newestVersion(tx, body.organizationId, entry.code)) + 1,
        vendor: entry.vendor,
        model: entry.model,
        source: entry.source,
        verified: entry.verified,
        registers: entry.registers,
        stockCode: entry.code,
        stockVersion: entry.version,
        createdBy: userId,
      }),
      payload: { stockCode: entry.code, stockVersion: entry.version },
      onUnique: () =>
        new ConflictException(`Another import or save of "${entry.code}" landed first; reload and try again`),
    });
  }

  /**
   * The one INSERT every write goes through, on the tenant pool inside
   * `withTenant`, with its audit row on the same transaction. A row is never
   * updated (P2, migration `0164`'s REVOKE).
   */
  private async insert(
    jwt: JwtPayload,
    organizationId: string,
    write: {
      action: string;
      values: NewProfile | ((tx: BmsTx) => Promise<NewProfile>);
      payload: Record<string, unknown> | (() => Record<string, unknown>);
      onUnique: () => Error;
    },
  ): Promise<DeviceProfileDto> {
    const row = await translateConstraintErrors(
      () =>
        withTenant(this.tenantDb, organizationId, async (tx) => {
          const values = typeof write.values === "function" ? await write.values(tx) : write.values;
          const [inserted] = await tx
            .insert(deviceProfiles)
            .values({ ...values, organizationId, protocol: PROTOCOL })
            .returning();
          if (!inserted) {
            throw new Error("F1.2: the device profile insert returned no row");
          }
          const extra = typeof write.payload === "function" ? write.payload() : write.payload;
          await this.audit.write(
            {
              actor: jwt,
              action: write.action,
              entityType: "device_profile",
              entityId: inserted.id,
              organizationId,
              // The code, version and count — never the register list (§9.6).
              payload: {
                ...extra,
                code: inserted.code,
                version: inserted.version,
                verified: inserted.verified,
                registerCount: values.registers.length,
              },
            },
            tx,
          );
          return inserted;
        }),
      {
        onUnique: (err) =>
          constraintOf(err) === "device_profiles_org_protocol_code_version_key" ? write.onUnique() : (err as Error),
        onForeignKey: () => new NotFoundException(ORGANIZATION_NOT_FOUND_MESSAGE),
      },
    );
    return toDeviceProfileDto(row);
  }

  /** The global admin or an organization admin, by the `bms.users` role; returns the user id for `created_by`. */
  private async requireWriter(jwt: JwtPayload): Promise<string> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException(WRITE_ROLE_MESSAGE);
    }
    return user.id;
  }

  private async assertWritable(jwt: JwtPayload, organizationId: string, message: string): Promise<void> {
    if (!(await this.accessControl.isOrganizationLevelAdmin(jwt, organizationId))) {
      throw new NotFoundException(message);
    }
  }

  private async assertReadable(jwt: JwtPayload, organizationId: string, message: string): Promise<void> {
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new NotFoundException(message);
    }
  }

  /**
   * The organization of a profile row, read on the fleet pool because the
   * tenant transaction cannot open before it is known. Reads the one column;
   * the row itself is read again under `withTenant`.
   */
  private async organizationOf(id: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: deviceProfiles.organizationId })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(PROFILE_NOT_FOUND_MESSAGE);
    }
    return row.organizationId;
  }
}

/** What a write supplies; the organization and the protocol are the service's. */
type NewProfile = {
  code: string;
  version: number;
  vendor: string;
  model: string;
  source: DeviceProfile["source"];
  verified: boolean;
  registers: ModbusRegister[];
  stockCode: string | null;
  stockVersion: number | null;
  createdBy: string;
};

async function readRow(tx: BmsTx, id: string): Promise<ProfileRow> {
  const [row] = await tx.select().from(deviceProfiles).where(eq(deviceProfiles.id, id)).limit(1);
  if (!row) {
    throw new NotFoundException(PROFILE_NOT_FOUND_MESSAGE);
  }
  return row;
}

/** The newest version of `code` in the organization, `0` when it holds none. */
async function newestVersion(tx: BmsTx, organizationId: string, code: string): Promise<number> {
  const [row] = await tx
    .select({ newest: sql<number | null>`max(${deviceProfiles.version})` })
    .from(deviceProfiles)
    .where(
      and(
        eq(deviceProfiles.organizationId, organizationId),
        eq(deviceProfiles.protocol, PROTOCOL),
        eq(deviceProfiles.code, code),
      ),
    );
  return Number(row?.newest ?? 0);
}

/** A row as the wire carries it. `source` and `registers` were parsed by the shared schemas before every write. */
export function toDeviceProfileDto(row: ProfileRow): DeviceProfileDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    protocol: PROTOCOL,
    code: row.code,
    version: row.version,
    vendor: row.vendor,
    model: row.model,
    source: row.source as DeviceProfileDto["source"],
    verified: row.verified,
    registers: row.registers as DeviceProfileDto["registers"],
    stockCode: row.stockCode,
    stockVersion: row.stockVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    throw new BadRequestException("Not a device profile id");
  }
  return parsed.data;
}

function parseStockCode(code: string): string {
  const parsed = deviceProfileCodeSchema.safeParse(code);
  if (!parsed.success) {
    throw new BadRequestException("Not a device profile code");
  }
  return parsed.data;
}

/** A refused body or query is a 400 with the flattened issues (the payload-formats idiom). */
function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
