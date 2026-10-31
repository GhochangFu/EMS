import { expect, vi } from "vitest";

import type { CopilotConversationDetailDto, CopilotConversationDto, CopilotTurnResponseDto } from "@bms/shared";

import { useAuthStore } from "../stores/auth-store";
import { fetchCopilotConversation, fetchCopilotConversations, sendCopilotTurn } from "./copilot";

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

/*
 * `F4.292` (ADR 0099 Amendment 9 E7) — the conversation list client and the
 * paged detail read. The URL handed to `fetch` is the observable seam.
 */
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

const DETAIL: CopilotConversationDetailDto = {
  id: CONVERSATION_ID,
  organizationId: null,
  title: null,
  createdAt: "2026-10-27T00:00:00.000Z",
  lastTurnAt: "2026-10-27T00:00:00.000Z",
  messages: [],
  pendingChanges: [],
  hasEarlier: true,
};

const CONVERSATIONS: CopilotConversationDto[] = [
  { id: CONVERSATION_ID, organizationId: null, title: "Show PHE alarms", createdAt: "2026-10-27T00:00:00.000Z", lastTurnAt: "2026-10-27T01:00:00.000Z" },
];

function captureAnswering(body: unknown): () => string {
  let seen: string | null = null;
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return () => {
    if (seen === null) throw new Error("fetch was not called");
    return seen;
  };
}

/** A page with `before` puts `limit` and `before` in the query. Mutation: drop `before` from the query string → red. */
export async function aPagedReadSendsLimitAndBefore(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const url = captureAnswering(DETAIL);
  await fetchCopilotConversation(CONVERSATION_ID, { before: MESSAGE_ID, limit: 50 });
  expect(url()).toMatch(new RegExp(`/api/v1/copilot/conversations/${CONVERSATION_ID}\\?limit=50&before=${MESSAGE_ID}$`));
}

/** A page without `before` sends `limit` alone. Mutation: always append `&before=` → red. */
export async function aNewestPageSendsLimitAlone(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const url = captureAnswering(DETAIL);
  await fetchCopilotConversation(CONVERSATION_ID, { limit: 50 });
  expect(url()).toMatch(new RegExp(`/api/v1/copilot/conversations/${CONVERSATION_ID}\\?limit=50$`));
}

/** A read without a page has no query (the old shape). Mutation: always send `?limit=` → red. */
export async function aReadWithoutAPageHasNoQuery(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const url = captureAnswering(DETAIL);
  await fetchCopilotConversation(CONVERSATION_ID);
  expect(url()).toMatch(new RegExp(`/api/v1/copilot/conversations/${CONVERSATION_ID}$`));
}

/** The paged read hands back `hasEarlier` (the schema keeps it). */
export async function aPagedReadReturnsHasEarlier(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  captureAnswering(DETAIL);
  expect((await fetchCopilotConversation(CONVERSATION_ID, { limit: 50 })).hasEarlier).toBe(true);
}

/** The list client asks `/copilot/conversations`. */
export async function theListClientAsksTheList(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  const url = captureAnswering(CONVERSATIONS);
  await fetchCopilotConversations();
  expect(url()).toMatch(/\/api\/v1\/copilot\/conversations$/);
}

/** The list client returns the parsed rows. */
export async function theListClientReturnsTheRows(): Promise<void> {
  useAuthStore.setState({ accessToken: "token-1" });
  captureAnswering(CONVERSATIONS);
  expect(await fetchCopilotConversations()).toEqual(CONVERSATIONS);
}
