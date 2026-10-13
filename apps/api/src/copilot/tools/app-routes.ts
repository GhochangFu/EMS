/**
 * `F3.85` PR 7 / ADR 0099 decision 1 — the app routes `open_page` may send the
 * dock to. Each is a `path=` of `apps/web/src/app.tsx` (`copilot-read-tools.spec.ts`'s
 * `assertTheRouteTemplatesAreTheWebAppsRoutes` reads that file and fails when a
 * template here is not one of them).
 *
 * Left out on purpose: `/login` and `/auth/callback` (they end or restart the
 * session) and the `*` catch-all.
 */
export const COPILOT_APP_ROUTE_TEMPLATES: readonly string[] = [
  "/",
  "/locations/:locationId/dashboard",
  "/alarms",
  "/alarm-kb",
  "/attributions",
  "/dashboards",
  "/dashboards/:slug",
  "/sustainability",
  "/asset-browser",
  "/map",
  "/sld",
  "/crac",
  "/energy",
  "/work-orders",
  "/maintenance-schedules",
  "/rules",
  "/reports",
  "/control-room",
  "/control-room/org/:organizationId",
  "/control-room/site/:locationId/:tab?",
  "/cr-overview",
  "/cr-sld",
  "/cr-it",
  "/cr-ups",
  "/cr-battery",
  "/cr-hvac",
  "/cr-env",
  "/admin",
  "/admin/organizations",
  "/admin/organizations/:orgId/ai-assistant",
  "/admin/organizations/:orgId/locations",
  "/admin/locations",
  "/admin/locations/:locationId/rtus",
  "/admin/locations/:locationId/rtus/:rtuId/assets",
  "/admin/notification-channels",
  "/admin/notification-deliveries",
  "/admin/escalation-profiles",
  "/admin/rtus",
  "/admin/assets",
  "/admin/assets/:assetId/points",
  "/admin/asset-templates",
  "/admin/asset-templates/:templateId",
  "/admin/asset-templates/stock/:code",
  "/admin/asset-templates/:templateId/versions",
  "/admin/dashboard-templates",
  "/admin/dashboard-templates/:templateId",
  "/admin/dashboard-templates/stock/:code",
  "/admin/asset-points",
  "/admin/manual-readings",
  "/admin/asset-groups",
  "/admin/users",
  "/admin/point-keys",
  "/admin/location-types",
  "/admin/mimic-layouts",
  "/admin/mimic-layouts/new",
  "/admin/mimic-layouts/:layoutId",
  "/admin/mimic-symbol-libraries",
  "/admin/calc-parameters",
  "/admin/dashboards",
  "/admin/dashboards/:slug",
  "/admin/telemetry/import",
];

/** What one path parameter may hold: an id, a slug or a code. Nothing that can change the path's shape. */
const PARAM_VALUE = /^[A-Za-z0-9_-]{1,200}$/;

const ROUTE_MAX_CHARS = 300;

function matchesTemplate(segments: readonly string[], template: string): boolean {
  const parts = template === "/" ? [] : template.slice(1).split("/");
  const required = parts.filter((part) => !part.endsWith("?")).length;
  if (segments.length < required || segments.length > parts.length) return false;
  return parts.every((part, index) => {
    const segment = segments[index];
    if (segment === undefined) return part.endsWith("?");
    return part.startsWith(":") ? PARAM_VALUE.test(segment) : segment === part;
  });
}

/**
 * Whether `route` is a concrete path of an allow-listed template: one leading
 * `/`, no scheme, no `//`, no query or fragment, no trailing `/`, and each
 * parameter an id-shaped value.
 */
export function isAllowedAppRoute(route: string): boolean {
  if (route.length === 0 || route.length > ROUTE_MAX_CHARS || !route.startsWith("/")) return false;
  if (route === "/") return true;
  if (route.startsWith("//") || /[?#:\\\s%]/.test(route) || route.endsWith("/")) return false;
  const segments = route.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  return COPILOT_APP_ROUTE_TEMPLATES.some((template) => matchesTemplate(segments, template));
}
