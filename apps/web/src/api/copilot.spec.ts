import { expect, vi } from "vitest";

import type { CopilotTurnResponseDto } from "@bms/shared";

import { useAuthStore } from "../stores/auth-store";
import { sendCopilotTurn } from "./copilot";

/**
 * `F3.87` PR 8 (ADR 0099 Amendment 3 A4; plan §10) — `sendCopilotTurn` puts a
 * turn on the wire as JSON when it carries no file, and as `FormData`
 * (`message`, then one `files` entry per file) when it does. The multipart
 * request sets no `Content-Type` of its own: the browser writes the boundary,
 * and a hand-written `multipart/form-data` would carry none. The request handed
 * to `fetch` is the only place this is observable, so each case reads it.
 * `node` environment, as `copilot-confirm.spec.ts`.
 */
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
/** `F4.245`: one open wizard, sent with every turn. */
const WIZARDS = [{ catalogId: "dashboard.update", params: { id: CONVERSATION_ID } }];

const RESPONSE: CopilotTurnResponseDto = {
  conversationId: CONVERSATION_ID,
  outcome: "answered",
  configured: true,
  reply: "ok",
  messages: [],
  navigateTo: null,
  pendingChanges: [],
  fillStep: null,
};

type Seen = { url: string; init: RequestInit };

function capture(): () => Seen {
  let seen: Seen | null = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(RESPONSE), { status: 200 });
  });
  return () => {
    if (seen === null) throw new Error("fetch was not called");
    return seen;
  };
}

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

export async function aTurnWithFilesIsSentAsFormData(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture();
  const files = [file("plant.png", "image/png"), file("sld.pdf", "application/pdf")];
  expect(await sendCopilotTurn(CONVERSATION_ID, "draw the mimic", files, WIZARDS)).toEqual(RESPONSE);
  const { url, init } = seen();
  expect(url).toMatch(new RegExp(`/api/v1/copilot/conversations/${CONVERSATION_ID}/turns$`));
  expect(init.method).toBe("POST");
  expect(init.body).toBeInstanceOf(FormData);
  const form = init.body as FormData;
  expect([...form.keys()]).toEqual(["message", "wizards", "files", "files"]);
  expect(form.get("message")).toBe("draw the mimic");
  expect(form.get("wizards")).toBe(JSON.stringify(WIZARDS));
  expect(form.getAll("files").map((f) => (f as File).name)).toEqual(["plant.png", "sld.pdf"]);
}

export async function aTurnWithFilesSetsNoContentType(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture();
  await sendCopilotTurn(CONVERSATION_ID, "draw", [file("plant.png", "image/png")], []);
  const headers = new Headers(seen().init.headers);
  // Positive beside the absence: the request did carry headers (the bearer).
  expect(headers.get("Authorization")).toBe("Bearer token-1");
  expect(headers.get("Content-Type")).toBeNull();
}

export async function aTurnWithoutFilesIsSentAsJson(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture();
  await sendCopilotTurn(CONVERSATION_ID, "how many alarms?", [], WIZARDS);
  const { init } = seen();
  expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  // `F4.245`: the open wizards ride with the message. Mutation: send `[]` whatever the argument → red.
  expect(init.body).toBe(JSON.stringify({ message: "how many alarms?", wizards: WIZARDS }));
}

export async function anEmptyFileListIsSentAsJson(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const seen = capture();
  await sendCopilotTurn(CONVERSATION_ID, "hi", [], []);
  const { init } = seen();
  expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  expect(init.body).toBe(JSON.stringify({ message: "hi", wizards: [] }));
}
