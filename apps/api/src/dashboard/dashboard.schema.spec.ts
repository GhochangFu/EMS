import { locationDashboardQuerySchema } from "./dashboard.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lightweight schema checks for location dashboard RTU filter param. */
export function runDashboardSchemaTests(): void {
  const parsed = locationDashboardQuerySchema.parse({
    page: "2",
    pageSize: "25",
    rtuId: "ece05cf1-5c06-4bdb-a9be-f8d5a2860c0d",
  });
  assert(parsed.page === 2, "page should coerce to number");
  assert(parsed.pageSize === 25, "pageSize should coerce to number");
  assert(parsed.rtuId !== undefined, "rtuId should parse");

  const defaults = locationDashboardQuerySchema.parse({});
  assert(defaults.page === 1, "default page is 1");
  assert(defaults.rtuId === undefined, "rtuId is optional");
}
