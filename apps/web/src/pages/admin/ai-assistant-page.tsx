import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AiAssistantSettingsDto } from "@bms/shared";

import {
  deleteAiAssistantSettings,
  fetchAiAssistantSettings,
  putAiAssistantSettings,
  testAiAssistant,
} from "../../api/admin/ai-assistant";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import {
  AI_ASSISTANT_CHOICES,
  buildPutBody,
  buildTestBody,
  defaultModelPlaceholder,
  keyFieldEnabled,
  keySetLine,
  platformSummaryLine,
  providerLabel,
  saveAction,
  testAvailable,
  testStatusSentence,
  type AiAssistantChoice,
} from "../../lib/ai-assistant-form";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type AiAssistantPageProps = {
  user: AuthUser;
};

/**
 * One organization's onboarding-agent provider, model and API key (`F3.21`,
 * ADR 0090 Amendment 1 A6). Opened from the Organizations list's
 * "AI assistant" row action; no sidebar entry.
 *
 * **The key is write-only (A7).** The field is a password field that is never
 * pre-filled, it is emptied once a save resolves, and the page only ever shows
 * the last four characters the server returns.
 */
export function AiAssistantPage({ user }: AiAssistantPageProps) {
  const { orgId = "" } = useParams<{ orgId: string }>();
  const settingsQ = useQuery({
    queryKey: ["admin", "ai-assistant", orgId],
    queryFn: () => fetchAiAssistantSettings(orgId),
    enabled: orgId !== "",
  });

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Administration · AI assistant</span>}>
      <div className="mx-auto max-w-[900px] space-y-4 pb-8">
        <Link to="/admin/organizations" className="text-xs font-semibold text-ink-muted hover:text-ink">
          ← Organizations
        </Link>
        <PageHeader
          eyebrow="Administration"
          title="AI assistant"
          subtitle="The provider, model and API key the onboarding agent uses for this organization"
        />
        {settingsQ.isLoading ? (
          <div className="text-sm text-ink-muted">Loading...</div>
        ) : settingsQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(settingsQ.error)}
          </p>
        ) : settingsQ.data ? (
          <SettingsForm orgId={orgId} settings={settingsQ.data} />
        ) : null}
      </div>
    </AppShell>
  );
}

type SettingsFormProps = {
  orgId: string;
  settings: AiAssistantSettingsDto;
};

function initialChoice(settings: AiAssistantSettingsDto): AiAssistantChoice {
  return settings.source === "platform" ? "platform" : settings.provider;
}

/** The form, mounted once the setting has loaded so its state starts from it. */
function SettingsForm({ orgId, settings }: SettingsFormProps) {
  const queryClient = useQueryClient();
  const keyRef = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<AiAssistantChoice>(() => initialChoice(settings));
  const [model, setModel] = useState(() =>
    settings.source === "organization" ? (settings.model ?? "") : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  function saved(dto: AiAssistantSettingsDto, message: string): void {
    queryClient.setQueryData(["admin", "ai-assistant", orgId], dto);
    // Write-only: the key leaves the page's state as soon as the server has it.
    setApiKey("");
    setError(null);
    setNotice(message);
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<AiAssistantSettingsDto | null> => {
      if (saveAction(choice) === "delete") {
        return deleteAiAssistantSettings(orgId);
      }
      // `saveAction` returned "put", so the choice is a stored provider.
      const built = buildPutBody(choice === "platform" ? "off" : choice, model, apiKey);
      if (!built.ok) {
        setNotice(null);
        setError(built.message);
        return null;
      }
      return putAiAssistantSettings(orgId, built.body);
    },
    onSuccess: (dto) => {
      if (dto) {
        saved(dto, "Saved.");
      }
    },
    onError: (err: unknown) => {
      setNotice(null);
      setError(apiErrorMessage(err));
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteAiAssistantSettings(orgId),
    onSuccess: (dto) => {
      setChoice("platform");
      setModel("");
      saved(dto, "Removed. The platform default applies.");
    },
    onError: (err: unknown) => {
      setNotice(null);
      setError(apiErrorMessage(err));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const built = buildTestBody(choice, settings.platform, model, apiKey);
      if (!built.ok) {
        return built.message;
      }
      const result = await testAiAssistant(orgId, built.body);
      return testStatusSentence(result.status);
    },
    onSuccess: (sentence) => setTestResult(sentence),
    onError: (err: unknown) => setTestResult(apiErrorMessage(err)),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    saveMutation.mutate();
  }

  const keyEnabled = keyFieldEnabled(choice);
  // A stored key belongs to the provider it was saved with; the server clears
  // it when the provider changes, so the line shows only for that provider.
  const showKeyLine =
    settings.source === "organization" && keyEnabled && choice === settings.provider;
  const busy = saveMutation.isPending || removeMutation.isPending;

  return (
    <SectionCard title="Agent provider" bodyClassName="p-4 space-y-4">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-ink-muted">
          {settings.source === "organization"
            ? `This organization uses its own setting (${providerLabel(settings.provider)}).`
            : "This organization uses the platform default."}
        </p>
        <label className="block text-xs font-semibold text-ink-muted">
          Provider
          <select
            className="mt-1 w-full surface-field px-3 py-2 text-sm"
            value={choice}
            onChange={(event) => {
              const next = event.target.value as AiAssistantChoice;
              setChoice(next);
              // A model and a key belong to one provider: switching away shows
              // the new provider's default as the placeholder, and a key typed
              // for one provider is never sent to another.
              setModel(
                settings.source === "organization" && next === settings.provider
                  ? (settings.model ?? "")
                  : "",
              );
              setApiKey("");
              setTestResult(null);
              setNotice(null);
            }}
          >
            {AI_ASSISTANT_CHOICES.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {choice === "platform" ? (
          <p className="text-sm text-ink">{platformSummaryLine(settings.platform)}</p>
        ) : null}
        {choice === "off" ? (
          <p className="text-sm text-ink">Off: the guided mode answers, and no provider is called.</p>
        ) : null}
        <label className="block text-xs font-semibold text-ink-muted">
          Model
          <input
            className="mt-1 w-full surface-field px-3 py-2 font-mono text-sm disabled:opacity-60"
            value={model}
            placeholder={defaultModelPlaceholder(choice)}
            disabled={!keyEnabled}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="block text-xs font-semibold text-ink-muted">
          API key
          <input
            ref={keyRef}
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full surface-field px-3 py-2 font-mono text-sm disabled:opacity-60"
            value={apiKey}
            placeholder={showKeyLine && settings.keySet ? "Leave empty to keep the stored key" : ""}
            disabled={!keyEnabled}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {showKeyLine ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono text-ink">{keySetLine(settings)}</span>
            {settings.keySet ? (
              <button
                type="button"
                className="text-xs font-semibold text-accent-strong"
                onClick={() => keyRef.current?.focus()}
              >
                Replace
              </button>
            ) : null}
          </div>
        ) : null}
        {settings.source === "organization" ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            <button
              type="button"
              className="font-semibold text-critical-ink disabled:opacity-60"
              disabled={busy}
              onClick={() => removeMutation.mutate()}
            >
              Remove
            </button>
            <span>Deletes this organization&apos;s setting, key included; the platform default then applies.</span>
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="rounded border border-critical-line-strong bg-critical-wash p-3 text-sm text-critical-ink-strong"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-ink">
            {notice}
          </p>
        ) : null}
        {testResult ? (
          <p role="status" aria-label="Test result" className="text-sm text-ink">
            {testResult}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
            disabled={!testAvailable(choice, settings.platform.provider) || testMutation.isPending}
            aria-busy={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            Test
          </button>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            disabled={busy}
            aria-busy={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
