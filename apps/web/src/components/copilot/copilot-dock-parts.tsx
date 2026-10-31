import type { CopilotLimit } from "../../api/copilot";
import { splitAttachmentRecords } from "../../lib/copilot-attachments";
import { COPILOT_ALL_ORGANIZATIONS } from "../../stores/copilot-store";

/**
 * `F4.292` — the copilot dock's small parts and fixed sentences, moved out of
 * `copilot-dock.tsx` to keep it under the §4.5 cap (each was there since
 * `F3.85` PR 7 or the row its comment names).
 */

/** The picker value for the global administrator's cross-organization scope. */
export const ALL_ORGANIZATIONS = COPILOT_ALL_ORGANIZATIONS;
export const ALL_ORGANIZATIONS_LABEL = "All organizations (platform key)";

/** The global administrator's organization pick (plan Q9); a change of pick starts a new conversation. */
export function OrganizationPicker({
  value,
  options,
  disabled,
  onPick,
}: {
  value: string;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onPick: (organizationId: string) => void;
}) {
  return (
    <div className="border-b border-line px-4 py-2">
      <select
        aria-label="Organization"
        value={value}
        onChange={(e) => onPick(e.target.value)}
        disabled={disabled}
        className="surface-field w-full px-2 py-1 text-xs"
      >
        <option value={ALL_ORGANIZATIONS}>{ALL_ORGANIZATIONS_LABEL}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The sentence a scope with no AI key shows instead of the input (decision 10). */
export const NOT_CONFIGURED_SENTENCE =
  "The copilot is on, but no AI key is set up for this scope yet. An administrator can add one on the organization's AI assistant page.";

/** The sentence a picked organization whose copilot is off shows instead of the input. */
export const SCOPE_OFF_SENTENCE = "The copilot is off for this organization.";

/** Above an empty thread. */
export const EMPTY_THREAD_SENTENCE =
  "Ask about alarms, assets, KPIs, locations, dashboards or health, or ask for a change to a dashboard, " +
  "a dashboard template or a KPI setting. A change is applied only when you confirm its card.";

/** The server-made onboarding commit's catalog id: a conversation shows one such card at a time. */
const ONBOARDING_COMMIT = "onboarding.commit";
/** `F3.24b`: the server-made discovery card's id, the commit card's twin (one open per conversation). */
export const ONBOARDING_DISCOVERY = "onboarding.discovery";
export const isServerMadeCard = (catalogId: string): boolean =>
  catalogId === ONBOARDING_COMMIT || catalogId === ONBOARDING_DISCOVERY;

/** "Onboard a site" needs an organization: the global administrator's cross-organization scope names none. */
export const ONBOARD_PICK_SENTENCE = "Pick an organization to onboard a site.";

/**
 * An app route as the server's `open_page` allow-list emits it: one leading
 * `/`, no `//`, no scheme, no query and no fragment. The server checks it
 * first; this is the client's own refusal of anything else.
 */
export const APP_ROUTE = /^\/(?!\/)[A-Za-z0-9_\-/]*$/;

/** A user bubble's content: the text, then the files it carried as a muted record. */
export function UserText({ content }: { content: string }) {
  const { text, records } = splitAttachmentRecords(content);
  if (records.length === 0) return <>{content}</>;
  return (
    <>
      <span>{text}</span>
      <ul aria-label="Attached files, not stored" className="mt-1 space-y-0.5 break-all text-[11px] text-on-accent/70">
        {records.map((record, i) => (
          <li key={i}>{record}</li>
        ))}
      </ul>
    </>
  );
}

/** The reset time of a daily limit, in the user's locale. */
export function formatCopilotReset(resetsAt: string): string {
  return new Date(resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function limitSentence(limit: CopilotLimit): string {
  const who =
    limit.scope === "user"
      ? "You have reached your daily copilot limit."
      : "This organization has reached its daily copilot limit.";
  return `${who} It resets at ${formatCopilotReset(limit.resetsAt)}.`;
}

/** The `ESKOM_SMOC.html` `#aiFab` bot mark, decorative: the button carries the label. */
export function BotIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
  );
}

/** The left side of the panel's header bar: the mark, the title and the scope line. */
export function DockTitle({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-accent text-on-accent">
        <BotIcon size={16} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Copilot</h2>
        <p className="truncate text-xs text-on-dark/70">Working in: {scopeLabel}</p>
      </div>
    </div>
  );
}
