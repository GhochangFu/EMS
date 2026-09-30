#!/usr/bin/env node
/**
 * `F3.32f` / ADR 0086 decision 9 — lists the Wikimedia Commons candidates for the `wmpid`
 * library, for the curator (U3). Run by hand, never in CI:
 *
 *   node scripts/mimic-symbols/wmpid-curate.mjs --out <file>
 *
 * It walks `Category:P&ID symbols` and its subcategories through the Commons API, reads each
 * file's image information (`sha1`, `timestamp`, `url`, `mime`, `extmetadata`) and its page text
 * for licence templates, and writes (to `--out`, or to standard output without it) a JSON array of the files that are `image/svg+xml`, licensed
 * `Public domain` or `CC0`, and not a composite sheet (a title matching `Sheet` or `Symbols`):
 * `{ name, title, url, sha1, timestamp, author, licence, templates }`. `name` is a slug of the
 * title; the curator renames and groups the entries into `curation/wmpid.json`. `templates` lists
 * the licence templates of the page text, and the unnamed parameters of a `{{self|…}}` template
 * after it (`self`, `cc-zero`), so the licence a `self` page names is recorded.
 *
 * One request every 1.5 s, with a User-Agent: Commons answered HTTP 429 to faster research runs.
 * Only `commons.wikimedia.org` is called. No dependency beyond Node.
 */
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MIMIC_FETCH_USER_AGENT } from "./fetch-sources.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
const ROOT_CATEGORY = "Category:P&ID symbols";
const PAUSE_MS = 1500;
const RETRIES = 5;
const BATCH = 50;
const TEMPLATE = /\{\{\s*((?:PD|Cc|CC|GFDL|GPL|self|Self|LGPL)[^|}]*)((?:\|[^}]*)?)/g;
const KEPT_LICENCES = new Set(["Public domain", "CC0"]);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One API request, after the pause; a non-200 answer is retried up to five times, the pause doubling. */
async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2" })) url.searchParams.set(k, v);
  let pause = PAUSE_MS;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    await sleep(pause);
    const response = await fetch(url, { redirect: "error", headers: { "User-Agent": MIMIC_FETCH_USER_AGENT } });
    if (response.status === 200) return response.json();
    console.error(`wmpid-curate: the API answered ${response.status}; retry ${attempt + 1} of ${RETRIES}`);
    pause *= 2;
  }
  throw new Error(`${url} did not answer 200 after ${RETRIES} retries`);
}

/** Every file title under the category, its subcategories walked once each. */
async function walk() {
  const files = new Set();
  const seen = new Set([ROOT_CATEGORY]);
  const queue = [ROOT_CATEGORY];
  while (queue.length > 0) {
    const category = queue.shift();
    let cont;
    do {
      const data = await api({
        action: "query",
        list: "categorymembers",
        cmtitle: category,
        cmtype: "file|subcat",
        cmlimit: "500",
        ...(cont ? { cmcontinue: cont } : {}),
      });
      for (const member of data.query?.categorymembers ?? []) {
        if (member.ns === 14 && !seen.has(member.title)) {
          seen.add(member.title);
          queue.push(member.title);
        } else if (member.ns === 6) {
          files.add(member.title);
        }
      }
      cont = data.continue?.cmcontinue;
    } while (cont);
  }
  return [...files].sort();
}

const plain = (html) =>
  String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const slug = (title) =>
  title
    .replace(/^File:/, "")
    .replace(/\.svg$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function describe(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const data = await api({
      action: "query",
      titles: titles.slice(i, i + BATCH).join("|"),
      prop: "imageinfo|revisions",
      iiprop: "sha1|timestamp|url|mime|extmetadata",
      rvprop: "content",
      rvslots: "main",
    });
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const text = page.revisions?.[0]?.slots?.main?.content ?? "";
      const templates = [
        ...new Set(
          [...text.matchAll(TEMPLATE)].flatMap((m) => {
            const name = m[1].trim();
            if (!/^self$/i.test(name)) return [name];
            // {{self|cc-zero|author=…}}: the unnamed parameters are the licences.
            const params = m[2]
              .split("|")
              .map((part) => part.trim())
              .filter((part) => part !== "" && !part.includes("="));
            return [name, ...params];
          }),
        ),
      ];
      out.push({
        name: slug(page.title),
        title: page.title,
        // The API appends `?utm_source=…` tracking parameters; the original is the path alone.
        url: String(info.url).split("?")[0],
        sha1: info.sha1,
        timestamp: info.timestamp,
        mime: info.mime,
        author: plain(info.extmetadata?.Artist?.value),
        licence: plain(info.extmetadata?.LicenseShortName?.value),
        templates,
      });
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let out = null;
  if (argv.length > 0) {
    if (argv[0] !== "--out" || !argv[1] || argv.length !== 2) throw new Error("usage: wmpid-curate.mjs [--out <file>]");
    out = resolve(argv[1]);
  }
  const titles = await walk();
  console.error(`wmpid-curate: ${titles.length} files under ${ROOT_CATEGORY}`);
  const described = await describe(titles);
  const candidates = described
    .filter((f) => f.mime === "image/svg+xml" && KEPT_LICENCES.has(f.licence) && !/Sheet|Symbols/.test(f.title))
    .map(({ mime, ...rest }) => {
      void mime;
      return rest;
    });
  console.error(`wmpid-curate: ${candidates.length} candidates (SVG, public domain or CC0, not a sheet)`);
  const text = `${JSON.stringify(candidates, null, 2)}\n`;
  if (out) {
    writeFileSync(out, text);
    console.error(`wmpid-curate: wrote ${out}`);
  } else process.stdout.write(text);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`wmpid-curate: ${error.stack}`);
    process.exit(1);
  });
}
