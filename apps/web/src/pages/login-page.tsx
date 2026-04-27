import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { loginRequest } from "../api/login";
import { useAuthStore } from "../stores/auth-store";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("admin@bms.local");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => loginRequest(email, password),
    onSuccess: (data) => {
      setSession(data.accessToken, data.user);
      void navigate("/", { replace: true });
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-bms-header px-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-white p-8 shadow-xl">
        <h1 className="font-condensed text-2xl font-bold text-bms-ink">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-bms-muted">
          Eskom SMOC Building Management System
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label
              className="block text-xs font-medium text-bms-muted"
              htmlFor="email"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none ring-bms-green focus:ring-1"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium text-bms-muted"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none ring-bms-green focus:ring-1"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
          </div>
          {formError ? (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded bg-bms-green py-2.5 text-sm font-semibold text-white hover:bg-bms-green-dark disabled:opacity-60"
          >
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
