import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { userGrantKindSchema, userRoleSchema, userWriteFollowUpSchema } from "@bms/shared/contracts";
import type {
  AdminUserDto,
  UpdateUserBody,
  UserGrantDto,
  UserGrantKind,
  UserRole,
  UserWriteFollowUp,
  UserWriteResponse,
} from "@bms/shared";

import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  addAdminUserGrant,
  adminUserGrantsQueryKey,
  adminUsersQueryKey,
  createAdminUser,
  deactivateAdminUser,
  fetchAdminUserGrants,
  fetchAdminUsers,
  reactivateAdminUser,
  removeAdminUserGrant,
  setAdminUserTemporaryPassword,
  updateAdminUser,
} from "../../api/admin/users";
import { isOidcEnabled } from "../../api/oidc";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageUsers } from "../../lib/admin-access";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type UsersAdminPageProps = { user: AuthUser };

/** Shown on every user action in a deployment that signs in locally (ADR 0089 decision 4). */
export const LOCAL_MODE_SENTENCE = "User administration needs Keycloak; this deployment runs local sign-in.";
/** Shown on an unlinked row: the Keycloak account is made on the first sign-in. */
export const UNLINKED_SENTENCE = "This user must sign in once before it can be changed.";

/** The shared contract's own floor (`temporaryPasswordSchema`), checked before any request. */
export const MIN_TEMPORARY_PASSWORD_LENGTH = 12;
const MAX_TEMPORARY_PASSWORD_LENGTH = 128;

const PASSWORD_TOO_SHORT_SENTENCE = `The temporary password must be at least ${MIN_TEMPORARY_PASSWORD_LENGTH} characters.`;
const NOT_CONFIGURED_SENTENCE =
  "User administration is not available: Keycloak is not configured on the server. Nothing was changed.";
const NOT_FOUND_SENTENCE = "This user was not found, or it is outside your scope.";
const GRANT_TARGET_NOT_FOUND_SENTENCE =
  "That location, group or organization was not found, or it is outside your scope.";
/** The message the grants API gives a 404 for a missing or out-of-scope target (user-grants.service.ts). */
const GRANT_TARGET_NOT_FOUND_MESSAGE = "Grant target not found";
const NO_ACCESS_SENTENCE =
  "User administration is open to administrators and organization administrators only.";

/** One plain sentence per follow-up the API can return (`userWriteFollowUpSchema`). */
const FOLLOW_UP_SENTENCES: Record<UserWriteFollowUp, string> = {
  keycloak_enable_failed:
    "The user was saved, but Keycloak did not enable the account. Use Reactivate to try again.",
  keycloak_disable_failed:
    "The user is deactivated here, but Keycloak did not disable the account or end its sessions. Disable the account in Keycloak.",
  keycloak_logout_failed:
    "The temporary password is set, but the user's current sessions did not end. End them in Keycloak.",
  keycloak_orphan_disabled_account:
    "Keycloak made the account, but the user was not saved and the disabled Keycloak account could not be removed. Ask an operator to delete it in Keycloak.",
  keycloak_create_outcome_unknown:
    "Keycloak did not confirm the new account. A disabled account for this email may exist in Keycloak. Check Keycloak for the email before you try again.",
};

const KIND_LABELS: Record<UserGrantKind, string> = {
  organization: "Organization",
  location: "Location",
  asset_group: "Asset group",
};

type Feedback = { tone: "error" | "warning"; messages: string[] };

function roleLabel(role: UserRole): string {
  return role.replace(/_/g, " ");
}

/** The follow-up an error body carries, if it is one the contract names. */
function followUpOf(err: unknown): UserWriteFollowUp | null {
  if (!(err instanceof Error)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(err.message);
    const value = (parsed as { followUp?: unknown } | null)?.followUp;
    const checked = userWriteFollowUpSchema.safeParse(value);
    return checked.success ? checked.data : null;
  } catch {
    return null;
  }
}

/**
 * What a refused request says: its own sentence for 503 and 404, else the server's message. In the
 * grants drawer (`scope: "grant"`) a 404 for a missing grant target has its own sentence.
 */
function failureFeedback(err: unknown, scope: "user" | "grant" = "user"): Feedback {
  const status = err instanceof ApiError ? err.status : null;
  if (status === 503) {
    return { tone: "error", messages: [NOT_CONFIGURED_SENTENCE] };
  }
  if (status === 404) {
    if (scope === "grant" && apiErrorMessage(err) === GRANT_TARGET_NOT_FOUND_MESSAGE) {
      return { tone: "error", messages: [GRANT_TARGET_NOT_FOUND_SENTENCE] };
    }
    return { tone: "error", messages: [NOT_FOUND_SENTENCE] };
  }
  const followUp = followUpOf(err);
  return {
    tone: "error",
    messages: [apiErrorMessage(err), ...(followUp ? [FOLLOW_UP_SENTENCES[followUp]] : [])],
  };
}

/** A 2xx write that still needs an admin's attention. */
function followUpFeedback(response: UserWriteResponse): Feedback | null {
  return response.followUp
    ? { tone: "warning", messages: [FOLLOW_UP_SENTENCES[response.followUp]] }
    : null;
}

function FeedbackBox({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) {
    return null;
  }
  const classes =
    feedback.tone === "error"
      ? "border-critical-line-strong bg-critical-wash text-critical-ink-strong"
      : "border-warning-line bg-warning-wash-strong text-warning-ink";
  return (
    <div
      role={feedback.tone === "error" ? "alert" : "status"}
      className={`rounded border p-3 text-sm ${classes}`}
    >
      {feedback.messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

/** The users and access screen (`F3.78`, ADR 0089). Fails closed for any role the API refuses. */
export function UsersAdminPage({ user }: UsersAdminPageProps) {
  if (!canManageUsers(user.role)) {
    return (
      <MasterDataLayout user={user}>
        <PageHeader eyebrow="Administration" title="Users" subtitle="Accounts, roles and site access" />
        <p role="alert" className="text-sm text-ink-muted">
          {NO_ACCESS_SENTENCE}
        </p>
      </MasterDataLayout>
    );
  }
  return <UsersAdminScreen user={user} />;
}

/** Which row action a user write is, so its button can name itself while it is in flight. */
type RowActionKind = "edit" | "deactivate" | "reactivate" | "password";
type UserWrite = {
  /** The row and action in flight; null for a create, which has no row. */
  row: { userId: string; action: RowActionKind } | null;
  run: () => Promise<UserWriteResponse>;
};

/** Per action: the label and visible text while idle, and while its own write is in flight. */
const ROW_ACTION_TEXT: Record<
  RowActionKind,
  { label: string; text: string; pendingLabel: string; pendingText: string }
> = {
  edit: { label: "Edit", text: "Edit", pendingLabel: "Saving", pendingText: "Saving…" },
  deactivate: {
    label: "Deactivate",
    text: "Deactivate",
    pendingLabel: "Deactivating",
    pendingText: "Deactivating…",
  },
  reactivate: {
    label: "Reactivate",
    text: "Reactivate",
    pendingLabel: "Reactivating",
    pendingText: "Reactivating…",
  },
  password: {
    label: "Temporary password for",
    text: "Temporary password",
    pendingLabel: "Setting temporary password for",
    pendingText: "Setting password…",
  },
};

type Modal =
  | { kind: "create" }
  | { kind: "edit"; target: AdminUserDto }
  | { kind: "password"; target: AdminUserDto };

function UsersAdminScreen({ user }: UsersAdminPageProps) {
  const queryClient = useQueryClient();
  // `isOidcEnabled()` is read per render, not cached: it is what the sign-in itself reads.
  const oidc = isOidcEnabled();
  const [modal, setModal] = useState<Modal | null>(null);
  const [modalFeedback, setModalFeedback] = useState<Feedback | null>(null);
  const [pageFeedback, setPageFeedback] = useState<Feedback | null>(null);
  const [grantsFor, setGrantsFor] = useState<AdminUserDto | null>(null);

  const usersQ = useQuery({ queryKey: adminUsersQueryKey, queryFn: fetchAdminUsers });
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => fetchAdminOrganizations("all"),
  });

  const users = usersQ.data?.items ?? [];
  const organizations = orgsQ.data?.items ?? [];
  const orgName = (id: string | null): string =>
    id === null ? "All organizations" : (organizations.find((o) => o.id === id)?.name ?? id);

  function closeModal(): void {
    setModal(null);
    setModalFeedback(null);
  }

  /** A write's settlement: refresh the list, then show what the admin must do next, if anything. */
  const afterWrite = (response: UserWriteResponse): void => {
    void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey });
    setPageFeedback(followUpFeedback(response));
    closeModal();
  };

  const write = useMutation({
    mutationFn: (input: UserWrite) => input.run(),
    onSuccess: afterWrite,
    onError: (err: unknown) => {
      // A row action has no modal to show the refusal in.
      const feedback = failureFeedback(err);
      if (modal) {
        setModalFeedback(feedback);
      } else {
        setPageFeedback(feedback);
      }
    },
  });

  const localNoteId = "users-local-mode-note";
  const writesOff = !oidc;

  function actionState(target: AdminUserDto): { disabled: boolean; describedBy?: string } {
    if (writesOff) {
      return { disabled: true, describedBy: localNoteId };
    }
    if (!target.linked) {
      return { disabled: true, describedBy: `unlinked-note-${target.id}` };
    }
    return { disabled: write.isPending };
  }

  /** F4.168 D4: the name keys on the row and action in flight; `disabled` stays shared. */
  function rowAction(target: AdminUserDto, action: RowActionKind, onClick: () => void) {
    const state = actionState(target);
    const words = ROW_ACTION_TEXT[action];
    const inFlight =
      write.isPending &&
      write.variables?.row?.userId === target.id &&
      write.variables.row.action === action;
    return (
      <button
        type="button"
        aria-label={
          inFlight ? `${words.pendingLabel} ${target.displayName}…` : `${words.label} ${target.displayName}`
        }
        aria-busy={inFlight}
        aria-describedby={state.describedBy}
        disabled={state.disabled}
        onClick={onClick}
        className="text-xs font-semibold text-accent-strong disabled:opacity-50"
      >
        {inFlight ? words.pendingText : words.text}
      </button>
    );
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        subtitle="Accounts, roles and the sites each user can reach"
        actions={
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
            disabled={writesOff}
            aria-describedby={writesOff ? localNoteId : undefined}
            onClick={() => {
              setModalFeedback(null);
              setModal({ kind: "create" });
            }}
          >
            Create user
          </button>
        }
      />

      {writesOff ? (
        <p id={localNoteId} className="mb-4 text-sm text-ink-muted">
          {LOCAL_MODE_SENTENCE}
        </p>
      ) : null}
      {pageFeedback ? (
        <div className="mb-4">
          <FeedbackBox feedback={pageFeedback} />
        </div>
      ) : null}

      <SectionCard title="Users">
        {usersQ.isLoading ? <p className="text-sm text-ink-muted">Loading users…</p> : null}
        {usersQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(usersQ.error)}
          </p>
        ) : null}
        {!usersQ.isLoading && !usersQ.isError && users.length === 0 ? (
          <p className="text-sm text-ink-muted">No users in your scope.</p>
        ) : null}
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Organization</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className="border-b border-well-deep">
                    <td className="px-2 py-2">
                      <span className="block font-semibold">{row.displayName}</span>
                      <span className="block text-xs text-ink-muted">{row.email}</span>
                    </td>
                    <td className="px-2 py-2">{roleLabel(row.role)}</td>
                    <td className="px-2 py-2">{orgName(row.organizationId)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.disabledAt ? (
                          <StatusPill label="Deactivated" tone="offline" />
                        ) : (
                          <StatusPill label="Active" tone="ok" />
                        )}
                        {row.linked ? null : <StatusPill label="Not signed in yet" tone="info" />}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        {rowAction(row, "edit", () => {
                          setModalFeedback(null);
                          setModal({ kind: "edit", target: row });
                        })}
                        {row.disabledAt
                          ? rowAction(row, "reactivate", () => {
                              setPageFeedback(null);
                              write.mutate({
                                row: { userId: row.id, action: "reactivate" },
                                run: () => reactivateAdminUser(row.id),
                              });
                            })
                          : rowAction(row, "deactivate", () => {
                              setPageFeedback(null);
                              write.mutate({
                                row: { userId: row.id, action: "deactivate" },
                                run: () => deactivateAdminUser(row.id),
                              });
                            })}
                        {rowAction(row, "password", () => {
                          setModalFeedback(null);
                          setModal({ kind: "password", target: row });
                        })}
                        <button
                          type="button"
                          aria-label={`Grants for ${row.displayName}`}
                          className="text-xs font-semibold text-accent-strong"
                          onClick={() => setGrantsFor(row)}
                        >
                          Grants
                        </button>
                      </div>
                      {!writesOff && !row.linked ? (
                        <p id={`unlinked-note-${row.id}`} className="mt-1 text-xs text-ink-muted">
                          {UNLINKED_SENTENCE}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      {modal?.kind === "create" ? (
        <CreateUserModal
          caller={user}
          organizations={organizations}
          pending={write.isPending}
          feedback={modalFeedback}
          onCancel={closeModal}
          onSubmit={(input) => write.mutate({ row: null, run: () => createAdminUser(input) })}
        />
      ) : null}
      {modal?.kind === "edit" ? (
        <EditUserModal
          caller={user}
          target={modal.target}
          organizations={organizations}
          pending={write.isPending}
          feedback={modalFeedback}
          onCancel={closeModal}
          onSubmit={(body) =>
            write.mutate({
              row: { userId: modal.target.id, action: "edit" },
              run: () => updateAdminUser(modal.target.id, body),
            })
          }
        />
      ) : null}
      {modal?.kind === "password" ? (
        <TemporaryPasswordModal
          target={modal.target}
          pending={write.isPending}
          feedback={modalFeedback}
          onCancel={closeModal}
          onSubmit={(password) =>
            write.mutate({
              row: { userId: modal.target.id, action: "password" },
              run: () => setAdminUserTemporaryPassword(modal.target.id, password),
            })
          }
        />
      ) : null}
      {grantsFor ? (
        <GrantsDrawer
          target={grantsFor}
          organizations={organizations}
          onClose={() => setGrantsFor(null)}
        />
      ) : null}
    </MasterDataLayout>
  );
}

const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";

function ModalFrame({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md surface-dialog p-4"
        onSubmit={onSubmit}
      >
        <h2 className="font-condensed text-lg font-bold text-ink">{title}</h2>
        {children}
      </form>
    </div>
  );
}

function ModalButtons({
  pending,
  submitLabel,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" className="surface-button px-3 py-2" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="submit"
        className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

/** The roles a caller may hand out: only the global `admin` may create another `admin`. */
function assignableRoles(caller: AuthUser): readonly UserRole[] {
  return userRoleSchema.options.filter((role) => role !== "admin" || caller.role === "admin");
}

type Organizations = { id: string; name: string }[];

function OrganizationSelect({
  organizations,
  value,
  onChange,
}: {
  organizations: Organizations;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className={labelClass}>
      Organization
      <select
        className={fieldClass}
        value={value}
        required
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select an organization</option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The password input is uncontrolled: no `value` prop, so React never mirrors the secret into the
 * `value` attribute and the markup never holds it. The modal reads it through the ref on submit.
 */
function PasswordField({ inputRef }: { inputRef: RefObject<HTMLInputElement> }) {
  return (
    <label className={labelClass}>
      Temporary password
      <input
        type="password"
        autoComplete="new-password"
        className={fieldClass}
        maxLength={MAX_TEMPORARY_PASSWORD_LENGTH}
        ref={inputRef}
      />
      <span className="mt-1 block font-normal">
        At least {MIN_TEMPORARY_PASSWORD_LENGTH} characters. The user must change it at the next sign-in.
      </span>
    </label>
  );
}

/**
 * The password input's ref, emptied whenever the server refuses the write. The modal stays open on a
 * refusal, so without this the typed secret would outlive the failed request.
 */
function usePasswordRef(feedback: Feedback | null): RefObject<HTMLInputElement> {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (feedback && ref.current) {
      ref.current.value = "";
    }
  }, [feedback]);
  return ref;
}

function CreateUserModal({
  caller,
  organizations,
  pending,
  feedback,
  onCancel,
  onSubmit,
}: {
  caller: AuthUser;
  organizations: Organizations;
  pending: boolean;
  feedback: Feedback | null;
  onCancel: () => void;
  onSubmit: (input: {
    email: string;
    displayName: string;
    role: UserRole;
    organizationId: string | null;
    temporaryPassword: string;
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const [organizationId, setOrganizationId] = useState("");
  const passwordRef = usePasswordRef(feedback);
  const [localError, setLocalError] = useState<string | null>(null);
  const chosenOrg = organizationId || (organizations.length === 1 ? (organizations[0]?.id ?? "") : "");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const password = passwordRef.current?.value ?? "";
    if (password.length < MIN_TEMPORARY_PASSWORD_LENGTH) {
      setLocalError(PASSWORD_TOO_SHORT_SENTENCE);
      return;
    }
    setLocalError(null);
    onSubmit({
      email,
      displayName,
      role,
      organizationId: role === "admin" ? null : chosenOrg,
      temporaryPassword: password,
    });
  }

  return (
    <ModalFrame title="Create user" onSubmit={handleSubmit}>
      <div className="mt-3 space-y-3">
        <label className={labelClass}>
          Email
          <input
            type="email"
            className={fieldClass}
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={labelClass}>
          Display name
          <input
            className={fieldClass}
            value={displayName}
            required
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className={labelClass}>
          Role
          <select
            className={fieldClass}
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {assignableRoles(caller).map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {role === "admin" ? null : (
          <OrganizationSelect organizations={organizations} value={chosenOrg} onChange={setOrganizationId} />
        )}
        <PasswordField inputRef={passwordRef} />
        {localError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {localError}
          </p>
        ) : null}
        <FeedbackBox feedback={feedback} />
      </div>
      <ModalButtons pending={pending} submitLabel="Create" onCancel={onCancel} />
    </ModalFrame>
  );
}

function EditUserModal({
  caller,
  target,
  organizations,
  pending,
  feedback,
  onCancel,
  onSubmit,
}: {
  caller: AuthUser;
  target: AdminUserDto;
  organizations: Organizations;
  pending: boolean;
  feedback: Feedback | null;
  onCancel: () => void;
  onSubmit: (body: UpdateUserBody) => void;
}) {
  const [displayName, setDisplayName] = useState(target.displayName);
  const [role, setRole] = useState<UserRole>(target.role);
  const [organizationId, setOrganizationId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // The organization is writable only when the role crosses the `admin` boundary (the API's rule).
  const crosses = (target.role === "admin") !== (role === "admin");
  const needsOrganization = crosses && role !== "admin";
  const chosenOrg = organizationId || (organizations.length === 1 ? (organizations[0]?.id ?? "") : "");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const body: UpdateUserBody = {};
    if (displayName.trim() !== target.displayName) {
      body.displayName = displayName.trim();
    }
    if (role !== target.role) {
      body.role = role;
      if (crosses) {
        body.organizationId = role === "admin" ? null : chosenOrg;
      }
    }
    if (Object.keys(body).length === 0) {
      setLocalError("Nothing has changed.");
      return;
    }
    setLocalError(null);
    onSubmit(body);
  }

  return (
    <ModalFrame title={`Edit ${target.displayName}`} onSubmit={handleSubmit}>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-ink-muted">{target.email}</p>
        <label className={labelClass}>
          Display name
          <input
            className={fieldClass}
            value={displayName}
            required
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className={labelClass}>
          Role
          <select
            className={fieldClass}
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {assignableRoles(caller).map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {needsOrganization ? (
          <OrganizationSelect organizations={organizations} value={chosenOrg} onChange={setOrganizationId} />
        ) : null}
        {localError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {localError}
          </p>
        ) : null}
        <FeedbackBox feedback={feedback} />
      </div>
      <ModalButtons pending={pending} submitLabel="Save" onCancel={onCancel} />
    </ModalFrame>
  );
}

function TemporaryPasswordModal({
  target,
  pending,
  feedback,
  onCancel,
  onSubmit,
}: {
  target: AdminUserDto;
  pending: boolean;
  feedback: Feedback | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  // Mounts empty, is emptied on a refusal and is unmounted on close.
  const passwordRef = usePasswordRef(feedback);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const password = passwordRef.current?.value ?? "";
    if (password.length < MIN_TEMPORARY_PASSWORD_LENGTH) {
      setLocalError(PASSWORD_TOO_SHORT_SENTENCE);
      return;
    }
    setLocalError(null);
    onSubmit(password);
  }

  return (
    <ModalFrame title={`Temporary password for ${target.displayName}`} onSubmit={handleSubmit}>
      <div className="mt-3 space-y-3">
        <PasswordField inputRef={passwordRef} />
        {localError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {localError}
          </p>
        ) : null}
        <FeedbackBox feedback={feedback} />
      </div>
      <ModalButtons pending={pending} submitLabel="Set password" onCancel={onCancel} />
    </ModalFrame>
  );
}

/** Grants touch only the database, so local sign-in still manages them (ADR 0089 decision 11). */
function GrantsDrawer({
  target,
  organizations,
  onClose,
}: {
  target: AdminUserDto;
  organizations: Organizations;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [kind, setKind] = useState<UserGrantKind>("location");
  const [targetId, setTargetId] = useState("");

  const grantsQ = useQuery({
    queryKey: adminUserGrantsQueryKey(target.id),
    queryFn: () => fetchAdminUserGrants(target.id),
  });
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true"],
    queryFn: () => fetchAdminLocations("true"),
    enabled: kind === "location",
  });
  const groupsQ = useQuery({
    queryKey: ["admin", "asset-groups", "all"],
    queryFn: () => fetchAdminAssetGroups(),
    enabled: kind === "asset_group",
  });

  const options: { id: string; name: string }[] =
    kind === "organization"
      ? organizations
      : kind === "location"
        ? (locationsQ.data?.items ?? [])
        : (groupsQ.data?.items ?? []);

  const settle = {
    onSuccess: (response: { items: UserGrantDto[] }) => {
      queryClient.setQueryData(adminUserGrantsQueryKey(target.id), response);
      setFeedback(null);
    },
    onError: (err: unknown) => setFeedback(failureFeedback(err, "grant")),
  };
  const add = useMutation({
    mutationFn: () => addAdminUserGrant(target.id, { kind, targetId }),
    ...settle,
    onSuccess: (response) => {
      settle.onSuccess(response);
      setTargetId("");
    },
  });
  const remove = useMutation({
    mutationFn: (grant: UserGrantDto) => removeAdminUserGrant(target.id, grant.kind, grant.id),
    ...settle,
  });

  const grants = grantsQ.data?.items ?? [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto surface-dialog p-4">
      <div role="dialog" aria-label={`Grants for ${target.displayName}`}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-condensed text-lg font-bold text-ink">Grants for {target.displayName}</h2>
          <button type="button" className="surface-button px-3 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">Role: {roleLabel(target.role)}</p>

        <div className="mt-3 space-y-3">
          <FeedbackBox feedback={feedback} />
          {grantsQ.isLoading ? <p className="text-sm text-ink-muted">Loading grants…</p> : null}
          {grantsQ.isError ? (
            <p role="alert" className="text-sm text-critical-ink">
              {failureFeedback(grantsQ.error).messages.join(" ")}
            </p>
          ) : null}
          {!grantsQ.isLoading && !grantsQ.isError && grants.length === 0 ? (
            <p className="text-sm text-ink-muted">This user has no grants.</p>
          ) : null}
          <ul className="divide-y divide-line">
            {grants.map((grant) => {
              // F4.168 D4: the name keys on the grant being removed; `disabled` stays shared.
              const removingThis =
                remove.isPending &&
                remove.variables?.kind === grant.kind &&
                remove.variables?.id === grant.id;
              const grantName = `${KIND_LABELS[grant.kind]} grant ${grant.targetName}`;
              return (
              <li key={`${grant.kind}-${grant.id}`} className="flex items-start justify-between gap-2 py-2">
                <div className="text-sm">
                  <span className="block font-semibold">{grant.targetName}</span>
                  <span className="block text-xs text-ink-muted">{KIND_LABELS[grant.kind]}</span>
                  {grant.effective ? null : (
                    <span className="block text-xs text-warning-ink">
                      Not used by the {roleLabel(target.role)} role.
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={removingThis ? `Removing ${grantName}` : `Remove ${grantName}`}
                  aria-busy={removingThis}
                  disabled={remove.isPending}
                  className="text-xs font-semibold text-critical-ink disabled:opacity-50"
                  onClick={() => remove.mutate(grant)}
                >
                  Remove
                </button>
              </li>
              );
            })}
          </ul>
        </div>

        <form
          className="mt-4 space-y-3 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">Add a grant</h3>
          <label className={labelClass}>
            Grant kind
            <select
              className={fieldClass}
              value={kind}
              onChange={(event) => {
                setKind(userGrantKindSchema.parse(event.target.value));
                setTargetId("");
              }}
            >
              {userGrantKindSchema.options.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Grant target
            <select
              className={fieldClass}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Select a target</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
            disabled={targetId === "" || add.isPending}
            aria-busy={add.isPending}
          >
            {add.isPending ? "Adding…" : "Add grant"}
          </button>
        </form>
      </div>
    </div>
  );
}
