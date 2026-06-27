import { activeFilterSchema } from "./admin.schema";
import { createOrganizationBodySchema } from "./organizations/organizations.schema";
import { createAssetPointBodySchema } from "./asset-points/asset-points.schema";
import { createPointKeyBodySchema } from "./point-keys/point-keys.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lightweight schema checks for master-data admin DTOs. */
export function runAdminSchemaTests(): void {
  assert(activeFilterSchema.parse("all") === "all", "active filter all");
  assert(activeFilterSchema.parse("true") === "true", "active filter true");

  const org = createOrganizationBodySchema.parse({
    code: "DEMO",
    name: "Demo Org",
  });
  assert(org.code === "DEMO", "organization code parsed");

  const point = createAssetPointBodySchema.parse({
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    sourceDataKey: "total_kw",
  });
  assert(point.pointKey === "kw", "asset point key parsed");

  const catalogKey = createPointKeyBodySchema.parse({
    organizationId: "00000000-0000-4000-8000-000000000001",
    code: "kw",
    name: "Active Power",
    domain: "electrical",
  });
  assert(catalogKey.code === "kw", "point key catalog code parsed");
}

if (require.main === module) {
  runAdminSchemaTests();
  process.stdout.write("admin.schema tests: ok\n");
}
