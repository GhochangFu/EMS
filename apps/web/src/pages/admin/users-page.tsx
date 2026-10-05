import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { userRoleSchema } from "@bms/shared/contracts";
import type { AdminUserDto, UpdateUserBody, UserRole, UserWriteResponse } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  adminUsersQueryKey,
  createAdminUser,
  deactivateAdminUser,
  fetchAdminUsers,
  reactivateAdminUser,
  setAdminUserTemporaryPassword,
  updateAdminUser,
} from "../../api/admin/users";
import { isOidcEnabled } from "../../api/oidc";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canManageUsers } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
// `F4.200`: the shell's labels ("Organization Administrator"), not the role code with spaces.
import { roleLabel } from "../../lib/role-label";
import type { AuthUser } from "../../stores/auth-store";
import {
  FeedbackBox,
  failureFeedback,
  fieldClass,
  followUpFeedback,
  labelClass,
  type Feedback,
  type Organizations,
} from "./users-feedback";
import { GrantsDrawer } from "./users-grants-drawer";

type UsersAdminPageProps = { user: AuthUser };

/** Shown on every user action in a deployment that signs in locally (ADR 0089 decision 4). */
export const LOCAL_MODE_SENTENCE = "User administration needs Keycloak; this deployment runs local sign-in.";
/** Shown on an unlinked row: the Keycloak account is made on the first sign-in. */
export const UNLINKED_SENTENCE = "This user must sign in once before it can be changed.";

/** The shared contract's own floor (`temporaryPasswordSchema`), checked before any request. */
export const MIN_TEMPORARY_PASSWORD_LENGTH = 12;
const MAX_TEMPORARY_PASSWORD_LENGTH = 128;

const PASSWORD_TOO_SHORT_SENTENCE = `The temporary password must be at least ${MIN_TEMPORARY_PASSWORD_LENGTH} characters.`;
const NO_ACCESS_SENTENCE =
  "User administration is open to administrators and organization administrators only.";

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
  deactivate: { label: "Deactivate", text: "Deactivate", pendingLabel: "Deactivating", pendingText: "Deactivating…" },
  reactivate: { label: "Reactivate", text: "Reactivate", pendingLabel: "Reactivating", pendingText: "Reactivating…" },
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
  // `F4.202`: Deactivate ends the user's sessions, so it asks first. Reactivate does not.
  const [confirmDeactivate, setConfirmDeactivate] = useState<AdminUserDto | null>(null);

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
                          : rowAction(row, "deactivate", () => setConfirmDeactivate(row))}
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
      {confirmDeactivate ? (
        <ConfirmDialog
          title={`Deactivate ${confirmDeactivate.displayName}`}
          body="This ends the user's sessions and closes its live connections. You can reactivate the user later."
          confirmLabel="Confirm deactivate"
          onClose={() => setConfirmDeactivate(null)}
          onConfirm={() => {
            const { id } = confirmDeactivate;
            setConfirmDeactivate(null);
            setPageFeedback(null);
            write.mutate({ row: { userId: id, action: "deactivate" }, run: () => deactivateAdminUser(id) });
          }}
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
