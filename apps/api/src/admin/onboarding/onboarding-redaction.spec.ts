import { redactDraftForClient, redactDraftForLlm } from "./onboarding-redaction";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Ensures secrets are stripped from client and LLM views. */
export function runOnboardingRedactionTests(): void {
  const draft = {
    location: { name: "Test" },
    rtus: [{ code: "R1", credentialsSet: true }],
    _secrets: { "0": { c: "abc", iv: "def" } },
  };
  const client = redactDraftForClient(draft) as { _secrets?: unknown };
  assert(client._secrets === undefined, "client draft strips _secrets");
  const llm = JSON.stringify(redactDraftForLlm({ password: "secret", name: "x" }));
  assert(!llm.includes("secret"), "llm redacts password key");
}
