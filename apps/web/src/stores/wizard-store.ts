import type { CopilotFillStepDto } from "@bms/shared";
import { create } from "zustand";

/**
 * `F3.85` PR 8 (plan §10.3) — the hand-off from the copilot dock to an open
 * wizard. The dock puts a turn's `fillStep` here; the wizard shell for that
 * catalog entry takes it once (`take`) and merges it into its form. Nothing
 * is stored on the server and nothing is sent: the user reviews the values.
 *
 * `seq` grows with every fill, so a wizard re-reads even when two fills are
 * equal.
 */
type WizardFillState = {
  fill: CopilotFillStepDto | null;
  seq: number;
  receiveFill: (fill: CopilotFillStepDto) => void;
  /** The waiting fill for `catalogId`, removed as it is read; `null` when there is none. */
  take: (catalogId: string) => CopilotFillStepDto | null;
};

export const useWizardStore = create<WizardFillState>((set, get) => ({
  fill: null,
  seq: 0,
  receiveFill: (fill) => set((state) => ({ fill, seq: state.seq + 1 })),
  take: (catalogId) => {
    const { fill } = get();
    if (fill === null || fill.catalogId !== catalogId) return null;
    set({ fill: null });
    return fill;
  },
}));

/** For specs: forget any waiting fill. */
export function resetWizardStore(): void {
  useWizardStore.setState({ fill: null, seq: 0 });
}
