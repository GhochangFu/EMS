import { z } from "zod";

import { COPILOT_BAD_ROUTE_TOOL_ERROR } from "../copilot-turn.service";
import { isAllowedAppRoute } from "./app-routes";
import { defineReadTool } from "./copilot-read-tool";

/**
 * `open_page` — asks the dock to navigate. It reads nothing, so it reports no
 * organization. The route must be a concrete path of an allow-listed app
 * route template (`app-routes.ts`); the dock navigates with the router only.
 */
export const openPageTool = defineReadTool({
  name: "open_page",
  description:
    "Open an app page for the user, for example /alarms, /admin/assets or /dashboards/<slug>. " +
    "Give a path only: one leading /, no host, no query.",
  schema: z.object({ route: z.string().min(1).max(300) }).strict(),
  async run(_services, args) {
    if (!isAllowedAppRoute(args.route)) return { ok: false, error: COPILOT_BAD_ROUTE_TOOL_ERROR };
    return { ok: true, result: { route: args.route }, organizationIds: [], navigateTo: args.route };
  },
});
