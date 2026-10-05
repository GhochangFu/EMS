/** One run of an assistant message: plain text, or the text between a `**` pair. */
export type BoldSegment = { text: string; bold: boolean };

/**
 * `F4.198` — splits assistant text on `**` pairs. Nothing else is interpreted:
 * the text is untrusted LLM output, so the caller renders each segment as a
 * React text node (`<strong>` or plain), never as markup.
 *
 * Even indexes of the `**` split are plain. An odd index with a closing marker
 * after it is bold. A last part at an odd index has no closer, so its `**` was
 * a lone marker and stays literal. Empty segments are dropped.
 */
export function boldSegments(text: string): BoldSegment[] {
  const parts = text.split("**");
  const out: BoldSegment[] = [];
  const push = (segment: BoldSegment): void => {
    if (segment.text === "") {
      return;
    }
    const last = out[out.length - 1];
    if (last !== undefined && !last.bold && !segment.bold) {
      last.text += segment.text;
      return;
    }
    out.push(segment);
  };
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      push({ text: part, bold: false });
    } else if (i < parts.length - 1) {
      push({ text: part, bold: true });
    } else {
      push({ text: `**${part}`, bold: false });
    }
  });
  return out;
}
