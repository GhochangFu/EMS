import { Fragment } from "react";

import { boldSegments } from "../../lib/bold-segments";

/**
 * `F4.198` — an assistant bubble's text with its `**bold**` pairs as `<strong>`.
 * Agent-mode text is untrusted LLM output: every segment is a React text node,
 * never markup, so a message carrying HTML renders as visible text.
 *
 * Lifted from the onboarding page for the copilot dock (`F3.85` PR 7,
 * plan §9.2); the dock and its onboarding skill panel render with it
 * (`F3.86` PR 7 retired the page).
 */
export function AssistantText({ text }: { text: string }) {
  return (
    <>
      {boldSegments(text).map((segment, i) =>
        segment.bold ? <strong key={i}>{segment.text}</strong> : <Fragment key={i}>{segment.text}</Fragment>,
      )}
    </>
  );
}
