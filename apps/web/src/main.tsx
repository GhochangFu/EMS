import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app";
import "./index.css";
import { shouldRetryQuery } from "./lib/query-retry";

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
