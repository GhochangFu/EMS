import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { EscalationProfileDto, NotificationChannelDto } from "@bms/shared";

import { createEscalationProfile, type EscalationStepPayload, updateEscalationProfile } from "../../api/escalation";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { channelWizardEntry } from "./channel-wizard";

type StepForm = { afterMinutes: string; channelIds: string[] };
type ProfileForm = { code: string; name: string; steps: StepForm[] };

const STEP_DELAY_MESSAGE = "Enter the delay in minutes.";

function stepDelayInvalid(step: StepForm): boolean {
  const raw = step.afterMinutes.trim();
  return raw === "" || Number.isNaN(Number(raw));
}

function stepsToPayload(steps: readonly StepForm[]): EscalationStepPayload[] {
  return steps.map((step) => ({ afterMinutes: Number(step.afterMinutes.trim()), channelIds: step.channelIds }));
}

/** A ladder a copilot fill set, back into the inputs' text form. */
function stepsFromValues(value: unknown): StepForm[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((step) => {
    const record = typeof step === "object" && step !== null ? (step as Record<string, unknown>) : {};
    return {
      afterMinutes: typeof record.afterMinutes === "number" ? String(record.afterMinutes) : "",
      channelIds: Array.isArray(record.channelIds) ? record.channelIds.filter((id): id is string => typeof id === "string") : [],
    };
  });
}

export type EscalationProfileWizardProps = {
  /** The profile to edit; `null` for a new one. */
  profile: EscalationProfileDto | null;
  /** The organization a create is for — the page's own choice, fixed here. */
  organizationId: string;
  organizationName: string;
  /** The channels a step may name: the organization's own and the fleet-wide ones. */
  channels: readonly NotificationChannelDto[];
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

/**
 * `F4.279` (ADR 0099 decision 6, Amendment 8) — the Escalation page's profile
 * form on the shared `WizardShell`: `escalationProfile.create` and `.update`,
 * Profile → Ladder → Review. The values are the route's own body. A create's
 * organization is the page's choice, fixed (`fixedFields`): the severity map
 * beside it is that organization's. The ladder is replaced whole on an update,
 * so the copilot's card binds it to the profile's `updatedAt` (D6); the page's
 * own Submit sends no precondition.
 */
export function EscalationProfileWizard({ profile, organizationId, organizationName, channels, onCancel, onDone }: EscalationProfileWizardProps) {
  const [form, setForm] = useState<ProfileForm>(() =>
    profile
      ? {
          code: profile.code,
          name: profile.name,
          steps: profile.steps.map((step) => ({ afterMinutes: String(step.afterMinutes), channelIds: [...step.channelIds] })),
        }
      : { code: "", name: "", steps: [] },
  );
  const values: Record<string, unknown> = profile
    ? { name: form.name, steps: stepsToPayload(form.steps) }
    : { organizationId, code: form.code, name: form.name, steps: stepsToPayload(form.steps) };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      profile
        ? updateEscalationProfile({
            id: profile.id,
            patch: { name: body.name as string, steps: body.steps as EscalationStepPayload[] },
          })
        : createEscalationProfile({
            organizationId,
            code: body.code as string,
            name: body.name as string,
            steps: body.steps as EscalationStepPayload[],
          }),
    onSuccess: async () => onDone(),
  });
  const updateStep = (index: number, patch: Partial<StepForm>) =>
    setForm({ ...form, steps: form.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  const id = profile ? "escalationProfile.update" : "escalationProfile.create";
  const shared = {
    values,
    onChange: (next: Record<string, unknown>) =>
      setForm({
        code: typeof next.code === "string" ? next.code : form.code,
        name: typeof next.name === "string" ? next.name : form.name,
        steps: stepsFromValues(next.steps) ?? form.steps,
      }),
    renderStep: (step: { id: string }) =>
      step.id === "profile" ? (
        <>
          <p className="text-xs text-ink-muted">Organization: {organizationName}</p>
          <label className={labelClass}>
            Code
            <input
              className={fieldClass}
              value={form.code}
              disabled={profile !== null}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </label>
          <label className={labelClass}>
            Name
            <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
        </>
      ) : (
        <div className="space-y-2">
          {form.steps.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No steps yet. A profile with no ladder is legal — it escalates nothing until you add one.
            </p>
          ) : null}
          {form.steps.map((ladderStep, index) => (
            <fieldset key={index} className="surface-raised-sm px-3 py-2">
              <legend className="px-1 text-xs font-semibold uppercase text-ink-muted">Step {index + 1}</legend>
              <label className={labelClass}>
                After (minutes)
                <input
                  className="mt-1 w-40 surface-field px-3 py-1.5"
                  inputMode="numeric"
                  value={ladderStep.afterMinutes}
                  onChange={(event) => updateStep(index, { afterMinutes: event.target.value })}
                />
              </label>
              {stepDelayInvalid(ladderStep) ? <p className="mt-1 text-xs text-warning-ink">{STEP_DELAY_MESSAGE}</p> : null}
              <p className="mt-2 text-xs font-semibold uppercase text-ink-muted">Channels</p>
              {channels.length === 0 ? (
                <p className="mt-1 text-xs text-ink-muted">
                  No channels you can use here. Create one under Administration → Notifications → Channels.
                </p>
              ) : null}
              <div className="mt-1 space-y-1">
                {channels.map((channel) => {
                  const inputId = `step-${index}-channel-${channel.id}`;
                  return (
                    <label key={channel.id} htmlFor={inputId} className="flex items-center gap-2 text-xs text-ink">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={ladderStep.channelIds.includes(channel.id)}
                        onChange={() =>
                          updateStep(index, {
                            channelIds: ladderStep.channelIds.includes(channel.id)
                              ? ladderStep.channelIds.filter((other) => other !== channel.id)
                              : [...ladderStep.channelIds, channel.id],
                          })
                        }
                      />
                      {channel.enabled ? channel.name : `${channel.name} (disabled)`}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-critical-ink"
                onClick={() => setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })}
              >
                Remove step
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="surface-button px-3 py-1.5"
            onClick={() => setForm({ ...form, steps: [...form.steps, { afterMinutes: "", channelIds: [] }] })}
          >
            Add step
          </button>
        </div>
      ),
    onSubmit: (body: Record<string, unknown>) => {
      if (!form.steps.some(stepDelayInvalid)) save.mutate(body);
    },
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
    summary: channelWizardEntry(id).summary({
      body: values,
      params: profile ? { id: profile.id } : {},
      targetName: profile?.name ?? "",
      organizationName,
    }),
  };
  return profile ? (
    <AdminWizardFrame title="Edit an escalation profile">
      <WizardShell
        entry={channelWizardEntry("escalationProfile.update")}
        {...shared}
        params={{ id: profile.id }}
        current={{ name: profile.name, steps: stepsToPayload(profile.steps.map((s) => ({ afterMinutes: String(s.afterMinutes), channelIds: s.channelIds }))) }}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Create an escalation profile">
      <WizardShell entry={channelWizardEntry("escalationProfile.create")} {...shared} params={{}} fixedFields={["organizationId"]} />
    </AdminWizardFrame>
  );
}
