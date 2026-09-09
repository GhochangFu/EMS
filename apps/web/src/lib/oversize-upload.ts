/**
 * The one sentence this app shows when an upload is refused as too large
 * (`F4.106` ruling 2).
 *
 * ## Why this is a function and not a constant
 *
 * "413 means oversize" is the other half of the knowledge, and it was already
 * written out twice. A bare string would have left the status test copied at
 * each call site, which is the drift §4.8 names.
 *
 * ## Why the special case exists — the true reason, and it is not the obvious one
 *
 * Not to rescue a framework error page. Nest maps multer's `LIMIT_FILE_SIZE` to
 * `PayloadTooLargeException`, so the body a `FileInterceptor` limit produces
 * really is this app's ordinary envelope —
 * `{"message":"File too large","error":"Payload Too Large","statusCode":413}` —
 * and an unwrapper alone would already yield `File too large`. The case exists
 * to **add the 5 MB figure**, which multer's own message does not carry: a
 * refusal that names no limit leaves the operator guessing what would fit.
 *
 * The branch is robust to a body that is not that envelope anyway — but the
 * topology that produces one is named here rather than assumed, because the
 * first version of this docblock asserted it as ambient fact and it is not.
 *
 * **This repository ships no proxy in front of the API.** Its only nginx is
 * `apps/web/nginx.conf`, which serves the SPA's static files (`try_files … /
 * index.html`) and does not proxy `/api`; the SPA calls the API on a separate
 * origin, `VITE_API_URL`. `client_max_body_size` appears in no file in this
 * repository. A TLS reverse proxy is *externally supplied* and optional —
 * `docs/windows-vm-docker-deploy.md` says the committed compose file "does not
 * include the TLS reverse proxy itself" and that the routing "must therefore be
 * supplied by the VM/IIS/nginx/Caddy/Azure Application Gateway layer in front of
 * the containers", and it writes the public API URL as conditional ("*if* the
 * reverse proxy routes `/api`").
 *
 * So an HTML 413 from a `client_max_body_size` is what such a deployment
 * *would* answer with, before the request reaches Nest at all. It is a body
 * this branch handles, not one this repository is known to produce.
 *
 * ## Two things this sentence does not do, recorded rather than fixed
 *
 * The API says 5 **MiB** (`5 * 1024 * 1024`); this says 5 MB. The wording is
 * pinned by two existing assertions and is left alone. And the limit itself
 * still lives only in `apps/api/src/admin/telemetry-import/telemetry-import.schema.ts`,
 * which `apps/web` cannot import and `packages/shared` does not carry — so this
 * closes three web copies into one without closing the API-to-web gap.
 *
 * @param status the HTTP status of the refused response.
 * @returns the sentence for a 413, or `null` for every other status, so a
 *          caller keeps its own fallback wording.
 */
export function oversizeUploadMessage(status: number): string | null {
  if (status === 413) {
    return "File is too large — the limit is 5 MB.";
  }
  return null;
}
