import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import { CreateTemplateWizard, createTemplateInput } from "./create-template-wizard";

const BODY = {
  organizationId: "o1",
  code: "STP-FEED",
  name: "Feeder",
  assetType: "feeder",
  domain: "electrical",
};

/** `E3.1` / ADR 0122 — a filled prefix is sent upper-case; an empty or blank one is left out. */
export function theCreateInputSendsThePrefixOnlyWhenFilled(): void {
  expect(createTemplateInput({ ...BODY, workOrderPrefix: "stp" }).workOrderPrefix).toBe("STP");
  expect("workOrderPrefix" in createTemplateInput(BODY)).toBe(false);
  expect("workOrderPrefix" in createTemplateInput({ ...BODY, workOrderPrefix: "  " })).toBe(false);
}

/** `E3.1` / ADR 0122 — the basics step offers an optional prefix field that upper-cases as typed. */
export async function theBasicsStepOffersAnUpperCasingPrefixField(): Promise<void> {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateTemplateWizard onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  const input = screen.getByRole("textbox", { name: /Work-order prefix/ }) as HTMLInputElement;
  expect(input.maxLength).toBe(8);
  await userEvent.type(input, "stp");
  expect(input.value).toBe("STP");
}

/**
 * `E3.1` (code review) — a one-letter prefix holds the step with a sentence naming the
 * field: the server would answer a bare 400, and the shell's own body check skips a
 * `clientOnly` field. A well-formed prefix lets the step go.
 */
export async function aBadPrefixHoldsTheStepWithItsSentence(): Promise<void> {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateTemplateWizard onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  const sentence = "Work-order prefix: Two to eight capital letters or digits.";
  const input = screen.getByRole("textbox", { name: /Work-order prefix/ });
  const next = screen.getByRole("button", { name: "Next" });
  expect(screen.queryByText(sentence)).toBeNull();
  expect(next.getAttribute("aria-disabled")).toBeNull();

  await userEvent.type(input, "S");
  expect(screen.getByText(sentence)).toBeTruthy();
  expect(next.getAttribute("aria-disabled")).toBe("true");

  await userEvent.type(input, "TP");
  expect(screen.queryByText(sentence)).toBeNull();
  expect(next.getAttribute("aria-disabled")).toBeNull();
}
