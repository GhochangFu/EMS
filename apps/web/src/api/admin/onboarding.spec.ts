import { expect, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import { downloadOnboardingTemplate, uploadOnboardingExcel } from "./onboarding";

/**
 * `F4.106` — the onboarding api client's two refusal paths.
 *
 * ## The environment question, settled by running it rather than by arguing it
 *
 * `api-error.ts` warns that importing a module which reads `import.meta.env` at
 * module scope drags Vite's environment into a node test, and this file imports
 * exactly such a module (`onboarding.ts`, and `client.ts` behind it). It
 * resolves: `apps/web/src/api/validate.test.ts` already does the same and
 * records the measured value `{ DEV: true, MODE: "test" }`. This suite was run
 * as a one-assertion smoke before the six claims were written, and the import
 * resolved with no DOM at all.
 *
 * `File` and `FormData` are Node 20 globals and the repo ships Node 20.
 * `document.createElement` and `URL.createObjectURL` are only reached on the
 * success path, which no case here takes.
 *
 * The auth assertions go through the real store, like `api/http.spec.ts`: a
 * mocked `clearSession` would assert that a function was called, not that the
 * token is gone.
 */

const TOKEN = "token-abc";

/** A session shaped like the one `POST /auth/login` writes. */
function signIn(): void {
  useAuthStore.getState().setSession(
    TOKEN,
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
    { kind: "global", locations: [], assetGroups: [], assetIds: [] },
  );
}

/** Every request in this file answers with one status and one body. */
function stubFetch(status: number, body: string): void {
  vi.stubGlobal("fetch", async () => new Response(body, { status }));
}

function workbook(): File {
  return new File(["x"], "estate.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * The message of a rejected call.
 *
 * It throws when the promise **resolves**, because "no error was thrown" would
 * otherwise pass every assertion below by never reaching them — the absence
 * shape this repository has been caught by.
 */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/**
 * A1 — a 401 from the upload clears the session.
 *
 * The gap this closes: both telemetry siblings have called
 * `clearSessionOnAuthFailure` since `F1.9`, and this path never did, so an
 * expired token survived here until some later `adminFetch` happened to notice.
 */
export async function aFourOhOneFromTheUploadClearsTheSession(): Promise<void> {
  signIn();
  stubFetch(401, '{"message":"Unauthorized","statusCode":401}');

  await rejectionMessage(uploadOnboardingExcel("s1", workbook()));

  expect(useAuthStore.getState().accessToken).toBeNull();
}

/**
 * A2 — a 403 from the upload KEEPS the session.
 *
 * `F4.52` narrowed `clearSessionOnAuthFailure` to 401 only, because 403 means
 * the user is known and merely not permitted; clearing there logs a valid
 * session out and takes whatever was typed with it. Adding the call to a new
 * path is where that narrowing would quietly be undone.
 */
export async function aFourOhThreeFromTheUploadKeepsTheSession(): Promise<void> {
  signIn();
  stubFetch(
    403,
    '{"message":"Onboarding is outside your access scope","error":"Forbidden","statusCode":403}',
  );

  await rejectionMessage(uploadOnboardingExcel("s1", workbook()));

  expect(useAuthStore.getState().accessToken).toBe(TOKEN);
  expect(useAuthStore.getState().user?.email).toBe("admin@bms.local");
}

/** A3 — a 401 from the template download clears the session (the same gap). */
export async function aFourOhOneFromTheTemplateDownloadClearsTheSession(): Promise<void> {
  signIn();
  stubFetch(401, "");

  await rejectionMessage(downloadOnboardingTemplate());

  expect(useAuthStore.getState().accessToken).toBeNull();
}

/**
 * A4 — an oversize upload rejects with the 5 MB sentence.
 *
 * The body is what the running stack returns: Nest maps multer's
 * `LIMIT_FILE_SIZE` to `PayloadTooLargeException`, so `File too large` is the
 * best an unwrapper alone could do and it names no limit.
 */
export async function anOversizeUploadNamesTheLimit(): Promise<void> {
  signIn();
  stubFetch(413, '{"message":"File too large","error":"Payload Too Large","statusCode":413}');

  expect(await rejectionMessage(uploadOnboardingExcel("s1", workbook()))).toBe(
    "File is too large — the limit is 5 MB.",
  );
}

/**
 * A5 — a refused upload rejects with the server's sentence, not its envelope.
 *
 * This is the one the wizard used to render whole. Equality rather than a
 * substring plus a leak loop: `===` excludes every leak already.
 */
export async function aRefusedUploadRejectsWithTheSentenceAlone(): Promise<void> {
  signIn();
  stubFetch(
    400,
    '{"message":"Workbook has no RTU sheet","error":"Bad Request","statusCode":400}',
  );

  expect(await rejectionMessage(uploadOnboardingExcel("s1", workbook()))).toBe(
    "Workbook has no RTU sheet",
  );
}

/**
 * A6 — a refused template download rejects with the server's sentence.
 *
 * The function discarded the body entirely and threw a bare status line, so a
 * scope refusal read as a download that "failed (403)" for no stated reason.
 */
export async function aRefusedTemplateDownloadRejectsWithTheSentence(): Promise<void> {
  signIn();
  stubFetch(
    403,
    '{"message":"Template is outside your access scope","error":"Forbidden","statusCode":403}',
  );

  expect(await rejectionMessage(downloadOnboardingTemplate())).toBe(
    "Template is outside your access scope",
  );
}

/**
 * A6b — a genuinely blank body still names the status.
 *
 * Split from A6 rather than left as its second half: the mutation that reddens
 * A6 leaves this true, so as one function it would have been a claim no
 * mutation reaches.
 */
export async function aBlankTemplateRefusalKeepsTheStatusLine(): Promise<void> {
  signIn();
  stubFetch(403, "");

  expect(await rejectionMessage(downloadOnboardingTemplate())).toBe(
    "Template download failed (403)",
  );
}
