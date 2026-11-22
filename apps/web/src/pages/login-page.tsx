import { useMutation } from "@tanstack/react-query";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchCurrentUser, loginRequest } from "../api/login";
import { isOidcEnabled, startOidcLogin } from "../api/oidc";
import { applyPortalAppearance, fetchPublicAppearance } from "../api/public-appearance";
import { apiErrorMessage } from "../lib/api-error-message";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../lib/brand";
import { peekReturnPath, takeReturnPath } from "../lib/return-path";
import { useAuthStore } from "../stores/auth-store";
import { LoginSiteNetwork } from "../components/login-site-network";
import { Wordmark } from "../components/wordmark";

/**
 * `F4.398` (ADR 0142 Amendment 3) — the login hero's words. The page names no client (item 2), and
 * the panel says what the product does instead of showing fixed numbers (item 3).
 */
export const LOGIN_DESCRIPTION =
  "One operator console for power, HVAC, water, utilities, alarms and work orders, across every site you run.";

/** The monitored domains, each with the `d` of a 16 x 16 line icon. */
export const LOGIN_DOMAINS: ReadonlyArray<readonly [string, string]> = [
  ["Power", "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"],
  ["HVAC", "M2 5h7.5a2 2 0 1 0-2-2M2 8h10.5a2 2 0 1 1-2 2M2 11h5.5a2 2 0 1 1-2 2"],
  ["UPS", "M2.5 4.5h10v7h-10zM12.5 6.5H14v3h-1.5M5 7v2M7.5 7v2"],
  ["Water", "M8 1.5C5.5 5 4 7 4 9.5a4 4 0 0 0 8 0C12 7 10.5 5 8 1.5z"],
  ["Environment", "M7 2.5a1.5 1.5 0 0 1 3 0v6.5a3 3 0 1 1-3 0zM8.5 6v5"],
];

export const LOGIN_FEATURES: ReadonlyArray<readonly [string, string]> = [
  ["Real-time telemetry", "Each reading, as it arrives"],
  ["Alarms that reach people", "Routed, tracked, closed"],
  ["Energy insight", "Use, cost and trends"],
];

/** The delay of one `login-rise`, read by the rule in `index.css`. */
function riseAfter(seconds: number): CSSProperties {
  return { "--login-rise-delay": `${seconds.toFixed(2)}s` } as CSSProperties;
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  // `F4.203` — why the last session ended; a subscription, so a reason read late still renders.
  const authFailureReason = useAuthStore((s) => s.authFailureReason);
  const clearAuthFailure = useAuthStore((s) => s.clearAuthFailure);
  const oidcEnabled = isOidcEnabled();
  const [email, setEmail] = useState("admin@bms.local");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // `F3.77` (plan D10, OQ6) — read once: a wall session ended on a 401 and its URL is kept.
  const [sessionEnded] = useState(() => peekReturnPath() !== null);

  // F4.341 (ADR 0118 decision 12, Q5): the sign-in page shows the portal default, never an
  // organization's or a user's. A failed read leaves the page on the cached or the default look.
  useEffect(() => {
    let live = true;
    fetchPublicAppearance()
      .then((appearance) => {
        if (live) applyPortalAppearance(appearance);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const mutation = useMutation({
    mutationFn: () => loginRequest(email, password),
    onSuccess: async (data) => {
      const current = await fetchCurrentUser(data.accessToken);
      // Local login has no OIDC id token.
      setSession(data.accessToken, current.user, current.scope, null);
      // `F3.77` (plan D10) — back to the wall URL a 401 kept, validated on read;
      // else `/`, the caller's Control Room entry level (`F3.72` plan D1).
      void navigate(takeReturnPath() ?? "/", { replace: true });
    },
    onError: (err: unknown) => {
      setFormError(apiErrorMessage(err));
    },
  });

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setFormError(null);
    // `F4.203` (security L1) — a new attempt drops the last session's reason.
    clearAuthFailure();
    mutation.mutate();
  }

  async function onOidcLogin(): Promise<void> {
    setFormError(null);
    clearAuthFailure();
    try {
      await startOidcLogin();
    } catch (err) {
      setFormError(apiErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen bg-chrome px-4 py-8 text-on-dark">
      {sessionEnded ? (
        <p
          role="status"
          className="mx-auto mb-4 w-full max-w-6xl rounded-xl border border-warning-line bg-warning-wash px-4 py-3 text-sm font-semibold text-warning-ink"
        >
          Session ended — sign in to return to the wall view
        </p>
      ) : null}
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-on-dark/10 bg-on-dark/5 shadow-2xl lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative flex flex-col items-center justify-between overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgb(var(--accent)_/_0.34),_transparent_32%),linear-gradient(135deg,rgb(var(--chrome))_0%,rgb(var(--chrome))_54%,rgb(var(--chrome-nav)_/_0.35)_100%)] p-8 text-center lg:p-10">
          <LoginSiteNetwork />
          <div className="relative flex w-full flex-1 flex-col items-center justify-center">
            <Wordmark variant="hero" animated />
            <h1
              className="login-rise mt-8 max-w-xl font-condensed text-4xl font-bold leading-tight tracking-tight sm:text-5xl"
              style={riseAfter(0.55)}
            >
              {PRODUCT_TAGLINE}
            </h1>
            <p className="login-rise mt-4 max-w-lg text-sm leading-6 text-on-dark/70" style={riseAfter(0.7)}>
              {LOGIN_DESCRIPTION}
            </p>
            <ul aria-label={`What ${PRODUCT_NAME} monitors`} className="mt-6 flex flex-wrap justify-center gap-2">
              {LOGIN_DOMAINS.map(([name, icon], index) => (
                <li
                  key={name}
                  className="login-rise inline-flex items-center gap-1.5 rounded-full border border-on-dark/20 bg-chrome px-3 py-1 text-xs text-on-dark/80"
                  style={riseAfter(0.9 + index * 0.07)}
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={icon} />
                  </svg>
                  {name}
                </li>
              ))}
            </ul>
          </div>

          <ul aria-label={`What ${PRODUCT_NAME} does`} className="relative mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
            {LOGIN_FEATURES.map(([title, line], index) => (
              <li
                key={title}
                className="login-rise rounded-xl border border-on-dark/10 bg-chrome p-4"
                style={riseAfter(1.3 + index * 0.12)}
              >
                <div className="font-condensed text-base font-bold text-on-dark">{title}</div>
                <div className="mt-1 text-xs leading-5 text-on-dark/60">{line}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex items-center justify-center bg-canvas p-6 text-ink sm:p-8">
          <div className="w-full max-w-md surface-raised p-7">
            <div className="mb-7 flex items-center justify-between gap-3">
              <div>
                <div className="font-condensed text-2xs font-bold uppercase tracking-[0.18em] text-accent-strong">
                  Secure access
                </div>
                <h2 className="mt-2 font-condensed text-3xl font-bold text-ink">
                  Sign in to {PRODUCT_NAME}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Enterprise SSO and local pilot access.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {/* Plan defect (F3.65c review): §2.4/OQ6 measured `scrim/0.4` "over chrome"
                    (17.20), but this badge sits inside the right-hand card on `bg-surface`, not
                    the hero. `scrim/0.4` over `surface` is 2.85 light — a plan-defect fix, not
                    the plan's own call: `chrome` is constant-dark in both themes and its
                    `on-dark` pair is already declared (§2.4's "TEXT_PAIRS" `on-dark` on `chrome`),
                    so it reproduces the original `#003366` badge's always-dark pixel. */}
                <span className="rounded bg-chrome px-2.5 py-1 text-3xs font-bold uppercase tracking-wide text-on-dark">
                  Euphoria Delivery
                </span>
                <span className="font-mono text-3xs uppercase tracking-wide text-ink-muted">
                  Confidential
                </span>
              </div>
            </div>
        {/* `F4.203` — once, above both modes; a plain 401 holds no reason and shows nothing. */}
        {authFailureReason === "account_deactivated" ? (
          <p className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-sm text-critical-ink" role="alert">
            Your account is deactivated. Ask an administrator.
          </p>
        ) : null}
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
                {[`${PRODUCT_NAME} Admin`, "IBMS Operator", "Energy Manager"].map((role) => (
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
            <div className="mt-6 border-t border-well-deep pt-4 text-center text-2xs leading-5 text-ink-muted">
              {PRODUCT_NAME} v0.1<br />
              Powered By:{" "}
              <b className="text-ink">Euphoria Infotech India Limited</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
