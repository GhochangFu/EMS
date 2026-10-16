import { SetMetadata } from "@nestjs/common";

/** `F3.87` PR 6a — the metadata key that marks a handler as a copilot multipart Confirm target. */
export const COPILOT_UPLOAD_ROUTE = "copilot:upload-route";

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan D12) — marks the one handler a
 * catalog `upload` entry's Confirm may reach. The global
 * `CopilotChangeInterceptor` refuses a multipart Confirm to any handler
 * without it, before any claim; the handler must also carry
 * `CopilotUploadChangeInterceptor` after its `FileInterceptor`
 * (`tests/f3.87-upload-entries-guarded.test.ts`).
 */
export const CopilotUploadRoute = (): MethodDecorator & ClassDecorator => SetMetadata(COPILOT_UPLOAD_ROUTE, true);
