/**
 * `F3.86` PR 4 / ADR 0099 decision 3 (plan §6.5, ruling Q9) — the Users
 * page's wizards on the shared `WizardShell`: create (`user.create`, Account →
 * Role → Review), edit (`user.update`, Account → Role → Review) and the
 * Review-only deactivate and reactivate. A wizard used alone sends the plain
 * request, never `X-Copilot-Change`: a copilot write goes through the dock's
 * Confirm card only.
 *
 * - **The temporary password is not a catalog step.** It is `clientOnly` on
 *   `user.create`: the input is uncontrolled, held in a ref for the life of the
 *   modal (outside the shell, which unmounts a step on Review), and merged
 *   into the request only on Submit. The wizard's values never hold it, so its
 *   Review card never shows it; `bodyProblems` drops the route body's issue on
 *   the missing field, and the page's own minimum-length check runs first.
 * - **No wizard offers the global `admin` role**, to any caller. The Users page
 *   keeps promotion and an `admin` row's edits on its old, non-wizard modal.
 *
 * Extracted from `pages/admin/users-page.tsx` to keep the page under the
 * AGENTS.md §4.5 cap.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { userRoleSchema } from "@bms/shared/contracts";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";
import type { AdminUserDto, UpdateUserBody, UserRole } from "@bms/shared";

import type { CreateAdminUserInput } from "../../api/admin/users";
import { roleLabel } from "../../lib/role-label";
import type { WizardStep } from "../../lib/wizard-steps";
import {
  FeedbackBox,
  fieldClass,
  labelClass,
  type Feedback,
  type Organizations,
} from "../../pages/admin/users-feedback";
import { WizardShell } from "../wizard/wizard-shell";

/** The shared contract's own floor (`temporaryPasswordSchema`), checked before any request. */
export const MIN_TEMPORARY_PASSWORD_LENGTH = 12;
const MAX_TEMPORARY_PASSWORD_LENGTH = 128;

export const PASSWORD_TOO_SHORT_SENTENCE = `The temporary password must be at least ${MIN_TEMPORARY_PASSWORD_LENGTH} characters.`;

/** Shown above the deactivate wizard: what the write does beyond the flag. */
export const DEACTIVATE_SENTENCE =
  "This ends the user's sessions and closes its live connections. You can reactivate the user later.";

/**
 * The catalog entry a wizard submits. The modal writes the literal id on the
 * `entry` prop (`entry={wizardEntry("user.create")}`), the form the stepper
 * gate detects. A missing entry is a build defect, so it throws.
 */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/** The roles a wizard offers: every role but the global `admin`, for every caller (ADR 0099 decision 3). */
export const WIZARD_ROLES: readonly UserRole[] = userRoleSchema.options.filter((role) => role !== "admin");

function isWizardRole(value: unknown): value is UserRole {
  return typeof value === "string" && (WIZARD_ROLES as readonly string[]).includes(value);
}

/**
 * The password input is uncontrolled: no `value` prop, so React never mirrors the secret into the
 * `value` attribute and the markup never holds it. The modal reads it through the ref on submit.
 */
export function PasswordField({ inputRef }: { inputRef: RefObject<HTMLInputElement> }) {
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
export function usePasswordRef(feedback: Feedback | null): RefObject<HTMLInputElement> {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (feedback && ref.current) {
      ref.current.value = "";
    }
  }, [feedback]);
  return ref;
}

export function OrganizationSelect({
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
      <select className={fieldClass} value={value} required onChange={(event) => onChange(event.target.value)}>
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

function RoleSelect({ value, onChange }: { value: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <label className={labelClass}>
      Role
      <select
        className={fieldClass}
        value={value}
        onChange={(event) => {
          if (isWizardRole(event.target.value)) onChange(event.target.value);
        }}
      >
        {WIZARD_ROLES.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The modal around a wizard: a labelled dialog with its heading. */
function WizardFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto surface-dialog p-4"
      >
        <h2 className="font-condensed text-lg font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** What the create wizard's form holds. The temporary password is not here: it is the ref's. */
export type CreateUserForm = { email: string; displayName: string; role: UserRole; organizationId: string };

/**
 * The `user.create` wizard's values, from the form. Exactly the four body
 * fields the catalog steps show — never `temporaryPassword`. An empty text is
 * `undefined` (Review names it); an organization not picked stays `""`, which
 * fails the uuid check and holds the wizard on Role.
 */
export function createUserValues(form: CreateUserForm): Record<string, unknown> {
  return {
    email: form.email === "" ? undefined : form.email,
    displayName: form.displayName === "" ? undefined : form.displayName,
    role: form.role,
    organizationId: form.organizationId,
  };
}

export function CreateUserWizard({
  organizations,
  pending,
  feedback,
  onCancel,
  onSubmit,
}: {
  organizations: Organizations;
  pending: boolean;
  feedback: Feedback | null;
  onCancel: () => void;
  onSubmit: (input: CreateAdminUserInput) => void;
}) {
  const [form, setForm] = useState<CreateUserForm>({
    email: "",
    displayName: "",
    role: "viewer",
    organizationId: "",
  });
  const passwordRef = usePasswordRef(feedback);
  const [localError, setLocalError] = useState<string | null>(null);
  const organizationId = form.organizationId || (organizations.length === 1 ? (organizations[0]?.id ?? "") : "");
  const values = createUserValues({ ...form, organizationId });
  const entry = wizardEntry("user.create");

  function fromValues(next: Record<string, unknown>): void {
    setForm({
      email: typeof next.email === "string" ? next.email : "",
      displayName: typeof next.displayName === "string" ? next.displayName : "",
      role: isWizardRole(next.role) ? next.role : form.role,
      organizationId: typeof next.organizationId === "string" ? next.organizationId : organizationId,
    });
  }

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "account") {
      return (
        <>
          <label className={labelClass}>
            Email
            <input
              type="email"
              className={fieldClass}
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label className={labelClass}>
            Display name
            <input
              className={fieldClass}
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </label>
        </>
      );
    }
    return (
      <>
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <OrganizationSelect
          organizations={organizations}
          value={organizationId}
          onChange={(id) => setForm({ ...form, organizationId: id })}
        />
      </>
    );
  }

  function submit(body: Record<string, unknown>): void {
    const temporaryPassword = passwordRef.current?.value ?? "";
    if (temporaryPassword.length < MIN_TEMPORARY_PASSWORD_LENGTH) {
      setLocalError(PASSWORD_TOO_SHORT_SENTENCE);
      return;
    }
    setLocalError(null);
    // Review parsed `body` against the route's own schema (all but the password).
    onSubmit({ ...(body as Omit<CreateAdminUserInput, "temporaryPassword">), temporaryPassword });
  }

  return (
    <WizardFrame title="Create user">
      <WizardShell
        key="create"
        entry={wizardEntry("user.create")}
        values={values}
        onChange={fromValues}
        renderStep={renderStep}
        onSubmit={submit}
        onCancel={onCancel}
        submitting={pending}
        summary={entry.summary({
          body: values,
          params: {},
          targetName: "",
          organizationName: organizations.find((org) => org.id === organizationId)?.name ?? "the organization",
        })}
      />
      <PasswordField inputRef={passwordRef} />
      {localError ? (
        <p role="alert" className="text-xs text-critical-ink">
          {localError}
        </p>
      ) : null}
      <FeedbackBox feedback={feedback} />
    </WizardFrame>
  );
}

/**
 * The `user.update` wizard's values: a field is sent only when it changed, so
 * an unchanged form fails Review with the route's own "changes nothing". The
 * role never crosses the `admin` boundary here (the row is not an `admin` and
 * the wizard offers no `admin`), so `organizationId` is never sent.
 */
export function updateUserValues(
  target: AdminUserDto,
  form: { displayName: string; role: UserRole },
): Record<string, unknown> {
  const displayName = form.displayName.trim();
  return {
    displayName: displayName === target.displayName ? undefined : displayName,
    role: form.role === target.role ? undefined : form.role,
  };
}

/** `user.update` for a non-`admin` row. */
export function UpdateUserWizard({
  target,
  organizationName,
  pending,
  feedback,
  onCancel,
  onSubmit,
}: {
  target: AdminUserDto;
  organizationName: string;
  pending: boolean;
  feedback: Feedback | null;
  onCancel: () => void;
  onSubmit: (body: UpdateUserBody) => void;
}) {
  const [form, setForm] = useState<{ displayName: string; role: UserRole }>({
    displayName: target.displayName,
    role: target.role,
  });
  const values = updateUserValues(target, form);
  const entry = wizardEntry("user.update");

  function fromValues(next: Record<string, unknown>): void {
    setForm({
      displayName: typeof next.displayName === "string" ? next.displayName : form.displayName,
      role: isWizardRole(next.role) ? next.role : form.role,
    });
  }

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "account") {
      return (
        <>
          <p className="text-xs text-ink-muted">{target.email}</p>
          <label className={labelClass}>
            Display name
            <input
              className={fieldClass}
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </label>
        </>
      );
    }
    return (
      <>
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <p className="text-xs text-ink-muted">Organization: {organizationName}</p>
      </>
    );
  }

  return (
    <WizardFrame title={`Edit ${target.displayName}`}>
      <WizardShell
        key={`update-${target.id}`}
        entry={wizardEntry("user.update")}
        values={values}
        onChange={fromValues}
        renderStep={renderStep}
        onSubmit={(body) => onSubmit(body as UpdateUserBody)}
        onCancel={onCancel}
        submitting={pending}
        current={{ displayName: target.displayName, role: target.role }}
        summary={entry.summary({
          body: values,
          params: { id: target.id },
          targetName: target.displayName,
          organizationName,
        })}
      />
      <FeedbackBox feedback={feedback} />
    </WizardFrame>
  );
}

/** A bodyless wizard's values (deactivate, reactivate): it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/**
 * Deactivate or reactivate, a Review-only wizard (ruling Q9) in place of the
 * old confirm. Submit hands the write to the page, which closes the wizard and
 * shows the write in flight on the row.
 */
export function UserStatusWizard({
  action,
  target,
  onCancel,
  onSubmit,
}: {
  action: "deactivate" | "reactivate";
  target: AdminUserDto;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const context = { body: NO_VALUES, params: { id: target.id }, targetName: target.displayName, organizationName: "" };
  const shared = {
    values: NO_VALUES,
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => onSubmit(),
    onCancel,
    submitting: false,
  };
  if (action === "deactivate") {
    return (
      <WizardFrame title={`Deactivate ${target.displayName}`}>
        <p className="text-xs text-ink-muted">{DEACTIVATE_SENTENCE}</p>
        <WizardShell
          key={`${action}-${target.id}`}
          {...shared}
          entry={wizardEntry("user.deactivate")}
          summary={wizardEntry("user.deactivate").summary(context)}
        />
      </WizardFrame>
    );
  }
  return (
    <WizardFrame title={`Reactivate ${target.displayName}`}>
      <WizardShell
        key={`${action}-${target.id}`}
        {...shared}
        entry={wizardEntry("user.reactivate")}
        summary={wizardEntry("user.reactivate").summary(context)}
      />
    </WizardFrame>
  );
}
