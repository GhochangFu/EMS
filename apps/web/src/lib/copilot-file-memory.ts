/**
 * `F4.283` (ADR 0099 Amendment 8 Q19; owner ruling 2026-10-24, drafter choice
 * 5) — the files this tab attached to a copilot turn, kept in memory by their
 * SHA-256 so a file-upload card can send the same bytes on Confirm. The server
 * stores the name and the hash only, never the bytes.
 *
 * The map is per tab and in memory: a reload or a new tab forgets every file,
 * and the card asks for the same file again. The browser compares the hash of
 * a picked file before it enables Confirm; the server's route stage (409) stays
 * the gate.
 */

/** Hashes bytes; injectable, because jsdom may lack `crypto.subtle`. */
export type Digest = (bytes: ArrayBuffer) => Promise<ArrayBuffer>;

const subtleDigest: Digest = (bytes) => crypto.subtle.digest("SHA-256", bytes);

const kept = new Map<string, File>();

/** Reads a `File`'s bytes (jsdom's `File` may lack `arrayBuffer`). */
function bytesOf(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** The lower-case hex SHA-256 of a file's bytes, as the server's inspection writes it. */
export async function sha256Hex(file: File, digest: Digest = subtleDigest): Promise<string> {
  const hash = new Uint8Array(await digest(await bytesOf(file)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Keeps the files of a sent turn, each under its SHA-256. A file that cannot be hashed is not kept. */
export async function rememberFiles(files: readonly File[], digest: Digest = subtleDigest): Promise<void> {
  for (const file of files) {
    try {
      kept.set(await sha256Hex(file, digest), file);
    } catch {
      // No `crypto.subtle` (an insecure origin): the card asks for the file again.
    }
  }
}

/** The kept file with this SHA-256, or `undefined`. */
export function fileFor(sha256: string): File | undefined {
  return kept.get(sha256);
}

/** Specs only: forget every kept file. */
export function forgetFiles(): void {
  kept.clear();
}
