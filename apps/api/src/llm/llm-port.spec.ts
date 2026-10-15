import { textOfContent, type LlmContentPart } from "./llm-port";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertAStringIsItsOwnText(): void {
  assert(textOfContent("draw the mimic") === "draw the mimic", "a string content is its own text");
}

export function assertTextPartsAreJoinedAndFilePartsDropped(): void {
  const parts: LlmContentPart[] = [
    { type: "text", text: "draw the mimic" },
    { type: "image", mediaType: "image/png", data: Buffer.from([1, 2, 3]) },
    { type: "text", text: "from this photo" },
    { type: "document", mediaType: "application/pdf", data: Buffer.from([4, 5, 6]), filename: "sld.pdf" },
  ];
  assert(
    textOfContent(parts) === "draw the mimic\nfrom this photo",
    "the text parts are joined by a newline; image and document parts add nothing",
  );
}

export function assertNoTextPartIsEmptyText(): void {
  assert(
    textOfContent([{ type: "image", mediaType: "image/jpeg", data: Buffer.from([1]) }]) === "",
    "a parts array without a text part has empty text",
  );
}
