import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { CalcPointDeleteWizard } from "./calc-point-delete-wizard";

/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — the `calcPoint.delete` wizard.
 * Assertions live here; `calc-point-delete-wizard.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2).
 */

const ASSET = "f4311000-0000-4000-8000-0000000000a1";

export function theDeleteWizardShowsTheServersRefusal(): void {
  const sentence = "This calculated point is shown on 2 dashboard widget(s). Remove it from those widgets first, then delete it.";
  render(
    <CalcPointDeleteWizard
      assetId={ASSET}
      pointKey="pf"
      assetLabel="PMP-1"
      deleting={false}
      error={sentence}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );
  expect(screen.getByText(sentence)).toBeTruthy();
}
