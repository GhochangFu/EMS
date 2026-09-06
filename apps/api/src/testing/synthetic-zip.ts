/**
 * A zip container whose central directory declares whatever uncompressed sizes
 * a test asks for, with no real payload behind them — enough for
 * `spreadsheet-guard.ts`, which reads the directory and nothing else, and for
 * the two spreadsheet parsers to prove they refuse such a file *before*
 * `XLSX.read` runs. Never used in production code.
 */
export function syntheticZip(declaredUncompressedSizes: readonly number[], options: { zip64?: boolean } = {}): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  const entries = declaredUncompressedSizes.map((size, index) => {
    const name = Buffer.from(`entry-${index}.xml`, "utf8");
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(options.zip64 ? 0xffffffff : 1, 20); // compressed size
    entry.writeUInt32LE(options.zip64 ? 0xffffffff : size, 24); // uncompressed size
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt32LE(0, 42); // local header offset
    name.copy(entry, 46);
    return entry;
  });
  const directory = Buffer.concat(entries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, directory, eocd]);
}
