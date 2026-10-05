import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { completeOidcLogin } from "../api/oidc";
import { fetchCurrentUser } from "../api/login";
import { apiErrorMessage } from "../lib/api-error-message";
import { takeReturnPath } from "../lib/return-path";
import { useAuthStore } from "../stores/auth-store";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeLogin(): Promise<void> {
      try {
        const session = await completeOidcLogin(window.location.search);
        if (!cancelled) {
          const current = await fetchCurrentUser(session.accessToken);
          setSession(
            session.accessToken,
            current.user,
            current.scope,
            session.idToken,
          );
          // `F3.77` (plan D10) — back to the wall URL a 401 kept in this tab's
          // `sessionStorage`, validated on read; else `/`, the caller's Control
          // Room entry level (`F3.72` plan D1).
          void navigate(takeReturnPath() ?? "/", { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          // `F4.203` (owner ruling) — `fetchCurrentUser` records the 401's reason
          // before it throws; a deactivated account reads the sentence the
          // sign-in page shows, not "Current user failed (401)".
          setError(
            useAuthStore.getState().authFailureReason === "account_deactivated"
              ? "Your account is deactivated. Ask an administrator."
              : apiErrorMessage(err),
          );
        }
      }
    }

    void completeLogin();

    return () => {
      cancelled = true;
    };
  }, [navigate, setSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-chrome px-4">
      <div className="w-full max-w-md surface-raised p-8">
        <h1 className="font-condensed text-2xl font-bold text-ink">
          Completing sign in
        </h1>
        {error ? (
          <p className="mt-4 text-sm text-critical-ink" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            Please wait while Keycloak returns you to IONSiTE NEXUS.
          </p>
        )}
      </div>
    </div>
  );
}
