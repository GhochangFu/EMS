import type { CopilotFillStepDto, CopilotOpenWizard } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";
import { create } from "zustand";

import { openWizardKey } from "../lib/wizard-steps";

/**
 * `F3.85` PR 8 (plan §10.3) — the hand-off from the copilot dock to an open
 * wizard. The dock puts a turn's `fillStep` here; the wizard shell takes it
 * once (`take`) and merges it into its form. Nothing is stored on the server
 * and nothing is sent: the user reviews the values.
 *
 * `F4.245` (ADR 0099 Amendment 4): every mounted shell registers its record
 * (`register`), and the dock sends those records with each turn
 * (`openWizards`, read at send time). A fill names its record, and only the
 * shell whose key (`openWizardKey`: catalog id and filled path) is the fill's
 * takes it. A fill no open wizard matches is dropped at once — unless the same
 * turn opened a page (`waitPath`): then it waits for its wizard while that page
 * is shown, and is dropped when the user leaves it (`leavePage`) or when a
 * wizard of its key unregisters.
 *
 * `seq` grows with every fill, so a wizard re-reads even when two fills are
 * equal.
 */
type OpenWizardRow = { readonly mount: number; readonly key: string; readonly wizard: CopilotOpenWizard };
type WaitingFill = { readonly fill: CopilotFillStepDto; readonly key: string; readonly waitPath: string | null };

type WizardFillState = {
  open: readonly OpenWizardRow[];
  waiting: WaitingFill | null;
  seq: number;
  /** A mounted shell's record; returns the mount id `unregister` takes. */
  register: (key: string, wizard: CopilotOpenWizard) => number;
  unregister: (mount: number) => void;
  /** The open records, one per key, for the dock to send with a turn. */
  openWizards: () => CopilotOpenWizard[];
  /** A turn's fill; `waitPath` is the route the same turn's `open_page` sent the user to, or `null`. */
  receiveFill: (fill: CopilotFillStepDto, waitPath: string | null) => void;
  /** The waiting fill for `key`, removed as it is read; `null` when there is none. */
  take: (key: string) => CopilotFillStepDto | null;
  /** The router's path changed: a fill waiting for another page is dropped. */
  leavePage: (pathname: string) => void;
};

let mounts = 0;

/** The key a fill names, or `null` when its entry is unknown or its params are not the entry's. */
function fillKeyOf(fill: CopilotFillStepDto): string | null {
  const entry = catalogEntry(fill.catalogId);
  return entry === undefined ? null : openWizardKey(entry, fill.params);
}

export const useWizardStore = create<WizardFillState>((set, get) => ({
  open: [],
  waiting: null,
  seq: 0,
  register: (key, wizard) => {
    mounts += 1;
    const mount = mounts;
    set((state) => ({ open: [...state.open, { mount, key, wizard }] }));
    return mount;
  },
  unregister: (mount) =>
    set((state) => {
      const row = state.open.find((candidate) => candidate.mount === mount);
      const waiting = row !== undefined && state.waiting?.key === row.key ? null : state.waiting;
      return { open: state.open.filter((candidate) => candidate.mount !== mount), waiting };
    }),
  openWizards: () => {
    const seen = new Set<string>();
    const out: CopilotOpenWizard[] = [];
    for (const row of get().open) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      out.push(row.wizard);
    }
    return out;
  },
  receiveFill: (fill, waitPath) =>
    set((state) => {
      const key = fillKeyOf(fill);
      const open = key !== null && state.open.some((row) => row.key === key);
      if (key === null || (!open && waitPath === null)) return { waiting: null };
      return { waiting: { fill, key, waitPath }, seq: state.seq + 1 };
    }),
  take: (key) => {
    const { waiting } = get();
    if (waiting === null || waiting.key !== key) return null;
    set({ waiting: null });
    return waiting.fill;
  },
  leavePage: (pathname) => {
    const { waiting } = get();
    if (waiting !== null && waiting.waitPath !== pathname) set({ waiting: null });
  },
}));

/** For specs: forget every open wizard and any waiting fill (critique: `open` too, or a register leaks). */
export function resetWizardStore(): void {
  useWizardStore.setState({ open: [], waiting: null, seq: 0 });
}
