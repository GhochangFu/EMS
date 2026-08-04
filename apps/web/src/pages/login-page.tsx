import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchCurrentUser, loginRequest } from "../api/login";
import { isOidcEnabled, startOidcLogin } from "../api/oidc";
import { landingRouteForScope } from "../lib/landing-route";
import { useAuthStore } from "../stores/auth-store";
import trinetraLogoUrl from "../assets/trinetra-logo.jpeg";

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
      setSession(data.accessToken, current.user, current.scope);
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
    <div className="min-h-screen bg-[#07111f] px-4 py-8 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(0,166,81,0.34),_transparent_32%),linear-gradient(135deg,#0b1a2f_0%,#101827_54%,#05351f_100%)] p-8 lg:p-10">
          <div className="absolute right-8 top-8 h-36 w-36 rounded-full border border-bms-green/30 bg-bms-green/10 blur-sm" />
          <div className="absolute bottom-12 left-10 h-24 w-24 rounded-full border border-white/10 bg-white/5" />
          <div className="relative">
            <div className="flex justify-center">
              <img
                src={trinetraLogoUrl}
                alt="TRINETRA"
                className="w-full max-w-[560px] rounded-lg bg-white px-5 py-3 shadow-xl"
              />
            </div>
            <h1 className="mt-8 max-w-xl font-condensed text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Intelligent <span className="text-bms-green">Building Management</span> · Smart insight, always on.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/72">
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
                className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur"
              >
                <div className="font-condensed text-2xl font-bold text-white">
                  {value}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-white/58">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center bg-bms-canvas p-6 text-bms-ink sm:p-8">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 shadow-xl">
            <div className="mb-7 flex items-center justify-between gap-3">
              <div>
                <div className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-bms-green">
                  Secure access
                </div>
                <h2 className="mt-2 font-condensed text-3xl font-bold text-bms-ink">
                  Sign in to TRINETRA
                </h2>
                <p className="mt-1 text-sm text-bms-muted">
                  Enterprise SSO and local pilot access for the Intelligent Building Management System.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded bg-[#003366] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  Euphoria Delivery
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-bms-muted">
                  Confidential
                </span>
              </div>
            </div>
        {oidcEnabled ? (
          <div className="mt-6 space-y-4">
            {formError ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
            <button
              type="button"
              className="w-full rounded bg-bms-green py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-bms-green-dark"
              onClick={() => void onOidcLogin()}
            >
              Sign in securely with Keycloak
            </button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wide text-bms-muted"
                htmlFor="email"
              >
                Login ID
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                className="mt-1.5 w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition ring-bms-green focus:border-bms-green focus:ring-1"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                required
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wide text-bms-muted"
                htmlFor="password"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="mt-1.5 w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition ring-bms-green focus:border-bms-green focus:ring-1"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                required
              />
            </div>
            <div>
              <div className="mb-2 block text-xs font-semibold uppercase tracking-wide text-bms-muted">
                Access profile
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {["TRINETRA Admin", "IBMS Operator", "Energy Manager"].map((role) => (
                  <span
                    key={role}
                    className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-center font-semibold text-bms-muted"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
            {formError ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded bg-bms-green py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-bms-green-dark disabled:opacity-60"
            >
              {mutation.isPending ? "Signing in..." : "Sign in securely"}
            </button>
          </form>
        )}
            <div className="mt-6 border-t border-gray-100 pt-4 text-center text-[11px] leading-5 text-bms-muted">
              TRINETRA v0.1<br />
              Powered By:{" "}
              <b className="text-bms-ink">Euphoria Infotech India Limited</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
