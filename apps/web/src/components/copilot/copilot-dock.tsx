import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  CopilotConversationDetailDto,
  CopilotMessageDto,
  CopilotPendingChangeDto,
  CopilotSkillStateDto,
  CopilotTurnResponseDto,
  OnboardingDraftListDto,
} from "@bms/shared";
import {
  COPILOT_ATTACHMENTS_MAX,
  COPILOT_TURN_MESSAGE_MAX,
  MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES,
} from "@bms/shared/contracts";

import { fetchOnboardingSession } from "../../api/admin/onboarding";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  copilotLimitOf,
  createCopilotConversation,
  endCopilotOnboardingSkill,
  fetchCopilotStatus,
  sendCopilotTurn,
  startCopilotOnboardingSkill,
  type CopilotLimit,
} from "../../api/copilot";
import { canAccessOnboarding, canAuthorDashboards } from "../../lib/admin-access";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { ATTACHMENT_EXTENSIONS, attachmentProblem, sizeLabel, splitAttachmentRecords, unscrubbedSentence } from "../../lib/copilot-attachments";
import { isPdfFile, prepareChosenFiles, renderedPageCount, withoutEach, type PreparedFile } from "../../lib/copilot-pdf-page";
import { ONBOARDING_DRAFTS, onboardingDraftsKey } from "../../lib/copilot-invalidations";
import type { AuthUser } from "../../stores/auth-store";
import {
  COPILOT_ALL_ORGANIZATIONS,
  copilotConversationKey,
  useCopilotSession,
  useCopilotStore,
} from "../../stores/copilot-store";
import { useWizardStore } from "../../stores/wizard-store";
import { AssistantText } from "./assistant-text";
import { ConfirmCard } from "./confirm-card";
import { OnboardingDraftPicker, type OnboardingDraftsOf } from "./onboarding-draft-picker";
import { OnboardingSkillPanel } from "./onboarding-skill-panel";
import { appendMessages, awaitingAfterConfirm, FOLLOW_UP_POLL_MS, FOLLOW_UP_WAIT_MS, receivedThread, useConversationThread } from "./use-conversation-thread";

/**
 * `F3.85` PR 7 (ADR 0099 decisions 1, 5, 10; plan §9.2) — the administrator
 * copilot's floating button and slide-out panel, in the `ESKOM_SMOC.html`
 * `#aiFab` / `#aiPanel` shape.
 *
 * **Who sees it.** A copilot role (`canAuthorDashboards` — the four roles of
 * the server's `COPILOT_ROLES`) whose `GET /copilot/status` says `available`.
 * The role check runs before any hook, so an operator never asks (the route
 * would answer 403). `available: false` renders nothing (plan Q7).
 *
 * **Layering.** `z-50`, below `ConfirmDialog`'s `z-[60]`, so a Confirm card
 * always covers the panel.
 *
 * **Scope.** A scoped administrator's conversation is bound to the home
 * organization on the server, whatever the dock sends. The global
 * administrator picks an organization (plan Q9), defaulting to every
 * organization on the platform key; a change of pick starts a new
 * conversation, because the server reads the organization from the
 * conversation row (decision 10) and a kept thread would go on to the old one.
 *
 * **A refusal stores nothing** (ADR 0022): a turn whose `messages` is empty
 * puts its `reply` in the banner. The input is not restored — for a
 * credential the whole string can be the secret (the skill panel's input does the same).
 *
 * **`open_page` navigates through the router only**, never `window.location`.
 *
 * **Changes are cards** (`F3.85` PR 8, decision 4). A turn's
 * `pendingChanges` and the conversation's own open changes render as
 * Confirm cards below the thread; Confirm sends the real request, Reject the
 * reject route. After a Confirm the dock polls the conversation every
 * {@link FOLLOW_UP_POLL_MS} ms, for at most {@link FOLLOW_UP_WAIT_MS} ms, until
 * the follow-up turn's messages arrive (decision 4.7) — with any next card.
 * `F4.244`: the wait lives in `useConversationThread` and is armed from the
 * detail's `awaitingFollowUp` on every mount; the Confirm seeds that field
 * into the cache, so a remount before the first poll needs no read. A
 * turn's `fillStep` goes to `useWizardStore` for an open wizard.
 *
 * **The onboarding skill** (`F3.86` PR 6, decision 7). "Onboard a site"
 * starts it in the conversation (a role that may onboard, an organization the
 * conversation is bound to, the dock available there — ruling Q4). While the
 * conversation's `skill` is set, `OnboardingSkillPanel` renders the
 * onboarding session's thread, its controls and the Confirm cards, and the
 * input stays open even with no AI key (the onboarding's guided mode answers).
 * A turn's `skill` key replaces the state (`null` ends the skill); a turn
 * with no such key (a credential refusal) keeps the last state.
 *
 * **Drafts** (`F4.255`, ADR 0099 Amendment 2 A1). Beside the start,
 * `OnboardingDraftPicker` lists the organization's open drafts with Resume —
 * the same `startSkill` mutation, with the draft's id. The organization is the
 * one the skill would start in: the global administrator's pick (none on "All
 * organizations": nothing is read and Start is disabled); a scoped
 * administrator's conversation's, or — before there is a conversation — the
 * home organization the server binds one to (the list names none and the
 * server answers for it). A start, a resume, a refused resume, an End and a
 * turn that ends the skill make every list stale; a refused resume (409
 * closed, 404) is the banner's start error.
 *
 * **"Onboard with AI"** (`F3.86` PR 7, ruling Q5) files a one-shot request in
 * `useCopilotStore`; the dock consumes it once, opens, picks the organization
 * (the global administrator) and starts the skill through the same
 * `startSkill` mutation as "Onboard a site" — only when the conversation has no
 * skill (the server's bind refuses a second) and the organization's copilot is
 * on (otherwise the off sentence shows and nothing starts, ruling Q4).
 *
 * **The session survives a route change.** Each page renders its own
 * `AppShell`, so a navigation — `open_page`'s own included — unmounts the
 * dock. The conversation and the pick live in `useCopilotStore`, and the
 * thread in the Query cache under `copilotConversationKey`: a turn writes its
 * messages there, and a remount reads them back. `fetchCopilotConversation`
 * loads them when that cache entry was evicted while the dock was unmounted,
 * and after a reload or in a new tab: `F4.244` (owner ruling 2026-10-20) keeps
 * the session in `localStorage`, so both resume the stored conversation, and a
 * stored conversation the server no longer has (404: purged or deleted) is
 * dropped and the next send starts a fresh one.
 *
 * **Files** (`F3.87` PR 8, ADR 0099 Amendment 3 A4, A7; plan §10, D2). The
 * attach control beside the composer renders only when the scope's status says
 * `attachmentsEnabled` (a key, and that one organization's copilot and
 * attachment switches on — so never with no key, in the guided mode, or with
 * the switch off), no skill is bound (the skill panel has its own composer),
 * and the conversation is bound to one organization. Its label and title say
 * the file goes to the organization's AI provider unscrubbed. The picker
 * refuses a type outside {@link ATTACHMENT_EXTENSIONS}, a file over 10 MB (an
 * `.svg` over 64 KB: it is a symbol candidate), files over 10 MB together
 * (owner ruling 2026-10-16) and a fourth file; the server
 * re-checks every one by the bytes. The stored user row's `[Attachment …; not
 * stored]` lines render under the text as a muted record.
 */

/** The `localStorage` key that holds whether the panel is open. */
export const COPILOT_OPEN_KEY = "bms-copilot-open";

/** The picker value for the global administrator's cross-organization scope. */
const ALL_ORGANIZATIONS = COPILOT_ALL_ORGANIZATIONS;
const ALL_ORGANIZATIONS_LABEL = "All organizations (platform key)";

/** The sentence a scope with no AI key shows instead of the input (decision 10). */
const NOT_CONFIGURED_SENTENCE =
  "The copilot is on, but no AI key is set up for this scope yet. An administrator can add one on the organization's AI assistant page.";

/** The sentence a picked organization whose copilot is off shows instead of the input. */
const SCOPE_OFF_SENTENCE = "The copilot is off for this organization.";

/** The server-made onboarding commit's catalog id: a conversation shows one such card at a time. */
const ONBOARDING_COMMIT = "onboarding.commit";
/** `F3.24b`: the server-made discovery card's id, the commit card's twin (one open per conversation). */
const ONBOARDING_DISCOVERY = "onboarding.discovery";
const isServerMadeCard = (catalogId: string): boolean => catalogId === ONBOARDING_COMMIT || catalogId === ONBOARDING_DISCOVERY;

/** "Onboard a site" needs an organization: the global administrator's cross-organization scope names none. */
const ONBOARD_PICK_SENTENCE = "Pick an organization to onboard a site.";

/**
 * An app route as the server's `open_page` allow-list emits it: one leading
 * `/`, no `//`, no scheme, no query and no fragment. The server checks it
 * first; this is the client's own refusal of anything else.
 */
const APP_ROUTE = /^\/(?!\/)[A-Za-z0-9_\-/]*$/;

/** A user bubble's content: the text, then the files it carried as a muted record. */
function UserText({ content }: { content: string }) {
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

function limitSentence(limit: CopilotLimit): string {
  const who =
    limit.scope === "user"
      ? "You have reached your daily copilot limit."
      : "This organization has reached its daily copilot limit.";
  return `${who} It resets at ${formatCopilotReset(limit.resetsAt)}.`;
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(COPILOT_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(COPILOT_OPEN_KEY, open ? "true" : "false");
  } catch {
    // A storage the browser refuses only costs the remembered state.
  }
}

/** The `ESKOM_SMOC.html` `#aiFab` bot mark, decorative: the button carries the label. */
function BotIcon({ size }: { size: number }) {
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

type CopilotDockProps = { user: AuthUser };

export function CopilotDock({ user }: CopilotDockProps) {
  if (!canAuthorDashboards(user.role)) {
    return null;
  }
  return <AvailableDock user={user} />;
}

/** Asks the status once; renders nothing until it says `available`. */
function AvailableDock({ user }: CopilotDockProps) {
  const status = useQuery({
    queryKey: ["copilot", "status", "home"],
    queryFn: () => fetchCopilotStatus(),
    staleTime: 60_000,
  });
  if (status.data?.available !== true) {
    return null;
  }
  return (
    <DockPanel
      user={user}
      homeConfigured={status.data.configured}
      // An absent flag is false (fail closed; the schema keeps it optional for older stubs).
      homeAttachments={status.data.attachmentsEnabled === true}
    />
  );
}

function DockPanel({
  user,
  homeConfigured,
  homeAttachments,
}: CopilotDockProps & { homeConfigured: boolean; homeAttachments: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // `F4.245`: a fill waiting for the page `open_page` opened is dropped once the user is elsewhere.
  useEffect(() => useWizardStore.getState().leavePage(pathname), [pathname]);
  const queryClient = useQueryClient();
  const isGlobalAdmin = user.role === "admin";
  const [open, setOpen] = useState(readOpen);
  const { organizationId, conversationId } = useCopilotSession(user.id);
  const pickInStore = useCopilotStore((s) => s.pick);
  const setConversation = useCopilotStore((s) => s.setConversation);
  // The turn writes its messages into the thread's cache entry; the server load is the fallback.
  // `followUp` is set while the confirmed change's follow-up turn runs (`F4.244`: armed from the thread).
  // `failed` (`F3.86` PR 2): the route refused the confirmed change; the follow-up turn still runs.
  const { thread, messages, pendingChanges, skill, followUp } = useConversationThread(conversationId);
  // `F3.86` PR 2: cards whose route refused the change. The server no longer lists them (the row is
  // `failed`), but the card keeps the route's sentence — and a site layout's candidates — on screen
  // until the next message.
  const [kept, setKept] = useState<CopilotPendingChangeDto[]>([]);
  const cards = [...pendingChanges, ...kept.filter((k) => !pendingChanges.some((c) => c.id === k.id))];
  const receiveFill = useWizardStore((s) => s.receiveFill);
  const [input, setInput] = useState("");
  // `F3.86` PR 6 review: the skill panel's undo is a write too (F3.25, one write at a time): Send waits for it.
  const [skillUndoing, setSkillUndoing] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);
  const [turnNotConfigured, setTurnNotConfigured] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const organizations = useQuery({
    queryKey: ["copilot", "organizations"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: open && isGlobalAdmin,
    staleTime: 60_000,
  });

  const picked = organizationId !== ALL_ORGANIZATIONS;
  const scopedStatus = useQuery({
    queryKey: ["copilot", "status", organizationId],
    queryFn: () => fetchCopilotStatus(organizationId),
    enabled: open && picked,
  });

  // `undefined` while a picked organization's status loads: neither the input nor the sentence yet.
  const scope = picked
    ? scopedStatus.data
    : { available: true, configured: homeConfigured, attachmentsEnabled: homeAttachments };
  const scopeOff = scope?.available === false;
  const configured = scope === undefined ? undefined : scope.configured && !turnNotConfigured;
  const scopeLabel = isGlobalAdmin
    ? picked
      ? (organizations.data?.items.find((o) => o.id === organizationId)?.name ?? "the selected organization")
      : ALL_ORGANIZATIONS_LABEL
    : "your organization";

  // `F3.87` PR 8 (plan D2): a file needs a conversation bound to one organization. Before there is one,
  // the global administrator's pick names it and a scoped administrator's home does; after, the row
  // says (unknown while it loads: no control).
  const boundToOneOrganization =
    conversationId === null
      ? !isGlobalAdmin || picked
      : thread.data !== undefined && thread.data.organizationId !== null;
  const attachAllowed =
    skill === null && configured === true && scope?.attachmentsEnabled === true && boundToOneOrganization;
  const [files, setFiles] = useState<File[]>([]);
  // `F4.269`: a PDF pick resolves after its page render, so it adds to the files of that moment, and
  // a drop below (the epoch moves) discards a render still in flight.
  const filesRef = useRef(files);
  filesRef.current = files;
  const dropEpoch = useRef(0);
  // The names of the PDFs whose page render is in flight: each shows a chip, and Send waits for them.
  const [rendering, setRendering] = useState<string[]>([]);
  // The scope moved away from one that takes files (a pick, a skill, a refused key): drop the chosen ones.
  useEffect(() => {
    if (!attachAllowed) setFiles([]);
    dropEpoch.current += 1;
  }, [attachAllowed]);
  // A pick of another organization drops them too, even when `attachAllowed` never goes false: the
  // new organization's status can be cached as on, and the user agreed only to the old one's provider.
  useEffect(() => {
    setFiles([]);
    dropEpoch.current += 1;
  }, [organizationId]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [messages, cards.length, banner]);

  // `F4.244`: a stored conversation the server no longer has (purged, deleted: 404) is dropped, and
  // the next send starts a fresh one; the pick stays. A 404 is not retried, so this runs at once.
  const notFound = conversationId !== null && thread.error instanceof ApiError && thread.error.status === 404;
  useEffect(() => {
    if (notFound) pickInStore(user.id, organizationId);
  }, [notFound, pickInStore, user.id, organizationId]);

  /** Writes into the thread's cache entry: the dock unmounts on navigation, the cache does not. */
  function updateThread(change: (prev: CopilotConversationDetailDto) => CopilotConversationDetailDto): void {
    if (conversationId === null) return;
    queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(conversationId), (prev) =>
      prev ? change(prev) : prev,
    );
  }

  function withoutChange(prev: CopilotConversationDetailDto, id: string): CopilotConversationDetailDto {
    return { ...prev, pendingChanges: prev.pendingChanges.filter((c) => c.id !== id) };
  }

  /** A turn's or an onboarding answer's skill state, into the thread's cache entry (`null` ends the skill). */
  function setSkill(id: string, next: CopilotSkillStateDto | null): void {
    queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(id), (prev) =>
      prev ? { ...prev, skill: next } : prev,
    );
    // `F3.86` PR 6 review: a skill no longer on a draft (committed by the drawer's wizard or elsewhere,
    // or ended) leaves no live commit card; the server rejects it at the next read too.
    if (next === null || next.session.status !== "draft") dropCommitCards(id);
  }

  /** Drops the `onboarding.commit` cards, cached and kept: their Confirm could only answer 400 now. */
  function dropCommitCards(id: string): void {
    queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(id), (prev) =>
      prev ? { ...prev, pendingChanges: prev.pendingChanges.filter((c) => !isServerMadeCard(c.catalogId)) } : prev,
    );
    setKept((prev) => prev.filter((c) => !isServerMadeCard(c.catalogId)));
  }

  /** The conversation the skill route answered, in the cache: its messages, open changes and skill. */
  function putConversation(detail: CopilotConversationDetailDto): void {
    void queryClient.cancelQueries({ queryKey: copilotConversationKey(detail.id) });
    queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(detail.id), receivedThread(detail));
  }

  /**
   * `F4.244`: the follow-up is awaited from the cache, so a remount before the first poll holds Send.
   * A read in flight (an earlier poll, a `gone()` invalidation, a focus read) is cancelled first:
   * it began before the change was recorded, and its answer would overwrite the seed (review C4).
   */
  function awaitFollowUp(change: CopilotPendingChangeDto, status: "applied" | "failed"): void {
    if (conversationId === null) return;
    void queryClient.cancelQueries({ queryKey: copilotConversationKey(conversationId) });
    updateThread((prev) => awaitingAfterConfirm(prev, change.id, status));
  }

  function applied(change: CopilotPendingChangeDto): void {
    awaitFollowUp(change, "applied");
    // `F3.24b`: a confirmed discovery is queued; reading the session starts the skill panel's status poll at once.
    if (change.catalogId === ONBOARDING_DISCOVERY && skill !== null && conversationId !== null) {
      const id = conversationId;
      void fetchOnboardingSession(skill.session.id).then((fresh) => setSkill(id, { ...skill, session: fresh }), () => undefined);
    }
  }

  /** A focus read in flight began before the Reject; its answer would bring the card back. */
  function rejected(change: CopilotPendingChangeDto, stored: CopilotMessageDto[]): void {
    if (conversationId !== null) void queryClient.cancelQueries({ queryKey: copilotConversationKey(conversationId) });
    updateThread((prev) => ({ ...withoutChange(prev, change.id), messages: appendMessages(prev.messages, stored) }));
  }

  function gone(): void {
    if (conversationId !== null) void queryClient.invalidateQueries({ queryKey: copilotConversationKey(conversationId) });
  }

  /** The route refused the confirmed change: keep its card, and wait for the follow-up as after an apply. */
  function routeFailed(change: CopilotPendingChangeDto): void {
    setKept((prev) => (prev.some((k) => k.id === change.id) ? prev : [...prev, change]));
    awaitFollowUp(change, "failed");
  }

  // A new conversation starts with no kept cards.
  useEffect(() => {
    setKept([]);
  }, [conversationId]);

  // `F4.255`: a scoped administrator's first conversation moves the draft list's key from "home" to the
  // organization the server bound it to — the same organization — so the list carries over instead of
  // blanking while it reloads (a pending Resume keeps its row).
  function carryHomeDrafts(bound: string | null): void {
    if (isGlobalAdmin || bound === null) return;
    const home = queryClient.getQueryData<OnboardingDraftListDto>(onboardingDraftsKey());
    if (home !== undefined && queryClient.getQueryData(onboardingDraftsKey(bound)) === undefined) {
      queryClient.setQueryData(onboardingDraftsKey(bound), home);
    }
  }

  const turn = useMutation({
    mutationFn: async ({ message, files }: { message: string; files: readonly File[] }): Promise<CopilotTurnResponseDto> => {
      let id = conversationId;
      if (id === null) {
        const created = await createCopilotConversation(isGlobalAdmin && picked ? organizationId : null);
        id = created.id;
        // Seed the thread before the id is published, so no load races the turn's write.
        queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(id), {
          ...created,
          messages: [],
          pendingChanges: [],
        });
        carryHomeDrafts(created.organizationId);
        setConversation(user.id, id);
      }
      // `F4.245` (ADR 0099 Amendment 4): the wizards open now, read at send time, one per record.
      return sendCopilotTurn(id, message, files, useWizardStore.getState().openWizards());
    },
    onSuccess: (data, sent) => {
      // The files went with the turn; a refused send (onError) keeps them for another try. Only those:
      // a page render that landed during the send stays for the next one.
      if (sent.files.length > 0) setFiles((prev) => prev.filter((f) => !sent.files.includes(f)));
      // Before any cache write, the early skill write included: a focus read that began before the turn stored its rows must not overwrite them.
      void queryClient.cancelQueries({ queryKey: copilotConversationKey(data.conversationId) });
      // Before any early return: a skill state answers even when nothing was stored (a closed or lost session).
      if (data.skill !== undefined) setSkill(data.conversationId, data.skill);
      // `F4.255`: the skill ended (lost or done: `null`) or its session is no longer a draft (the closed reply):
      // its draft may be listed again, or gone. A plain turn carries no `skill` key and reads nothing.
      if (data.skill === null || (data.skill !== undefined && data.skill.session.status !== "draft")) {
        void queryClient.invalidateQueries({ queryKey: ONBOARDING_DRAFTS });
      }
      if (data.outcome === "not_configured") {
        setTurnNotConfigured(true);
        setBanner(null);
        return;
      }
      // Nothing stored (a credential refusal, a failed turn): the transcript
      // does not grow, so the reply would render nowhere without the banner.
      if (data.messages.length === 0) {
        setBanner(data.reply);
        return;
      }
      setBanner(null);
      // Into the cache, not component state: `navigate` below unmounts this dock.
      queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(data.conversationId), (prev) =>
        prev
          ? {
              ...prev,
              // A focus read that answered before this response may hold these rows already.
              messages: appendMessages(prev.messages, data.messages),
              pendingChanges: [
                ...prev.pendingChanges.filter(
                  (c) =>
                    !data.pendingChanges.some((n) => n.id === c.id) &&
                    // `F3.86` PR 6: a new onboarding commit card replaces the old one (the server discarded it).
                    !(isServerMadeCard(c.catalogId) && data.pendingChanges.some((n) => n.catalogId === c.catalogId)),
                ),
                ...data.pendingChanges,
              ],
            }
          : prev,
      );
      const route = data.navigateTo !== null && APP_ROUTE.test(data.navigateTo) ? data.navigateTo : null;
      if (data.fillStep !== null) {
        // `F4.245`: a fill for a record no wizard shows waits only for the page this turn opens.
        receiveFill(data.fillStep, route);
      }
      if (route !== null) {
        navigate(route);
      }
    },
    onError: (err: Error) => {
      const limit = copilotLimitOf(err);
      setBanner(limit ? limitSentence(limit) : apiErrorMessage(err));
    },
  });

  // `F3.86` PR 6: the onboarding skill starts in the conversation, which is made first when there is none.
  // `F4.255`: with a draft's id it resumes that draft; a new start passes no third argument at all.
  const startSkill = useMutation({
    mutationFn: async (sessionId?: string): Promise<CopilotConversationDetailDto> => {
      let id = conversationId;
      let organization = thread.data?.organizationId ?? null;
      if (id === null) {
        const created = await createCopilotConversation(isGlobalAdmin && picked ? organizationId : null);
        id = created.id;
        organization = created.organizationId;
        queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(id), {
          ...created,
          messages: [],
          pendingChanges: [],
        });
        carryHomeDrafts(created.organizationId);
        setConversation(user.id, id);
      }
      if (organization === null) throw new Error(ONBOARD_PICK_SENTENCE);
      return sessionId === undefined
        ? startCopilotOnboardingSkill(id, organization)
        : startCopilotOnboardingSkill(id, organization, sessionId);
    },
    onSuccess: (detail) => {
      setBanner(null);
      putConversation(detail);
      // The prefix: a scoped start from no conversation listed its drafts under "home", not the organization's id.
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_DRAFTS });
    },
    onError: (err: Error, sessionId) => {
      setBanner(apiErrorMessage(err));
      // `F4.255`: a refused resume (409 closed, 404) means the listed row is dead: read the list again.
      if (sessionId !== undefined) void queryClient.invalidateQueries({ queryKey: ONBOARDING_DRAFTS });
    },
  });

  const endSkill = useMutation({
    mutationFn: () => endCopilotOnboardingSkill(conversationId as string),
    onSuccess: (detail) => {
      setBanner(null);
      putConversation(detail);
      dropCommitCards(detail.id);
      // The ended draft is a draft still (ruling 3): the list shows it again.
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_DRAFTS });
    },
    onError: (err: Error) => setBanner(apiErrorMessage(err)),
  });

  // A turn, a follow-up or the skill panel's undo is in flight: Send waits.
  const busy = turn.isPending || followUp !== null || skillUndoing;

  // A global admin onboards in the organization picked above; "All organizations" names none.
  const canOnboard = canAccessOnboarding(user.role) && !scopeOff;
  const onboardBlocked = isGlobalAdmin && !picked;
  // `F4.255`: the drafts of the organization a start would use. A scoped administrator's conversation is
  // bound to its home organization, so before there is one the list names none ("home").
  const threadOrganization = thread.data?.organizationId ?? null;
  const draftsOf: OnboardingDraftsOf = isGlobalAdmin
    ? picked
      ? { organizationId }
      : null
    : conversationId === null
      ? "home"
      : threadOrganization === null
        ? null
        : { organizationId: threadOrganization };

  // `F3.86` PR 7: "Onboard with AI" files a one-shot request. `onboardRequest` (the store) wakes this
  // effect; `consumeOnboardRequest` takes it out of the store, so a re-render, a second effect run
  // (StrictMode) or a remount finds none and starts nothing twice. `onboardFor` is the organization
  // the start now waits on (its scope status, the thread's skill).
  const onboardRequest = useCopilotStore((s) => s.onboardRequest);
  const consumeOnboardRequest = useCopilotStore((s) => s.consumeOnboardRequest);
  const [onboardFor, setOnboardFor] = useState<string | null>(null);
  useEffect(() => {
    if (onboardRequest === null) return;
    const request = consumeOnboardRequest(user.id);
    if (request === null || !canAccessOnboarding(user.role)) return;
    setOpen(true);
    writeOpen(true);
    setBanner(null);
    // Keep the conversation when it is already in that organization: a pick would drop it (and its skill).
    if (isGlobalAdmin && organizationId !== request.organizationId) {
      pickInStore(user.id, request.organizationId);
      setTurnNotConfigured(false);
    }
    setOnboardFor(request.organizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request alone: it is consumed once
  }, [onboardRequest]);
  useEffect(() => {
    if (onboardFor === null) return;
    // The pick has not landed yet (the global administrator's store write re-renders this component).
    if (isGlobalAdmin && organizationId !== onboardFor) return;
    if (isGlobalAdmin && scopedStatus.isError) {
      setOnboardFor(null);
      return;
    }
    // The picked organization's status, or the existing conversation's thread, is still loading.
    if (scope === undefined) return;
    if (conversationId !== null && thread.isError) {
      setOnboardFor(null);
      return;
    }
    if (conversationId !== null && thread.data === undefined) return;
    setOnboardFor(null);
    // The copilot is off there (ruling Q4): the dock's off sentence shows; a bound skill is never started twice.
    if (scope.available === false || thread.data?.skill != null || startSkill.isPending) return;
    startSkill.mutate(undefined);
  }, [onboardFor, organizationId, isGlobalAdmin, scope, scopedStatus.isError, conversationId, thread.data, thread.isError, startSkill]);

  function toggle(): void {
    setOpen((was) => {
      writeOpen(!was);
      return !was;
    });
  }

  function pick(next: string): void {
    pickInStore(user.id, next);
    setBanner(null);
    setTurnNotConfigured(false);
  }

  function sendText(raw: string, withFiles = false): void {
    const text = raw.trim();
    if (!text || busy) {
      return;
    }
    setKept([]);
    // The skill panel's sends carry no file; the composer's carry the chips while the scope takes them.
    turn.mutate({ message: text, files: withFiles && attachAllowed ? files : [] });
  }

  /**
   * The picker's client checks: the type by extension, the size, and at most three files a message.
   * `F4.269` (ADR 0105): a PDF that passes is rendered first and its page-1 PNG is checked and sent in its place.
   */
  function onChooseFiles(e: ChangeEvent<HTMLInputElement>): void {
    const chosen = Array.from(e.target.files ?? []);
    // The same file chosen again after a removal must fire `change` again.
    e.target.value = "";
    if (!chosen.some(isPdfFile)) {
      addChosen(chosen.map((file) => ({ file, problem: attachmentProblem(file) })));
      return;
    }
    const epoch = dropEpoch.current;
    const pdfs = chosen.filter(isPdfFile).map((file) => file.name);
    setRendering((prev) => [...prev, ...pdfs]);
    void prepareChosenFiles(chosen)
      .then((prepared) => {
        if (epoch === dropEpoch.current) addChosen(prepared, true);
      })
      .finally(() => setRendering((prev) => withoutEach(prev, pdfs)));
  }

  /** A render that lands later (`late`) only adds its own problems; it never clears another banner. */
  function addChosen(chosen: readonly PreparedFile[], late = false): void {
    const next = [...filesRef.current];
    const problems: string[] = [];
    let overCount = false;
    let overTotal = false;
    let total = next.reduce((sum, file) => sum + file.size, 0);
    for (const { file, problem } of chosen) {
      if (problem !== null) problems.push(problem);
      else if (next.length >= COPILOT_ATTACHMENTS_MAX) overCount = true;
      // Owner ruling 2026-10-16: the files of one message together stay within 10 MB (the server checks too).
      else if (total + file.size > MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES) overTotal = true;
      else {
        next.push(file);
        total += file.size;
      }
    }
    if (overCount) problems.push(`A message can carry at most ${COPILOT_ATTACHMENTS_MAX} files.`);
    if (overTotal) problems.push(`The files of one message may be at most ${sizeLabel(MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES)} together.`);
    filesRef.current = next;
    setFiles(next);
    if (problems.length > 0) setBanner(problems.join(" "));
    else if (!late) setBanner(null);
  }

  function removeFile(index: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function submit(): void {
    if (!input.trim() || busy || rendering.length > 0) {
      return;
    }
    sendText(input, true);
    setInput("");
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const cardList = cards.map((change) => (
    <ConfirmCard
      key={change.id}
      change={change}
      onApplied={applied}
      onRejected={rejected}
      onGone={gone}
      onRouteFailed={routeFailed}
    />
  ));
  const progress = (
    <>
      {turn.isPending && <div className="text-xs text-ink-muted">Copilot is thinking…</div>}
      {followUp !== null && !turn.isPending && (
        <div className="text-xs text-ink-muted">
          {followUp.failed ? "Not applied. Waiting for the copilot…" : "Applied. Waiting for the copilot…"}
        </div>
      )}
    </>
  );

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close the copilot" : "Open the copilot"}
        aria-expanded={open}
        aria-controls="copilot-panel"
        onClick={toggle}
        className="fixed bottom-10 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent text-sm font-bold text-on-accent shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <BotIcon size={22} />
      </button>

      {open && (
        <aside
          id="copilot-panel"
          aria-label="Copilot"
          className="surface-raised fixed bottom-28 right-6 z-50 flex h-[520px] max-h-[calc(100vh-8rem)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg"
        >
          <header className="flex items-start justify-between gap-2 border-b border-line bg-chrome px-4 py-3 text-on-dark">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-accent text-on-accent">
                <BotIcon size={16} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Copilot</h2>
                <p className="truncate text-xs text-on-dark/70">Working in: {scopeLabel}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close the copilot panel"
              onClick={toggle}
              className="rounded px-2 text-on-dark/70 hover:text-on-dark"
            >
              ×
            </button>
          </header>

          {isGlobalAdmin && (
            <div className="border-b border-line px-4 py-2">
              <select
                aria-label="Organization"
                value={organizationId}
                onChange={(e) => pick(e.target.value)}
                disabled={turn.isPending}
                className="surface-field w-full px-2 py-1 text-xs"
              >
                <option value={ALL_ORGANIZATIONS}>{ALL_ORGANIZATIONS_LABEL}</option>
                {(organizations.data?.items ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canOnboard && skill === null && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
              <OnboardingDraftPicker
                draftsOf={draftsOf}
                currentUserId={user.id}
                startLabel="Onboard a site"
                disabled={onboardBlocked || turn.isPending}
                starting={startSkill.isPending && startSkill.variables === undefined}
                resuming={startSkill.isPending ? (startSkill.variables ?? null) : null}
                onStartNew={() => startSkill.mutate(undefined)}
                onResume={(id) => startSkill.mutate(id)}
              />
              {onboardBlocked && <span className="text-ink-muted">{ONBOARD_PICK_SENTENCE}</span>}
            </div>
          )}

          {skill !== null ? (
            <OnboardingSkillPanel
              user={user}
              skill={skill}
              cards={cardList}
              status={progress}
              sending={turn.isPending || followUp !== null}
              onSend={(text) => sendText(text)}
              onSkillChange={(next) => conversationId !== null && setSkill(conversationId, next)}
              onError={setBanner}
              onEnd={() => endSkill.mutate()}
              ending={endSkill.isPending}
              onUndoingChange={setSkillUndoing}
            />
          ) : (
            <div
              ref={threadRef}
              role="log"
              aria-label="Copilot conversation"
              aria-live="polite"
              className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-3"
            >
              {messages.length === 0 && !turn.isPending && (
                <p className="text-xs text-ink-muted">
                  Ask about alarms, assets, KPIs, locations, dashboards or health, or ask for a change to a dashboard,
                  a dashboard template or a KPI setting. A change is applied only when you confirm its card.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <span
                    className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                      m.role === "user" ? "text-accent" : "text-ink-muted"
                    }`}
                  >
                    {m.role === "user" ? (user.displayName ?? user.email) : m.role === "action" ? "Action" : "Copilot"}
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-accent text-on-accent"
                        : m.role === "action"
                          ? "border border-line text-xs text-ink-muted"
                          : "surface-raised-sm text-ink"
                    }`}
                  >
                    {m.role === "user" ? <UserText content={m.content} /> : <AssistantText text={m.content} />}
                  </div>
                </div>
              ))}
              {cardList}
              {progress}
            </div>
          )}

          {banner && (
            <div
              role="alert"
              className="mx-4 mb-2 rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink"
            >
              {banner}
            </div>
          )}

          {scopeOff ? (
            <p className="border-t border-line p-3 text-xs text-ink-muted">{SCOPE_OFF_SENTENCE}</p>
          ) : skill === null && configured === undefined ? (
            <p className="border-t border-line p-3 text-xs text-ink-muted">Checking this organization…</p>
          ) : skill !== null || configured ? (
            <form onSubmit={onSubmit} className="border-t border-line p-3">
              {attachAllowed && (
                <p className="mb-2 text-[11px] text-ink-muted">
                  {unscrubbedSentence(scopeLabel)}
                </p>
              )}
              {attachAllowed && files.length > 0 && (
                <ul aria-label="Files to attach" className="mb-2 flex flex-wrap gap-1">
                  {files.map((file, i) => (
                    <li
                      key={`${i}-${file.name}`}
                      data-name={file.name}
                      className="surface-pressed flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ink"
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="text-ink-muted">{sizeLabel(file.size)}</span>
                      {renderedPageCount(file) !== undefined && (
                        <span className="text-ink-muted">{`page 1 of ${renderedPageCount(file)}, sent as an image`}</span>
                      )}
                      <button
                        type="button"
                        aria-label={turn.isPending ? `Sending ${file.name}…` : `Remove ${file.name}`}
                        aria-busy={turn.isPending}
                        onClick={() => removeFile(i)}
                        disabled={turn.isPending}
                        className="px-1 text-ink-muted hover:text-ink"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {attachAllowed && rendering.length > 0 && (
                <p role="status" className="mb-2 flex flex-wrap gap-1 text-[11px] text-ink-muted">
                  {rendering.map((name, i) => (
                    <span key={`${i}-${name}`} className="surface-pressed rounded px-2 py-0.5">{`Rendering ${name}…`}</span>
                  ))}
                </p>
              )}
              <div className="flex items-end gap-2">
                {attachAllowed && (
                  <label
                    title={unscrubbedSentence(scopeLabel)}
                    className="surface-button cursor-pointer px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-accent"
                  >
                    Attach
                    <input
                      type="file"
                      multiple
                      accept={ATTACHMENT_EXTENSIONS.join(",")}
                      aria-label={`Attach files. ${unscrubbedSentence(scopeLabel)}`}
                      onChange={onChooseFiles}
                      disabled={busy}
                      className="sr-only"
                    />
                  </label>
                )}
                <textarea
                  aria-label="Message the copilot"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={COPILOT_TURN_MESSAGE_MAX}
                  rows={2}
                  placeholder="Ask the copilot… (Enter to send)"
                  className="surface-field flex-1 resize-none px-2 py-1 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy || rendering.length > 0 || input.trim() === ""}
                  // F4.164: name the label's own flag; `busy` is turn.isPending, a follow-up or a skill undo.
                  aria-busy={turn.isPending || followUp !== null || skillUndoing}
                  className="surface-button px-3 py-1 text-xs disabled:opacity-50"
                >
                  {turn.isPending ? "Sending…" : followUp !== null ? "Waiting…" : "Send"}
                </button>
              </div>
            </form>
          ) : (
            <p className="border-t border-line p-3 text-xs text-ink-muted">{NOT_CONFIGURED_SENTENCE}</p>
          )}
        </aside>
      )}
    </>
  );
}
