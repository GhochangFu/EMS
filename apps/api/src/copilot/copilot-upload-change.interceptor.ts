import { createHash } from "node:crypto";

import { type CallHandler, ConflictException, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";

import { COPILOT_CHANGE_REFUSED_MESSAGE, hashExcludedKeysFor } from "@bms/shared/copilot";

import { decodeMulterFilename } from "../assets/multer-filename";
import { bodyHash } from "./body-hash";
import { copilotContext } from "./copilot-request-context";

/** The header, lower-cased as Node delivers it. */
const HEADER = "x-copilot-change";

/** The multipart text fields an upload entry hashes, as the browser sends them (`group` only when present). */
const UPLOAD_FIELDS = ["name", "label", "group"] as const;

type UploadRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  file?: { originalname: string; buffer: Buffer };
};

/**
 * The body a multipart Confirm hashes: the text fields the request carries,
 * the decoded filename and the SHA-256 of the file's bytes — the same keys the
 * propose step stored (`copilot-upload-prepare.ts`). A missing file hashes as
 * an empty file, which never matches a stored hash.
 */
export function uploadBodyOf(req: UploadRequest): Record<string, unknown> {
  const fields = (req.body ?? {}) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const key of UPLOAD_FIELDS) if (typeof fields[key] === "string") body[key] = fields[key];
  body.filename = req.file ? decodeMulterFilename(req.file.originalname) : "";
  body.fileSha256 = createHash("sha256").update(req.file?.buffer ?? Buffer.alloc(0)).digest("hex");
  return body;
}

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan D12) — the route stage of a
 * multipart Confirm. Declared after `FileInterceptor` on the one upload
 * handler, so multer has parsed the fields and the file. **No constructor and
 * no injected dependency**: a route interceptor resolves its dependencies in
 * the controller's module, which cannot import `CopilotModule`; the global
 * stage leaves a `release` closure on the request store instead.
 *
 * - No `X-Copilot-Change` header: a manual upload, passed through.
 * - The header without a claim on the store: fail closed, 409.
 * - A hash that differs from the claim: the claim is released (the row is
 *   `pending` again) and 409.
 * - A match: the store is marked, so the audit row carries `via: "copilot"`.
 */
@Injectable()
export class CopilotUploadChangeInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<UploadRequest>();
    if (req.headers[HEADER] === undefined) return next.handle();
    const store = copilotContext.getStore();
    const claim = store?.uploadClaim;
    if (store === undefined || claim === undefined) throw new ConflictException(COPILOT_CHANGE_REFUSED_MESSAGE);
    if (bodyHash(uploadBodyOf(req), hashExcludedKeysFor(claim.catalogId)) !== claim.bodyHash) {
      if (!claim.released) {
        claim.released = true;
        await claim.release();
      }
      throw new ConflictException(COPILOT_CHANGE_REFUSED_MESSAGE);
    }
    store.change = { via: "copilot", changeId: claim.changeId };
    claim.compared = true;
    return next.handle();
  }
}
