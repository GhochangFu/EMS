import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, UserRole } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { AppShell } from "../app-shell";

/**
 * `F4.341` PR 5 (plan §5 PR 5) — the sidebar shell is today's shell, moved: the chrome header, the
 * top navigation bar and the module sidebar render byte for byte as they did before the shells
 * were split (the fixture was captured from `app-shell.tsx` at `F4.341` PR 4, before the move). The
 * footer is left out because its clock ticks.
 */
const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

function chromeMarkup(role: UserRole, path: string): string {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ scope: GLOBAL });
  const user = { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={user} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return ["header", "nav", "aside"].map((tag) => container.querySelector(tag)?.outerHTML ?? `<!-- no ${tag} -->`).join("\n");
}

export function captureForFixture(): string {
  return ["admin:/alarms", "operator:/control-room/site/x"]
    .map((c) => {
      const [role, path] = c.split(":") as [UserRole, string];
      return `<!-- ${role} ${path} -->\n${chromeMarkup(role, path)}`;
    })
    .join("\n");
}

export async function theSidebarShellIsTodaysMarkup(): Promise<void> {
  await expect(captureForFixture()).toMatchFileSnapshot("./__fixtures__/sidebar-shell.html");
}
