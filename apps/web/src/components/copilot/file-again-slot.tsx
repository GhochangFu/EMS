import { useEffect, useRef, useState } from "react";

import { type Digest, fileFor, sha256Hex } from "../../lib/copilot-file-memory";

/** `F4.283`: the sentence a picked file of other bytes shows; Confirm stays disabled. */
export const FILE_HASH_MISMATCH_SENTENCE = "This is not the same file: its hash differs.";

/** `F4.283`: the sentence a pick shows when this browser cannot hash it; the server's check decides on Confirm. */
export const FILE_HASH_UNCHECKED_SENTENCE = "This browser cannot check the file here. The server checks it on Confirm.";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q19; owner ruling 2026-10-24, drafter choice
 * 5) — the file a file-upload card sends on Confirm. The server stored the
 * file's name and SHA-256 only; this tab kept the `File` it attached
 * (`copilot-file-memory.ts`). Without it (a reload, a new tab) the slot asks
 * for the same file again, hashes the pick and compares it with the stored
 * hash before it hands the file up. The server's route stage (409) stays the
 * gate: this check only spares a Confirm that could never apply.
 */
export function FileAgainSlot({
  filename,
  sha256,
  onFile,
  digest,
}: {
  filename: string;
  sha256: string;
  /** The file that matches the stored hash, or `null` while there is none. */
  onFile: (file: File | null) => void;
  /** Specs only: jsdom may lack `crypto.subtle`. */
  digest?: Digest;
}) {
  const kept = fileFor(sha256);
  const [picked, setPicked] = useState<File | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [unchecked, setUnchecked] = useState(false);

  // The callback is read through a ref, so a parent's inline handler does not re-run the effect.
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  useEffect(() => {
    if (kept !== undefined) onFileRef.current(kept);
  }, [kept]);

  const onPick = async (file: File | undefined) => {
    if (file === undefined) return;
    // `null`: no digest here (no `crypto.subtle` on an insecure origin). That is not a mismatch: the
    // file goes up unchecked and the server's route stage (409) decides.
    const hash = await sha256Hex(file, digest).catch(() => null);
    const same = hash === null || hash === sha256;
    setUnchecked(hash === null);
    setMismatch(!same);
    setPicked(same ? file : null);
    onFile(same ? file : null);
  };

  if (kept !== undefined) {
    return (
      <p data-testid="copilot-file-kept" className="mt-2 text-[11px] text-ink-muted">
        {`File: ${filename} (kept in this browser until Confirm).`}
      </p>
    );
  }
  return (
    <div className="mt-2 text-[11px]">
      <label className="block text-ink-muted">
        {picked === null ? `Attach ${filename} again to confirm.` : `File: ${filename}.`}
        <input
          type="file"
          aria-label={`Attach ${filename} again`}
          onChange={(event) => void onPick(event.target.files?.[0])}
          className="mt-0.5 block text-xs"
        />
      </label>
      {unchecked && <p className="text-ink-muted">{FILE_HASH_UNCHECKED_SENTENCE}</p>}
      {mismatch && (
        <p role="alert" className="text-critical-ink">
          {FILE_HASH_MISMATCH_SENTENCE}
        </p>
      )}
    </div>
  );
}
