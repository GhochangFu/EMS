import {
  copilotClearEscalationDefaultsModelBodySchema,
  copilotCreateEscalationProfileModelBodySchema,
  copilotSetEscalationDefaultsModelBodySchema,
  createEscalationProfileBodySchema,
  setEscalationDefaultsBodySchema,
  updateEscalationProfileBodySchema,
} from "../../contracts/escalation-writes";
import {
  copilotCreateNotificationChannelModelBodySchema,
  copilotUpdateNotificationChannelModelBodySchema,
  createNotificationChannelBodySchema,
  setRuleNotificationsBodySchema,
  updateNotificationChannelBodySchema,
} from "../../contracts/notification-writes";
import { emptyBody, fieldList, plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F4.279` (ADR 0099 Amendment 8, D2–D8, Q11–Q13; owner rulings 2026-10-24
 * Q1–Q10) — the notification channels (`notifications.controller.ts`), the
 * escalation profiles and severity map (`escalation-profiles.controller.ts`)
 * and, by D8, the rule's channel set (`PUT /rules/:id/notifications`), beside
 * the channels it points at.
 *
 * The channel and escalation entries are offered to `admin` and
 * `organization_admin`, the two roles `canManageNotificationChannel` ever
 * admits; `rule.notifications.set` keeps the rule route's `configuration` class
 * (every copilot role). D2: the targets mirror exactly those gates.
 *
 * Q11, Q12: a webhook's `secret` and its URL (`config.url`, a nested
 * `clientOnly` path) are typed on the Confirm card and never reach the model,
 * the pending row, the history or the hash. Q6: the model proposes an email or
 * webhook channel whose `config` is an email recipient list at most. Q13: the
 * create names its organization; fleet-wide channels stay on the page.
 *
 * D5: every entry stores the card-only `recipients` — each channel's name,
 * kind and every address or URL in full, built by the server's proposal check
 * (`apps/api/src/notifications/notification-proposal-check.service.ts`), which
 * also appends a note with names and counts only to these summaries. The
 * summaries here never name an address.
 *
 * D3, Q1, Q2, Q5: each direction is its own entry — `.deactivate` (red) and
 * `.reactivate` on the channel PATCH; the test send is red (a real message
 * goes out) and is proposed only in a user turn whose own message asked (D4);
 * an empty severity map is the red `escalationDefaults.clear`. D6: the ladder
 * replace binds to the profile's `updatedAt`.
 */

const CHANNEL_ROW: CatalogTarget = { kind: "notificationChannel", param: "id" };
const PROFILE_ROW: CatalogTarget = { kind: "escalationProfile", param: "id" };
const NOTIFICATION_ORG: CatalogTarget = { kind: "organization", manage: "notification" };

/** The card-only key every entry here stores (D5). */
const RECIPIENTS = ["recipients"] as const;

/** The fields every channel and escalation entry shares. */
const FOR_CHANNEL_ADMINS = {
  offeredTo: ["admin", "organization_admin"],
  refs: [],
  formulas: [],
  cardOnly: RECIPIENTS,
} as const satisfies Partial<CatalogEntry>;

/** The fields every entry on the channel PATCH shares: one route, one body. */
const CHANNEL_PATCH = {
  ...FOR_CHANNEL_ADMINS,
  method: "PATCH",
  path: "/notifications/channels/:id",
  params: { id: uuidParam },
  body: updateNotificationChannelBodySchema,
  bodyName: "updateNotificationChannelBodySchema",
  target: CHANNEL_ROW,
} as const satisfies Partial<CatalogEntry>;

/** The fields the two severity-map entries share: one route, one body. */
const DEFAULTS_PUT = {
  ...FOR_CHANNEL_ADMINS,
  method: "PUT",
  path: "/admin/escalation-defaults",
  params: {},
  body: setEscalationDefaultsBodySchema,
  bodyName: "setEscalationDefaultsBodySchema",
  clientOnly: [],
  target: NOTIFICATION_ORG,
  steps: [{ id: "map", title: "Severity map", fields: ["organizationId", "items"] }],
} as const satisfies Partial<CatalogEntry>;

/** How many items an array field of the body holds. */
function countOf(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  return Array.isArray(value) ? value.length : 0;
}

export const NOTIFICATION_ENTRIES: readonly CatalogEntry[] = [
  {
    ...FOR_CHANNEL_ADMINS,
    id: "notificationChannel.create",
    title: "Create a notification channel",
    method: "POST",
    path: "/notifications/channels",
    params: {},
    body: createNotificationChannelBodySchema,
    bodyName: "createNotificationChannelBodySchema",
    modelBody: copilotCreateNotificationChannelModelBodySchema,
    modelBodyName: "copilotCreateNotificationChannelModelBodySchema",
    clientOnly: ["secret", "config.url"],
    risk: "create",
    target: NOTIFICATION_ORG,
    steps: [
      { id: "channel", title: "Channel", fields: ["organizationId", "code", "name", "kind", "enabled"] },
      { id: "delivery", title: "Delivery", fields: ["config"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the ${text(body, "kind", "notification")} channel ${quoted(text(body, "name"))} (${text(body, "code")}) in ${organizationName}.`,
  },
  {
    ...CHANNEL_PATCH,
    id: "notificationChannel.update",
    title: "Edit a notification channel",
    modelBody: copilotUpdateNotificationChannelModelBodySchema,
    modelBodyName: "copilotUpdateNotificationChannelModelBodySchema",
    clientOnly: ["secret", "config.url"],
    risk: "edit",
    // Q5: `enabled` is the two direction entries' (their `fixedBody`), so no step offers it.
    steps: [
      { id: "channel", title: "Channel", fields: ["name", "kind"] },
      { id: "delivery", title: "Delivery", fields: ["config"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the channel ${quoted(targetName)}.`,
  },
  {
    ...CHANNEL_PATCH,
    id: "notificationChannel.deactivate",
    title: "Disable a notification channel",
    clientOnly: [],
    fixedBody: { enabled: false },
    risk: "deactivate",
    steps: [],
    summary: ({ targetName }) =>
      `Disable the channel ${quoted(targetName)}: it delivers nothing until it is enabled again.`,
  },
  {
    ...CHANNEL_PATCH,
    id: "notificationChannel.reactivate",
    title: "Enable a notification channel",
    clientOnly: [],
    fixedBody: { enabled: true },
    risk: "edit",
    steps: [],
    summary: ({ targetName }) => `Enable the channel ${quoted(targetName)}: it delivers again.`,
  },
  {
    ...FOR_CHANNEL_ADMINS,
    id: "notificationChannel.test",
    title: "Send a test message",
    method: "POST",
    path: "/notifications/channels/:id/test",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    // Q1: red, because a real message goes out and the attempt is written to the ledger.
    risk: "deactivate",
    target: CHANNEL_ROW,
    steps: [],
    summary: ({ targetName }) =>
      `Send a test message through the channel ${quoted(targetName)} now: a real message goes to its recipients and the attempt is written to the delivery ledger.`,
  },
  {
    ...FOR_CHANNEL_ADMINS,
    id: "escalationProfile.create",
    title: "Create an escalation profile",
    method: "POST",
    path: "/admin/escalation-profiles",
    params: {},
    body: createEscalationProfileBodySchema,
    bodyName: "createEscalationProfileBodySchema",
    modelBody: copilotCreateEscalationProfileModelBodySchema,
    modelBodyName: "copilotCreateEscalationProfileModelBodySchema",
    clientOnly: [],
    risk: "create",
    target: NOTIFICATION_ORG,
    steps: [
      { id: "profile", title: "Profile", fields: ["organizationId", "code", "name"] },
      { id: "ladder", title: "Ladder", fields: ["steps"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the escalation profile ${quoted(text(body, "name"))} (${text(body, "code")}) with ${plural(countOf(body, "steps"), "step")} in ${organizationName}.`,
  },
  {
    ...FOR_CHANNEL_ADMINS,
    id: "escalationProfile.update",
    title: "Edit an escalation profile",
    method: "PATCH",
    path: "/admin/escalation-profiles/:id",
    params: { id: uuidParam },
    body: updateEscalationProfileBodySchema,
    bodyName: "updateEscalationProfileBodySchema",
    clientOnly: [],
    risk: "edit",
    target: PROFILE_ROW,
    // D6: the ladder is replaced whole, so the write binds to the stamp the card showed.
    precondition: "updatedAt",
    steps: [
      { id: "profile", title: "Profile", fields: ["name"] },
      { id: "ladder", title: "Ladder", fields: ["steps"] },
    ],
    summary: ({ body, targetName }) =>
      Array.isArray(body.steps)
        ? `Replace the ladder of the escalation profile ${quoted(targetName)} with ${plural(countOf(body, "steps"), "step")}${
            body.name === undefined ? "" : ` and rename it ${quoted(text(body, "name"))}`
          }.`
        : `Change ${fieldList(body)} of the escalation profile ${quoted(targetName)}.`,
  },
  {
    ...DEFAULTS_PUT,
    id: "escalationDefaults.set",
    title: "Set the severity map",
    modelBody: copilotSetEscalationDefaultsModelBodySchema,
    modelBodyName: "copilotSetEscalationDefaultsModelBodySchema",
    risk: "edit",
    summary: ({ body, organizationName }) =>
      `Set the severity map of ${organizationName} to ${plural(countOf(body, "items"), "severity", "severities")}; a severity it leaves out does not escalate.`,
  },
  {
    ...DEFAULTS_PUT,
    id: "escalationDefaults.clear",
    title: "Clear the severity map",
    modelBody: copilotClearEscalationDefaultsModelBodySchema,
    modelBodyName: "copilotClearEscalationDefaultsModelBodySchema",
    // D3, Q2: an empty map silences every severity, so it is its own red entry.
    risk: "deactivate",
    summary: ({ organizationName }) =>
      `Clear the severity map of ${organizationName}: no severity escalates until it is mapped again.`,
  },
  {
    id: "rule.notifications.set",
    title: "Set a rule's notification channels",
    method: "PUT",
    path: "/rules/:id/notifications",
    params: { id: uuidParam },
    body: setRuleNotificationsBodySchema,
    bodyName: "setRuleNotificationsBodySchema",
    clientOnly: [],
    cardOnly: RECIPIENTS,
    risk: "edit",
    target: { kind: "rule", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "channels", title: "Channels", fields: ["channelIds"] }],
    summary: ({ body, targetName }) => {
      const count = countOf(body, "channelIds");
      return count === 0
        ? `Set the notification channels of the rule ${quoted(targetName)} to none: the rule then notifies nobody.`
        : `Set the notification channels of the rule ${quoted(targetName)} to ${plural(count, "channel")}.`;
    },
  },
];

const NO_DELETE = "a hard DELETE is never in the catalog (decision 3)";

/** The notification routes that are not entries (Amendment 8, "Not in this amendment"). */
export const NOTIFICATION_PENDING: readonly ExcludedRoute[] = [
  { method: "DELETE", path: "/notifications/channels/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/escalation-profiles/:id", reason: NO_DELETE },
];
