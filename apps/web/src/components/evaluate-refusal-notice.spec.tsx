import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { EvaluateRefusalNotice } from "./evaluate-refusal-notice";

/**
 * The body `POST /api/v1/rules/evaluate` returns when it refuses (`F3.47`).
 *
 * **This string is hand-copied from `rules.controller.ts`**, and nothing in
 * either app gates the two against each other: `apps/web` cannot import from
 * `apps/api`, and a 429 body is not a response contract — every error path in
 * `apps/web/src/api/rules.ts` reads `res.text()` and parses no schema, so ADR
 * 0030 does not reach it. What IS gated here is the unwrapping: the shape is
 * Nest's error envelope, which is what `apiErrorMessage` knows how to read.
 *
 * `Retry-After` is a header, and a deliberately unexposed one (the SPA is a
 * different origin and `main.ts` does not list it in `exposedHeaders`), so the
 * seconds an operator reads can only come from this body.
 */
const REFUSAL_BODY = JSON.stringify({
  statusCode: 429,
  message: "Rules were evaluated moments ago. Try again in 12 seconds.",
});

/**
 * `F3.47` — the refusal an operator can actually read (ADR 0042).
 *
 * Before this, `evaluateM` had no `onError` and the panel rendered nothing for
 * a failed evaluate: a 429 made the *Evaluate now* button do nothing at all,
 * twice, silently. Shipping the throttle without this would have been shipping
 * a button that lies.
 */

/** 18. Nothing to say, nothing rendered. Paired with 19 below on the same
 * component: an absence alone passes when the component is broken outright, or
 * when it renders nothing ever. */
export function saysNothingWhenThereIsNoError(): void {
  const { container } = render(<EvaluateRefusalNotice error={null} />);
  expect(container.querySelector('[role="alert"]')).toBeNull();
}

/** 19. The server's sentence, not the server's JSON. Rendering `String(error)`
 * puts `{"statusCode":429,…}` on screen — the exact defect
 * `api-error-message.ts` records from `F2.5`, where the service wrote a good
 * sentence and the author never saw it. */
export function showsTheServerSentenceAndNotItsEnvelope(): void {
  render(<EvaluateRefusalNotice error={new Error(REFUSAL_BODY)} />);

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("12 seconds");
  expect(alert.textContent).not.toContain("statusCode");
  expect(alert.textContent).not.toContain("{");
}

/** A body that is not a Nest envelope — a proxy's HTML page, a gateway
 * timeout, an empty response. The notice still says something rather than
 * rendering an empty red bar. */
export function saysSomethingWhenTheBodyIsNotAnEnvelope(): void {
  render(<EvaluateRefusalNotice error={new Error("502 Bad Gateway")} />);
  expect(screen.getByRole("alert").textContent).toContain("502 Bad Gateway");
}
