/**
 * `F4.130` — every nginx config that serves the SPA revalidates `index.html`
 * and refuses a missing hashed asset.
 *
 * Without `Cache-Control` on `index.html` a browser applies heuristic freshness
 * and boots the previous build's bundle after a deploy; with only
 * `try_files $uri $uri/ /index.html` a hashed chunk the new image no longer
 * ships comes back as `index.html` with 200, and the old bundle's lazy
 * `import()` fails with an empty `#root`. `deploy/aws/nginx.conf` (ADR 0096)
 * already had both; `apps/web/nginx.conf`, which the image and the root compose
 * stack serve, had neither. Each `location` block is sliced on its own, so a
 * directive in another block cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** The body of `location <match> { … }`, braces balanced; comments stripped first. */
const locationBlock = (conf: string, match: string): string | null => {
  const text = conf.replace(/#[^\n]*/g, "");
  const header = new RegExp(`location\\s+${match.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*\\{`);
  const found = header.exec(text);
  if (!found) return null;
  let depth = 1;
  let i = found.index + found[0].length;
  const start = i;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
  }
  return text.slice(start, i - 1);
};

const REVALIDATE = /add_header\s+Cache-Control\s+"[^"]*\bno-(cache|store)\b[^"]*"/;

describe.each(["apps/web/nginx.conf", "deploy/aws/nginx.conf"])("F4.130 — %s", (file) => {
  const conf = read(file);

  it("refuses a missing hashed asset with 404 instead of index.html", () => {
    const assets = locationBlock(conf, "/assets/");
    expect(assets, "a location /assets/ block").not.toBeNull();
    expect(assets).toMatch(/try_files\s+\$uri\s+=404\s*;/);
    expect(assets).not.toMatch(/index\.html/);
    // A server-level fallback would turn the 404 back into index.html with 200.
    expect(conf.replace(/#[^\n]*/g, "")).not.toMatch(/error_page\s+404[^;]*index\.html/);
  });

  it("caches hashed assets as immutable", () => {
    expect(locationBlock(conf, "/assets/")).toMatch(/add_header\s+Cache-Control\s+"[^"]*\bimmutable\b[^"]*"/);
  });

  it("sends index.html with no-cache wherever the SPA fallback serves it", () => {
    const exact = locationBlock(conf, "= /index.html");
    const root = locationBlock(conf, "/");
    expect(root, "a location / block").not.toBeNull();
    expect(root).toMatch(/try_files[^;]*\/index\.html\s*;/);
    // The fallback is an internal redirect to /index.html: an exact block wins, else location / serves it.
    expect(exact ?? root).toMatch(REVALIDATE);
    // A regex location wins over the `/` prefix, so it would serve /index.html without the header.
    expect(conf.replace(/#[^\n]*/g, "")).not.toMatch(/location\s+~/);
  });
});

/**
 * `F4.247` / ADR 0099 Amendment 5 C3 — nginx answers no `If-Match` itself. Its
 * not-modified filter evaluates a request's `If-Match` against the response's
 * `ETag` and can finalize a 200 as 412; it is skipped for a proxied response that
 * is not cacheable (`r->disable_not_modified = !u->cacheable`). So the API's own
 * 200 or 412 passes through only while nothing caches. A `proxy_cache` at
 * `http`, `server` or `location` level is inherited, so the whole file is
 * scanned, comments stripped.
 */
describe.each(["apps/web/nginx.conf", "deploy/aws/nginx.conf"])("F4.247 — %s", (file) => {
  it("caches no proxied response anywhere in the file", () => {
    expect(read(file).replace(/#[^\n]*/g, "")).not.toMatch(/\bproxy_cache\b/);
  });
});

describe("F4.247 — deploy/aws/nginx.conf proxies the API", () => {
  it("passes /api/ to the API upstream, the path the If-Match writes take", () => {
    expect(locationBlock(read("deploy/aws/nginx.conf"), "/api/")).toMatch(/proxy_pass\s+\$api_upstream\s*;/);
  });
});
