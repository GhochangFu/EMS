import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ZodError } from "zod";

import { mqttPayloadFormats } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  createMqttPayloadFormatBodySchema,
  decodeMqttPayload,
  mqttPayloadFormatCodeSchema,
  testMqttPayloadFormatBodySchema,
  updateMqttPayloadFormatBodySchema,
} from "@bms/shared";
import type {
  DeleteMqttPayloadFormatConflict,
  IfMatch,
  JwtPayload,
  MqttPayloadFormatDefinition,
  MqttPayloadFormatDto,
  MqttPayloadFormatsListResponse,
  TestMqttPayloadFormatResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { noRowWritten, updatedAtMatches } from "../../common/if-match";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";

type FormatRow = typeof mqttPayloadFormats.$inferSelect;

/** The fixed 409 for a write to the built-in row (ADR 0116 decision 2). */
export const BUILTIN_FORMAT_EDIT_MESSAGE = "a built-in format cannot be edited";
export const BUILTIN_FORMAT_DELETE_MESSAGE = "a built-in format cannot be deleted";
/** The fixed 409 message for a format still in use (ruling Q5). */
export const FORMAT_IN_USE_MESSAGE = "This payload format is in use and cannot be deleted";

/**
 * `F4.334` / ADR 0116 decision 5 — the MQTT payload format catalog
 * (`bms.mqtt_payload_formats`), managed by the global admin.
 *
 * **Why `fleetDb` only.** A platform catalog: no `organization_id`, no RLS,
 * and `bms_tenant` holds no write on it (migration `0130`). Every write runs on
 * `bms_fleet` in one transaction with its audit row, `organizationId: null` —
 * the `PointKeyStatesAdminService` shape.
 *
 * **Gates (plan R5, ruling Q4).** Reads (`list`, `getByCode`) are any
 * master-data user's: the onboarding drawer's format select is used by an
 * `organization_admin`. Writes and `test` are the global admin's
 * (`assertAdminRole` on the `bms.users` role), checked before the body is
 * parsed so a tenant learns nothing of a write it may not make.
 *
 * **Nothing here logs a sample or a definition** (§9.6, ADR 0116 decision 5):
 * the test route decodes and answers; the audit rows name codes and fields.
 */
@Injectable()
export class MqttPayloadFormatsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Every format, built-in first, then by code. */
  async list(jwt: JwtPayload): Promise<MqttPayloadFormatsListResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const rows = await this.fleetDb
      .select()
      .from(mqttPayloadFormats)
      .orderBy(sql`${mqttPayloadFormats.builtin} DESC`, asc(mqttPayloadFormats.code));
    return rows.map(mapRow);
  }

  async getByCode(jwt: JwtPayload, code: string): Promise<MqttPayloadFormatDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    return mapRow(await this.fetchRow(parseCode(code)));
  }

  async create(jwt: JwtPayload, input: unknown): Promise<MqttPayloadFormatDto> {
    const userId = await this.requireGlobalAdmin(jwt);
    const body = parseBody(createMqttPayloadFormatBodySchema.safeParse(input));
    const created = await translateConstraintErrors(
      () =>
        this.fleetDb.transaction(async (tx) => {
          const [row] = await tx
            .insert(mqttPayloadFormats)
            .values({
              code: body.code,
              name: body.name,
              description: body.description ?? "",
              definition: body.definition,
              builtin: false,
              updatedBy: userId,
            })
            .returning();
          await this.audit.write(
            {
              actor: jwt,
              action: "master.mqtt_payload_format.create",
              entityType: "mqtt_payload_format",
              entityId: row!.id,
              organizationId: null,
              // Code and name only — never the definition (plan T3.1 I1).
              payload: { code: body.code, name: body.name },
            },
            tx,
          );
          return row!;
        }),
      { onUnique: () => new ConflictException(`A payload format with code "${body.code}" already exists`) },
    );
    return mapRow(created);
  }

  /** `ifMatch` (Amendment 17 decision 1): the row's `updatedAt` the copilot card showed; a mismatch is 412. */
  async update(jwt: JwtPayload, code: string, input: unknown, ifMatch?: IfMatch): Promise<MqttPayloadFormatDto> {
    const userId = await this.requireGlobalAdmin(jwt);
    const key = parseCode(code);
    const body = parseBody(updateMqttPayloadFormatBodySchema.safeParse(input));
    const fields = Object.keys(body).filter((field) => (body as Record<string, unknown>)[field] !== undefined);
    if (fields.length === 0) {
      throw new BadRequestException("Name a name, a description or a definition to change");
    }
    const current = await this.fetchRow(key);
    if (current.builtin) {
      throw new ConflictException(BUILTIN_FORMAT_EDIT_MESSAGE);
    }
    const updated = await this.fleetDb.transaction(async (tx) => {
      const [row] = await tx
        .update(mqttPayloadFormats)
        .set({ ...body, updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            sql`${mqttPayloadFormats.code} = ${key} AND ${mqttPayloadFormats.builtin} = false`,
            updatedAtMatches(mqttPayloadFormats.updatedAt, ifMatch),
          ),
        )
        .returning();
      if (!row) {
        throw noRowWritten(ifMatch, "Payload format not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.mqtt_payload_format.update",
          entityType: "mqtt_payload_format",
          entityId: row.id,
          organizationId: null,
          payload: { code: key, fields },
        },
        tx,
      );
      return row;
    });
    return mapRow(updated);
  }

  /** Deletes a format no RTU and no open draft names; otherwise 409 listing them (ruling Q5). */
  async remove(jwt: JwtPayload, code: string): Promise<void> {
    await this.requireGlobalAdmin(jwt);
    const key = parseCode(code);
    const current = await this.fetchRow(key);
    if (current.builtin) {
      throw new ConflictException(BUILTIN_FORMAT_DELETE_MESSAGE);
    }
    const usage = await this.usage(key);
    if (usage.rtus.length > 0 || usage.drafts.length > 0) {
      const conflict: DeleteMqttPayloadFormatConflict = { message: FORMAT_IN_USE_MESSAGE, ...usage };
      throw new ConflictException(conflict);
    }
    await this.fleetDb.transaction(async (tx) => {
      const [row] = await tx
        .delete(mqttPayloadFormats)
        .where(sql`${mqttPayloadFormats.code} = ${key} AND ${mqttPayloadFormats.builtin} = false`)
        .returning();
      if (!row) {
        throw new NotFoundException("Payload format not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.mqtt_payload_format.delete",
          entityType: "mqtt_payload_format",
          entityId: row.id,
          organizationId: null,
          payload: { code: row.code, name: row.name },
        },
        tx,
      );
    });
  }

  /**
   * Decodes a pasted sample against a definition and stores nothing (ADR 0116
   * decision 5). No audit row and no log line: the sample is telemetry the
   * admin pasted, and it goes back only in the response.
   */
  async test(jwt: JwtPayload, input: unknown): Promise<TestMqttPayloadFormatResponse> {
    await this.requireGlobalAdmin(jwt);
    const body = parseBody(testMqttPayloadFormatBodySchema.safeParse(input));
    return testResponse(decodeMqttPayload(body.definition, body.topic, body.sample));
  }

  /** The RTUs and open drafts that name `code`, on the fleet pool (it reads every organization). */
  private async usage(code: string): Promise<Omit<DeleteMqttPayloadFormatConflict, "message">> {
    const rtuResult = await this.fleetDb.execute(sql`
      SELECT coalesce(r.rtu_code, r.code) AS rtu_code, o.code AS organization_code
        FROM bms.rtu_connection_configs c
        INNER JOIN bms.rtus r ON r.id = c.rtu_id
        INNER JOIN bms.organizations o ON o.id = r.organization_id
       WHERE c.config->>'payloadFormat' = ${code}
       ORDER BY o.code, 1`);
    const draftResult = await this.fleetDb.execute(sql`
      SELECT s.id AS session_id, o.code AS organization_code
        FROM bms.onboarding_sessions s
        INNER JOIN bms.organizations o ON o.id = s.organization_id
       WHERE s.status = 'draft'
         AND jsonb_path_exists(
               s.draft,
               '$.rtus[*].config.payloadFormat ? (@ == $code)',
               jsonb_build_object('code', ${code}::text))
       ORDER BY o.code, s.id`);
    const rtuRows = rowsOf<{ rtu_code: string; organization_code: string }>(rtuResult);
    const draftRows = rowsOf<{ session_id: string; organization_code: string }>(draftResult);
    return {
      rtus: rtuRows.map((row) => ({ rtuCode: row.rtu_code, organizationCode: row.organization_code })),
      drafts: draftRows.map((row) => ({ sessionId: row.session_id, organizationCode: row.organization_code })),
    };
  }

  /** Global admin, by the `bms.users` role; returns the user id for `updated_by`. */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<string> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);
    return user.id;
  }

  private async fetchRow(code: string): Promise<FormatRow> {
    const [row] = await this.fleetDb
      .select()
      .from(mqttPayloadFormats)
      .where(eq(mqttPayloadFormats.code, code))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Payload format not found");
    }
    return row;
  }
}

function mapRow(row: FormatRow): MqttPayloadFormatDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    // Written only through `create`/`update`, which parse it with the shared schema.
    definition: row.definition as MqttPayloadFormatDefinition,
    builtin: row.builtin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** A decoded value as the test response carries it: a finite number or `null`. */
function testValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Shapes a decode for the wire; exported for its unit spec. */
export function testResponse(decoded: ReturnType<typeof decodeMqttPayload>): TestMqttPayloadFormatResponse {
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason, records: [] };
  }
  return {
    ok: true,
    records: decoded.records.map((record) => ({
      deviceKey: record.deviceKey,
      at: record.at === undefined ? null : record.at.toISOString(),
      values: Object.fromEntries(Object.entries(record.values).map(([key, value]) => [key, testValue(value)])),
    })),
  };
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function parseCode(code: string): string {
  const parsed = mqttPayloadFormatCodeSchema.safeParse(code);
  if (!parsed.success) {
    throw new BadRequestException("Not a payload format code");
  }
  return parsed.data;
}

/** A refused body is a 400 with the flattened issues — the `PointKeyStatesAdminService` idiom. */
function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
