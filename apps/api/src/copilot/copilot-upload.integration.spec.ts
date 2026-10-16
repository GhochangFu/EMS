import { createHash } from "node:crypto";

import type { ExecutionContext } from "@nestjs/common";
import type pg from "pg";
import { defer, from, lastValueFrom, mergeMap } from "rxjs";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry, COPILOT_CHANGE_HEADER, hashExcludedKeysFor } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { MimicSymbolLibrariesController } from "../mimic-symbol-libraries/mimic-symbol-libraries.controller";
import { bodyHash } from "./body-hash";
import type { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import type { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { copilotContext } from "./copilot-request-context";
import { CopilotUploadChangeInterceptor } from "./copilot-upload-change.interceptor";
import { prepareUpload } from "./copilot-upload-prepare";

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan §8.3 D12) — a `mimicSymbol.upload`
 * card on a real database, confirmed as the browser sends it: a multipart
 * request through the real global `CopilotChangeInterceptor`, then (as multer
 * would leave it) the real route stage `CopilotUploadChangeInterceptor`, then
 * the real controller and service.
 *
 * - Bytes that differ from the stored `fileSha256` → 409, and the row is
 *   `pending` again (re-confirmable).
 * - A Confirm against another library's `:id` → 409 from the global stage's
 *   path compare, and the row is `pending`.
 * - The stored text → 201, the row `applied`, the symbol row's `sha256` is
 *   the card's `fileSha256`, and the audit row carries `via` and the change id.
 *
 * The 201 is what the plan calls the DI proof; constructed here by hand, it
 * proves the two stages and the controller agree on one real database. The
 * route stage has no constructor, so the Nest module graph adds nothing it
 * could fail to resolve — the booted API's first upload Confirm (step 6) is
 * the HTTP proof. Assertions here; the `.test` sibling owns the database.
 */
export interface UploadConfirmCtx {
  readonly superPool: pg.Pool;
  readonly controller: MimicSymbolLibrariesController;
  readonly pending: CopilotPendingChangesService;
  readonly interceptor: CopilotChangeInterceptor;
  readonly jwt: JwtPayload;
  readonly identity: ResolvedIdentity;
  readonly organizationId: string;
  /** A conversation of the caller in the organization, one per case. */
  newConversation(): Promise<string>;
  /** An organization library created for this run (tracked for cleanup). */
  newLibrary(suffix: string): Promise<string>;
}

/** An SVG the symbol parser takes; `r` varies the bytes. */
export function symbolSvg(r = 8): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="${r}"/></svg>`;
}

/** The card a turn stores for the model's body, prepared and hashed as `copilot-propose-tools.ts` does. */
async function storeCard(ctx: UploadConfirmCtx, libraryId: string, name: string): Promise<{ changeId: string; body: Record<string, unknown> }> {
  const entry = catalogEntry("mimicSymbol.upload");
  if (!entry) throw new Error("F3.87: the catalog has no mimicSymbol.upload entry");
  const prepared = prepareUpload(entry, { name, label: `Symbol ${name}`, svg: { kind: "text", text: symbolSvg() } });
  if (!prepared.ok) throw new Error(`F3.87: ${prepared.error}`);
  const change = await ctx.pending.propose(ctx.identity.id, {
    conversationId: await ctx.newConversation(),
    organizationId: ctx.organizationId,
    catalogId: entry.id,
    method: "POST",
    path: `/api/v1/mimic-symbol-libraries/${libraryId}/symbols`,
    body: prepared.body,
    bodyHash: bodyHash(prepared.body, hashExcludedKeysFor(entry.id)),
    summary: `Upload the symbol ${name}.`,
    risk: "create",
  });
  if (change === null) throw new Error("F3.87: the card was not stored");
  return { changeId: change.id, body: prepared.body };
}

/** The multipart Confirm through both stages and the controller; resolves to the response or the thrown error. */
async function confirm(ctx: UploadConfirmCtx, changeId: string, libraryId: string, fields: Record<string, string>, file: { originalname: string; buffer: Buffer }) {
  const path = `/api/v1/mimic-symbol-libraries/${libraryId}/symbols`;
  const req = {
    method: "POST",
    path,
    originalUrl: path,
    headers: { [COPILOT_CHANGE_HEADER.toLowerCase()]: changeId, "content-type": "multipart/form-data; boundary=----f387" },
    // What multer leaves on the request once it has parsed the form.
    body: fields,
    file: { ...file, mimetype: "image/svg+xml" },
    user: ctx.jwt,
  };
  const handler = MimicSymbolLibrariesController.prototype.uploadSymbol;
  const context = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  const routeStage = new CopilotUploadChangeInterceptor();
  const route = { handle: () => defer(() => from(ctx.controller.uploadSymbol(libraryId, req.file, req.body, ctx.jwt))) };
  const next = { handle: () => from(routeStage.intercept(context, route)).pipe(mergeMap((inner) => inner)) };
  return copilotContext.run({ change: null }, async () => {
    try {
      return { ok: true as const, value: await lastValueFrom(await ctx.interceptor.intercept(context, next)) };
    } catch (err) {
      return { ok: false as const, error: err as { getStatus?: () => number } };
    }
  });
}

async function rowOf(ctx: UploadConfirmCtx, changeId: string): Promise<{ status: string; result_status: number | null }> {
  const { rows } = await ctx.superPool.query<{ status: string; result_status: number | null }>(
    "SELECT status, result_status FROM bms.copilot_pending_changes WHERE id = $1",
    [changeId],
  );
  if (!rows[0]) throw new Error(`F3.87: no pending change ${changeId}`);
  return rows[0];
}

/** The stored fields the browser sends (every key but the file's name, its hash and the card-only text). */
function fieldsOf(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["name", "label", "group"]) if (typeof body[key] === "string") out[key] = body[key] as string;
  return out;
}

/** Bytes that differ from the card's `fileSha256`: 409 from the route stage, and the row is `pending` again. */
export async function changedBytesAre409AndTheRowStaysPending(ctx: UploadConfirmCtx): Promise<void> {
  const libraryId = await ctx.newLibrary("bytes");
  const { changeId, body } = await storeCard(ctx, libraryId, "bytes");
  const answer = await confirm(ctx, changeId, libraryId, fieldsOf(body), {
    originalname: body.filename as string,
    buffer: Buffer.from(symbolSvg(9), "utf8"),
  });
  expect(answer.ok ? 201 : answer.error.getStatus?.()).toBe(409);
  expect(await rowOf(ctx, changeId)).toEqual({ status: "pending", result_status: null });
}

/** A Confirm against another library's `:id`: 409 from the global stage's path compare, and the row is `pending`. */
export async function anotherLibrarysIdIs409AndTheRowStaysPending(ctx: UploadConfirmCtx): Promise<void> {
  const libraryId = await ctx.newLibrary("own");
  const otherId = await ctx.newLibrary("other");
  const { changeId, body } = await storeCard(ctx, libraryId, "other");
  const answer = await confirm(ctx, changeId, otherId, fieldsOf(body), {
    originalname: body.filename as string,
    buffer: Buffer.from(body.svgText as string, "utf8"),
  });
  expect(answer.ok ? 201 : answer.error.getStatus?.()).toBe(409);
  expect(await rowOf(ctx, changeId)).toEqual({ status: "pending", result_status: null });
  const { rows } = await ctx.superPool.query("SELECT 1 FROM bms.mimic_org_symbols WHERE library_id = $1", [otherId]);
  expect(rows).toEqual([]);
}

/**
 * The stored text: 201, the row `applied` with 201, the symbol row's `sha256` is the card's
 * `fileSha256`, and the audit row carries `via: "copilot"` and the change id.
 */
export async function theStoredTextApplies(ctx: UploadConfirmCtx): Promise<void> {
  const libraryId = await ctx.newLibrary("applies");
  const { changeId, body } = await storeCard(ctx, libraryId, "applies");
  const buffer = Buffer.from(body.svgText as string, "utf8");
  expect(createHash("sha256").update(buffer).digest("hex")).toBe(body.fileSha256);
  const answer = await confirm(ctx, changeId, libraryId, fieldsOf(body), { originalname: body.filename as string, buffer });
  expect(answer.ok ? null : answer.error).toBeNull();
  const symbolId = answer.ok ? (answer.value as { id: string }).id : "";
  expect(await rowOf(ctx, changeId)).toEqual({ status: "applied", result_status: 201 });
  const symbol = await ctx.superPool.query<{ sha256: string; key: string }>("SELECT sha256, key FROM bms.mimic_org_symbols WHERE id = $1", [symbolId]);
  // The service stores an organization symbol's key as `org.<libraryCode>:<name>`.
  expect(symbol.rows[0]).toEqual({ sha256: body.fileSha256, key: expect.stringMatching(/^org\.[^:]+:applies$/) });
  const audit = await ctx.superPool.query<{ via: string | null; change_id: string | null }>(
    "SELECT payload->>'via' AS via, payload->>'changeId' AS change_id FROM bms.audit_log WHERE entity_id = $1 AND action = 'master.mimic_org_symbol.create'",
    [symbolId],
  );
  expect(audit.rows).toEqual([{ via: "copilot", change_id: changeId }]);
}
