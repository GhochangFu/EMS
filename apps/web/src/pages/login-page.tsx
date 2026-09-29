import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchCurrentUser, loginRequest } from "../api/login";
import { isOidcEnabled, startOidcLogin } from "../api/oidc";
import { landingRouteForScope } from "../lib/landing-route";
import { useAuthStore } from "../stores/auth-store";
import { Wordmark } from "../components/wordmark";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const oidcEnabled = isOidcEnabled();
  const [email, setEmail] = useState("admin@bms.local");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => loginRequest(email, password),
    onSuccess: async (data) => {
      const current = await fetchCurrentUser(data.accessToken);
      // Local login has no OIDC id token.
      setSession(data.accessToken, current.user, current.scope, null);
      void navigate(landingRouteForScope(current.scope), { replace: true });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setFormError(null);
    mutation.mutate();
  }

  async function onOidcLogin(): Promise<void> {
    setFormError(null);
    try {
      await startOidcLogin();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "OIDC login failed");
    }
  }

  return (
    <div className="min-h-screen bg-chrome px-4 py-8 text-on-dark">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-on-dark/10 bg-on-dark/5 shadow-2xl lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgb(var(--accent)_/_0.34),_transparent_32%),linear-gradient(135deg,rgb(var(--chrome))_0%,rgb(var(--chrome))_54%,rgb(var(--chrome-nav)_/_0.35)_100%)] p-8 lg:p-10">
          <div className="absolute right-8 top-8 h-36 w-36 rounded-full border border-accent/30 bg-accent/10 blur-sm" />
          <div className="absolute bottom-12 left-10 h-24 w-24 rounded-full border border-on-dark/10 bg-on-dark/5" />
          <div className="relative">
            <div className="flex justify-center">
              <Wordmark variant="hero" />
            </div>
            <h1 className="mt-8 max-w-xl font-condensed text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Integrated <span className="text-accent">Building, Energy, Water &amp; Utility</span> Management · Smart insight, always on.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-on-dark/70">
              Unified enterprise EMS for power, HVAC, water, utilities, alarms,
              and work orders in one operator console for Ion Exchange (India)
              Ltd. operations.
            </p>
          </div>

          <div className="relative mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ["10", "Sites"],
              ["Live", "Telemetry"],
              ["99.98%", "Uptime"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-xl border border-on-dark/10 bg-on-dark/10 p-4 backdrop-blur"
              >
                <div className="font-condensed text-2xl font-bold text-on-dark">
                  {value}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-on-dark/60">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center bg-canvas p-6 text-ink sm:p-8">
          <div className="w-full max-w-md surface-raised p-7">
            <div className="mb-7 flex items-center justify-between gap-3">
              <div>
                <div className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-accent-strong">
                  Secure access
                </div>
                <h2 className="mt-2 font-condensed text-3xl font-bold text-ink">
                  Sign in to IONSiTE NEXUS
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Enterprise SSO and local pilot access for the Integrated Building, Energy, Water &amp; Utility Management Platform.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {/* Plan defect (F3.65c review): §2.4/OQ6 measured `scrim/0.4` "over chrome"
                    (17.20), but this badge sits inside the right-hand card on `bg-surface`, not
                    the hero. `scrim/0.4` over `surface` is 2.85 light — a plan-defect fix, not
                    the plan's own call: `chrome` is constant-dark in both themes and its
                    `on-dark` pair is already declared (§2.4's "TEXT_PAIRS" `on-dark` on `chrome`),
                    so it reproduces the original `#003366` badge's always-dark pixel. */}
                <span className="rounded bg-chrome px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-on-dark">
                  Euphoria Delivery
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-ink-muted">
                  Confidential
                </span>
              </div>
            </div>
        {oidcEnabled ? (
          <div className="mt-6 space-y-4">
            {formError ? (
              <p className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-sm text-critical-ink" role="alert">
                {formError}
              </p>
            ) : null}
            <button
              type="button"
              className="w-full surface-button-primary bg-accent py-3 text-sm font-semibold text-on-accent transition hover:bg-accent-strong"
              onClick={() => void onOidcLogin()}
            >
              Sign in securely with Keycloak
            </button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
                htmlFor="email"
              >
                Login ID
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                className="mt-1.5 w-full surface-field px-3 py-2.5 text-sm outline-none transition ring-focus focus:border-focus focus:ring-1"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                required
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
                htmlFor="password"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="mt-1.5 w-full surface-field px-3 py-2.5 text-sm outline-none transition ring-focus focus:border-focus focus:ring-1"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                required
              />
            </div>
            <div>
              <div className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Access profile
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {["NEXUS Admin", "IBMS Operator", "Energy Manager"].map((role) => (
                  <span
                    key={role}
                    className="surface-raised-sm rounded-full px-2 py-1 text-center font-semibold text-ink-muted"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
            {formError ? (
              <p className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-sm text-critical-ink" role="alert">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending}
              className="w-full surface-button-primary bg-accent py-3 text-sm font-semibold text-on-accent transition hover:bg-accent-strong disabled:opacity-60"
            >
              {mutation.isPending ? "Signing in..." : "Sign in securely"}
            </button>
          </form>
        )}
            <div className="mt-6 border-t border-well-deep pt-4 text-center text-[11px] leading-5 text-ink-muted">
              IONSiTE NEXUS v0.1<br />
              Powered By:{" "}
              <b className="text-ink">Euphoria Infotech India Limited</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
