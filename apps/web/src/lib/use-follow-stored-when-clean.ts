/**
 * The asset-template tabs' "follow the server while clean" rule (`F3.85` PR
 * 11a review finding C2, extended to every tab by the post-merge fix).
 *
 * A dock Confirm of a copilot change (`assetTemplate.update`) invalidates the
 * template, and it refetches under the **same id and status** — so a tab whose
 * only reseed is keyed on `[template.id, template.status]` keeps its old rows,
 * compares them with the new stored value, reports itself dirty, and its next
 * Save silently sends the old rows back over the copilot's write.
 *
 * The rule: when the stored value changes under the same id, the tab's state
 * follows it **only while the state still equals the value it was seeded
 * from**. A clean tab shows the new value and stays clean; an edit in progress
 * is never overwritten. A change of id is the tab's own id/status effect's job,
 * so this hook only records it. `reseed` is also handed the value the state was
 * seeded from, so a tab whose fields are independent (Details) can judge
 * "clean" field by field: pass an `isClean` that always answers `true` and keep
 * the edited fields inside `reseed` (`F3.85` post-merge review finding R2).
 *
 * The returned function reseeds from a stored value the tab already holds — a
 * save's own answer — and records it as the seeded value. A save whose content
 * a copilot `fill_step` replaced answers with rows the tab never held, so
 * without it the tab would keep the pre-fill rows and stay dirty (`F1`).
 */
import { useEffect, useRef } from "react";

/**
 * Follows a stored value while the tab is clean; returns a reseed for a save's answer.
 *
 * @param id the row id — a change of id is recorded, never followed here.
 * @param stored the stored value the tab's state is derived from.
 * @param isClean whether the tab's current state still equals `previous`.
 * @param reseed sets the tab's state from a stored value; `previous` is the value it was seeded from.
 */
export function useFollowStoredWhenClean<S>(
  id: string,
  stored: S,
  isClean: (previous: S) => boolean,
  reseed: (next: S, previous: S) => void,
): (next: S) => void {
  const signature = JSON.stringify(stored ?? null);
  const seededFrom = useRef({ id, stored, signature });

  useEffect(() => {
    const previous = seededFrom.current;
    seededFrom.current = { id, stored, signature };
    if (previous.id !== id || previous.signature === signature) return;
    if (isClean(previous.stored)) reseed(stored, previous.stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the stored value's content, not its identity.
  }, [id, signature]);

  return (next: S) => {
    const previous = seededFrom.current.stored;
    seededFrom.current = { id, stored: next, signature: JSON.stringify(next ?? null) };
    reseed(next, previous);
  };
}
