import { brotliDecompressSync } from "node:zlib";

/*
 * `F4.341` PR 6 (ADR 0118 Amendment 1 A6: "every --font-num face proves tabular figures by a test")
 * — just enough of WOFF2 and OpenType to list a font's GSUB feature tags. No dependency: WOFF2's
 * table data is one Brotli stream (`node:zlib`), and GSUB is never transformed (only glyf, loca and
 * hmtx may be), so its bytes are the plain OpenType table.
 *
 * W3C WOFF2 §4 (the header and the table directory, with UIntBase128 lengths) and OpenType "GSUB"
 * (the FeatureList). `tests/f4.341-fonts.test.ts` F6 runs it on every `--font-num` face and on a
 * synthetic GSUB without `tnum` (the negative fixture).
 */

/** WOFF2 §5.1 — the 63 known table tags, by the index a directory entry's flags byte carries. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readBase128(buf: Buffer, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at + i];
    if (i === 0 && byte === 0x80) throw new Error("WOFF2: UIntBase128 with a leading zero");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error("WOFF2: UIntBase128 longer than five bytes");
}

/** Every table of a WOFF2 file, untransformed tables only as their plain bytes. */
export function woff2Tables(file: Buffer): Map<string, Buffer> {
  if (file.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = file.readUInt16BE(12);
  const totalCompressedSize = file.readUInt32BE(20);
  let at = 48;
  const entries: Array<{ tag: string; length: number; transformed: boolean }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[at++];
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = file.toString("latin1", at, at + 4);
      at += 4;
    } else {
      tag = KNOWN_TAGS[flags & 0x3f] ?? "????";
    }
    const version = (flags >> 6) & 3;
    let origLength: number;
    [origLength, at] = readBase128(file, at);
    const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : tag === "hmtx" ? version === 1 : false;
    let length = origLength;
    if (transformed) [length, at] = readBase128(file, at);
    entries.push({ tag, length, transformed });
  }
  if (file.readUInt32BE(4) === 0x74746366) throw new Error("WOFF2: font collections are not read here");
  const data = brotliDecompressSync(file.subarray(at, at + totalCompressedSize));
  const out = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of entries) {
    if (!entry.transformed) out.set(entry.tag, data.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  if (offset !== data.length) throw new Error(`WOFF2: tables span ${offset} bytes, the stream holds ${data.length}`);
  return out;
}

/** The feature tags of a GSUB table's FeatureList (with repeats, in record order). */
export function gsubFeatureTags(gsub: Buffer): string[] {
  const major = gsub.readUInt16BE(0);
  if (major !== 1) throw new Error(`GSUB: version ${major}.x, not 1.x`);
  const featureList = gsub.readUInt16BE(6);
  const count = gsub.readUInt16BE(featureList);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) tags.push(gsub.toString("latin1", featureList + 2 + i * 6, featureList + 6 + i * 6));
  return tags;
}

/** Whether a WOFF2 font's GSUB offers `tnum` (tabular figures). */
export function woff2HasFeature(file: Buffer, tag: string): boolean {
  const gsub = woff2Tables(file).get("GSUB");
  return gsub !== undefined && gsubFeatureTags(gsub).includes(tag);
}

/** The glyph id `cmap` maps a code point to (format 4 or 12 subtables), or 0. */
export function glyphOf(cmap: Buffer, codePoint: number): number {
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(offset);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(offset + 6);
      const ends = offset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        if (codePoint < start || codePoint > end) continue;
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = cmap.readUInt16BE(ranges + s * 2 + rangeOffset + (codePoint - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        if (codePoint >= start && codePoint <= end) return cmap.readUInt32BE(at + 8) + (codePoint - start);
      }
    }
  }
  return 0;
}

/** A glyph's default advance width from `hhea` + `hmtx`. */
export function advanceOf(hhea: Buffer, hmtx: Buffer, glyph: number): number {
  const numberOfHMetrics = hhea.readUInt16BE(34);
  return hmtx.readUInt16BE(Math.min(glyph, numberOfHMetrics - 1) * 4);
}

/**
 * Whether a WOFF2 font sets tabular figures: its default digits 0–9 share one advance width (the
 * figures are tabular as drawn, as in IBM Plex Sans and Plex Mono, which carry no `tnum` feature
 * because they need none), or its GSUB offers `tnum` (as Archivo does), which `tabular-nums` turns on.
 */
export function woff2TabularFigures(file: Buffer): { tabular: boolean; how: "default-digits" | "tnum" | "none"; advances: number[] } {
  const tables = woff2Tables(file);
  const cmap = tables.get("cmap");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const advances =
    cmap && hhea && hmtx ? Array.from({ length: 10 }, (_, d) => advanceOf(hhea, hmtx, glyphOf(cmap, 0x30 + d))) : [];
  if (advances.length === 10 && new Set(advances).size === 1 && advances[0] > 0) return { tabular: true, how: "default-digits", advances };
  const gsub = tables.get("GSUB");
  if (gsub && gsubFeatureTags(gsub).includes("tnum")) return { tabular: true, how: "tnum", advances };
  return { tabular: false, how: "none", advances };
}
