import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RTU_CREDENTIAL_SIBLINGS_MAX, type AdminRtuDto } from "@bms/shared";

import { fetchRtuCredentialSiblings, replaceRtuCredentials } from "../../api/admin/rtus";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin-wizard-frame";

/**
 * `F4.333` (ADR 0129 decisions 2 and 6) — replaces a committed MQTT RTU's broker
 * credential on `/admin/rtus`.
 *
 * Write-only: the two fields start empty and the stored credential is never
 * shown. The password input is uncontrolled (the `PasswordField` pattern of
 * `user-wizards.tsx`), so React never mirrors it into the `value` attribute and
 * the markup never holds it. The typed values live only until the request
 * settles, are never put in the query cache (the mutation has `gcTime: 0` and is
 * reset on settle) or the URL, and are cleared on success, on failure and on
 * Cancel. The siblings (Q3) are the RTUs the API says share the broker, all
 * pre-ticked: with one connection per broker, rotating a password on one RTU
 * alone may not reach the broker.
 */
export function RtuCredentialsDialog({ rtu, onDone }: { rtu: AdminRtuDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  /** Every sibling id already offered: ticked once when first seen, never re-ticked after an untick. */
  const seen = useRef<Set<string>>(new Set());

  const siblings = useQuery({
    queryKey: ["admin", "rtus", "credential-siblings", rtu.id],
    queryFn: () => fetchRtuCredentialSiblings(rtu.id),
  });
  // Each sibling is ticked the first time it is offered; a refetch never re-ticks one the user unticked.
  useEffect(() => {
    const fresh = (siblings.data?.items ?? []).map((item) => item.id).filter((id) => !seen.current.has(id));
    if (fresh.length > 0) {
      for (const id of fresh) seen.current.add(id);
      setTicked((current) => new Set([...current, ...fresh]));
    }
  }, [siblings.data]);
  const tooMany = ticked.size > RTU_CREDENTIAL_SIBLINGS_MAX;

  const clear = () => {
    setUsername("");
    if (passwordRef.current) passwordRef.current.value = "";
    setHasPassword(false);
  };

  const save = useMutation({
    mutationFn: (input: { username: string; password: string; alsoApplyTo: string[] }) =>
      replaceRtuCredentials(rtu.id, {
        username: input.username,
        password: input.password,
        ...(input.alsoApplyTo.length > 0 ? { alsoApplyTo: input.alsoApplyTo } : {}),
      }),
    gcTime: 0,
    onSuccess: async () => {
      clear();
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
      onDone();
    },
    onError: (err: unknown) => {
      clear();
      setError(apiErrorMessage(err));
    },
    onSettled: (): void => {
      save.reset();
    },
  });

  const cancel = () => {
    clear();
    onDone();
  };

  return (
    <AdminWizardFrame title="Replace credentials">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate({ username, password: passwordRef.current?.value ?? "", alsoApplyTo: [...ticked] });
        }}
      >
        <p className="text-xs text-ink-muted">
          RTU <span className="font-mono">{rtu.code}</span>. The current credential is never shown. Ingest uses the
          new one within about a minute.
        </p>
        <label className={labelClass}>
          Username
          <input
            className={fieldClass}
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className={labelClass}>
          Password
          <input
            ref={passwordRef}
            className={fieldClass}
            type="password"
            autoComplete="new-password"
            onInput={(event) => setHasPassword(event.currentTarget.value !== "")}
          />
        </label>
        {(siblings.data?.items.length ?? 0) > 0 ? (
          <fieldset className="space-y-1">
            <legend className={labelClass}>Also replace on the other RTUs on this broker</legend>
            {siblings.data!.items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={ticked.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(ticked);
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    setTicked(next);
                  }}
                />
                <span className="font-mono">{item.code}</span>
                <span className="text-ink-muted">{item.displayName}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {siblings.isError ? (
          <p role="alert" className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink">
            The other RTUs on this broker could not be loaded, so the credential cannot be replaced on them.{" "}
            <button type="button" className="underline" onClick={() => void siblings.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {tooMany ? (
          <p role="alert" className="text-xs text-critical-ink">
            At most {RTU_CREDENTIAL_SIBLINGS_MAX} other RTUs at once; untick some and repeat for the rest.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {/* Not while saving: a closed dialog must not hide a write still in flight. */}
          <button
            type="button"
            className="surface-button px-3 py-1 text-xs"
            onClick={cancel}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Please wait" : "Cancel"}
          </button>
          <button
            type="submit"
            // Code review 1: not before the sibling list has loaded, or a failed read would send a target-only replace.
            disabled={save.isPending || !siblings.isSuccess || tooMany || username === "" || !hasPassword}
            aria-busy={save.isPending}
            className="surface-button-primary px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Replace credentials"}
          </button>
        </div>
      </form>
    </AdminWizardFrame>
  );
}
