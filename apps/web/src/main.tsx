import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// F4.341 (ADR 0118 decision 5, Amendment 1 A2, plan P3): every face is self-hosted from the
// bundle; there is no Google Fonts call at run time. Plex Sans is the variable font with the
// `wght` and `wdth` axes (`standard.css`), so `font-condensed` is Plex Sans at `font-stretch: 85%`.
// A face downloads only when a design system's tokens name it (`@font-face` is lazy).
import "@fontsource-variable/ibm-plex-sans/standard.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource-variable/archivo";
import "@fontsource-variable/bricolage-grotesque";
import { App } from "./app";
import "./index.css";
import { bindSessionStores } from "./lib/query-cache-session";
import { shouldRetryQuery } from "./lib/query-retry";
import { useAuthStore } from "./stores/auth-store";

/**
 * `F4.63` — a refused request must not be retried.
 *
 * This was `new QueryClient()`, which took the library default `retry: 3`: an
 * out-of-scope template read cost four 403s and ~40s of "Loading…" before the
 * refusal rendered. The rule itself lives in `lib/query-retry.ts` with a spec,
 * because `apps/web`'s Vitest project cannot reach a `.tsx` — logic left here
 * would be invisible to every gate in this repository.
 *
 * Mutations are untouched: TanStack Query already defaults them to `retry: 0`.
 * `refetchOnWindowFocus` is untouched too — once the retries stop, a focus
 * refetch costs one request rather than four, which is the whole complaint.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetryQuery } },
});

/**
 * `F4.156` — the cache belongs to one session: cleared when the session ends
 * or the user changes, whichever exit ended it (logout, a 401, JWT expiry, a
 * failed `/me`). `F4.244`: the persisted copilot session is cleared with it.
 * Bound here at module level, not in an effect, so StrictMode cannot
 * subscribe twice. The rule and its spec are in `lib/query-cache-session.ts`.
 */
bindSessionStores(useAuthStore, queryClient);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
