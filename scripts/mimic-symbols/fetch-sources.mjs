#!/usr/bin/env node
/**
 * `F3.32f` / ADR 0086 decision 9 (plan R9) — downloads the pinned source files of one
 * third-party mimic symbol library for `generate.mjs`. Run by hand on the implementer's machine,
 * never in CI:
 *
 *   node scripts/mimic-symbols/fetch-sources.mjs qet    --out <dir>
 *   node scripts/mimic-symbols/fetch-sources.mjs drawio --out <dir>
 *   node scripts/mimic-symbols/fetch-sources.mjs wmpid  --out <dir>
 *
 * It reads `scripts/mimic-symbols/curation/<code>.json` and fetches only what the curation names:
 *
 * - `qet`: each entry's `path` at the pinned commit of `qelectrotech/qelectrotech-elements`, and
 *   `ELEMENTS.LICENSE`, to `<out>/<path>`;
 * - `drawio`: each distinct `set` (`pid/<file>` or `electrical/<file>`) at the pinned commit of
 *   `jgraph/drawio`, to `<out>/<set>.xml`, plus `README.md`, `LICENSE` and `stencils/LICENSE`
 *   (a 404 is tolerated for the last only);
 * - `wmpid`: each entry's `url` (an upload.wikimedia.org original), with a User-Agent, a pause of
 *   `WMPID_PAUSE_MS` between requests and up to five retries with a doubling pause on a non-200 or
 *   an HTML answer (Commons answers HTTP 429 pages); the bytes' sha1 must equal the entry's
 *   `sha1`, or the file is refused. Written to `<out>/<name>.svg`.
 *
 * Only `raw.githubusercontent.com` and `upload.wikimedia.org` are fetched; any other URL in a
 * curation entry is refused, and every request refuses a redirect (`redirect: "error"`), so a 3xx
 * cannot take the script to a host the list does not name. No dependency beyond Node.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NAME } from "./lib/grammar.mjs";
import { DRAWIO_PIN } from "./sources/drawio.mjs";
import { QET_PIN } from "./sources/qet.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QET_RAW = `https://raw.githubusercontent.com/qelectrotech/qelectrotech-elements/${QET_PIN}/`;
const DRAWIO_RAW = `https://raw.githubusercontent.com/jgraph/drawio/${DRAWIO_PIN}/`;
const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "upload.wikimedia.org"]);
/**
 * The Wikimedia User-Agent policy asks for a contact: upload.wikimedia.org answered HTTP 429
 * (retry-after 600) to this string without the URL, and 200 with it. `wmpid-curate.mjs` sends it too.
 */
export const MIMIC_FETCH_USER_AGENT =
  "TRINETRA-mimic-symbols/1.0 (https://www.euphoriainfotech.com; symbol library vendoring, run by hand)";
const USER_AGENT = MIMIC_FETCH_USER_AGENT;
const GITHUB_PAUSE_MS = 250;
export const WMPID_PAUSE_MS = 1500;
const WMPID_RETRIES = 5;

/** A path under the QET repository root: letters, digits, `_`, `-`, `.` and `/`, no `..`. */
const QET_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.elmt$/;
/** A draw.io stencil set in the two ruled-in families (`electrical/electro-mechanical`); no `.` or `/`. */
const DRAWIO_SET = /^(?:pid|electrical)\/[A-Za-z0-9_-]+$/;

function fail(message) {
  console.error(`fetch-sources: ${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function allowedUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return fail(`${JSON.stringify(text)} is not a URL`);
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) fail(`${text} is not on an allowed host`);
  return url;
}

function entries(code) {
  const curation = JSON.parse(readFileSync(join(ROOT, "scripts", "mimic-symbols", "curation", `${code}.json`), "utf8"));
  const out = Object.values(curation).flat();
  for (const entry of out) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !NAME.test(entry.name)) {
      fail(`${code} curation entry ${JSON.stringify(entry)} has no valid name`);
    }
  }
  return out;
}

async function get(url, { tolerate404 = false } = {}) {
  const response = await fetch(allowedUrl(url), { redirect: "error", headers: { "User-Agent": USER_AGENT } });
  if (tolerate404 && response.status === 404) return null;
  if (response.status !== 200) fail(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function write(out, rel, bytes) {
  const file = join(out, ...rel.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

async function fetchQet(out) {
  const list = entries("qet");
  for (const entry of list) {
    if (typeof entry.path !== "string" || !QET_PATH.test(entry.path)) fail(`qet:${entry.name} path ${JSON.stringify(entry.path)} is refused`);
  }
  const paths = [...new Set(list.map((e) => e.path)), "ELEMENTS.LICENSE"];
  for (const rel of paths) {
    write(out, rel, await get(`${QET_RAW}${rel}`));
    console.log(`fetch-sources: qet ${rel}`);
    await sleep(GITHUB_PAUSE_MS);
  }
}

async function fetchDrawio(out) {
  const list = entries("drawio");
  for (const entry of list) {
    if (typeof entry.set !== "string" || !DRAWIO_SET.test(entry.set)) fail(`drawio:${entry.name} set ${JSON.stringify(entry.set)} is refused`);
  }
  const sets = [...new Set(list.map((e) => e.set))];
  const files = [
    ...sets.map((set) => ({ rel: `stencils/${set}.xml`, url: `${DRAWIO_RAW}src/main/webapp/stencils/${set}.xml` })),
    { rel: "README.md", url: `${DRAWIO_RAW}README.md` },
    { rel: "LICENSE", url: `${DRAWIO_RAW}LICENSE` },
    { rel: "stencils/LICENSE", url: `${DRAWIO_RAW}src/main/webapp/stencils/LICENSE`, tolerate404: true },
  ];
  for (const file of files) {
    const bytes = await get(file.url, { tolerate404: file.tolerate404 });
    if (bytes === null) console.log(`fetch-sources: drawio ${file.rel} is absent at the pin (404)`);
    else {
      write(out, file.rel, bytes);
      console.log(`fetch-sources: drawio ${file.rel}`);
    }
    await sleep(GITHUB_PAUSE_MS);
  }
}

const looksLikeHtml = (bytes) => {
  const head = bytes.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
};

async function fetchWmpid(out) {
  const list = entries("wmpid");
  for (const entry of list) {
    const url = allowedUrl(entry.url);
    if (url.hostname !== "upload.wikimedia.org") fail(`wmpid:${entry.name} url is not an upload.wikimedia.org original`);
    if (typeof entry.sha1 !== "string" || !/^[0-9a-f]{40}$/.test(entry.sha1)) fail(`wmpid:${entry.name} has no sha1`);
  }
  for (const entry of list) {
    let pause = WMPID_PAUSE_MS;
    let bytes = null;
    for (let attempt = 0; attempt <= WMPID_RETRIES; attempt += 1) {
      await sleep(pause);
      const response = await fetch(allowedUrl(entry.url), { redirect: "error", headers: { "User-Agent": USER_AGENT } });
      const body = Buffer.from(await response.arrayBuffer());
      if (response.status === 200 && !looksLikeHtml(body)) {
        bytes = body;
        break;
      }
      console.log(`fetch-sources: wmpid:${entry.name} answered ${response.status}; retry ${attempt + 1} of ${WMPID_RETRIES}`);
      pause *= 2;
    }
    if (bytes === null) fail(`wmpid:${entry.name} did not download after ${WMPID_RETRIES} retries`);
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    if (sha1 !== entry.sha1) fail(`wmpid:${entry.name} sha1 is ${sha1}, but the curation pins ${entry.sha1}`);
    write(out, `${entry.name}.svg`, bytes);
    console.log(`fetch-sources: wmpid ${entry.name}.svg`);
  }
}

async function main() {
  const [code, flag, out] = process.argv.slice(2);
  if (flag !== "--out" || !out) fail("usage: fetch-sources.mjs qet|drawio|wmpid --out <dir>");
  const run = { qet: fetchQet, drawio: fetchDrawio, wmpid: fetchWmpid }[code];
  if (!run) fail(`unknown library ${JSON.stringify(code)}; expected qet, drawio or wmpid`);
  const target = resolve(out);
  mkdirSync(target, { recursive: true });
  await run(target);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => fail(error.stack));
}
