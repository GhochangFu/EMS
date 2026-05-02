import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { completeOidcLogin } from "../api/oidc";
import { fetchCurrentUser } from "../api/login";
import { landingRouteForScope } from "../lib/landing-route";
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
          void navigate(landingRouteForScope(current.scope), { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "OIDC login failed");
        }
      }
    }

    void completeLogin();

    return () => {
      cancelled = true;
    };
  }, [navigate, setSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bms-header px-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-white p-8 shadow-xl">
        <h1 className="font-condensed text-2xl font-bold text-bms-ink">
          Completing sign in
        </h1>
        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-4 text-sm text-bms-muted">
            Please wait while Keycloak returns you to SMOC BMS.
          </p>
        )}
      </div>
    </div>
  );
}
