import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://bms_app:bms_app_dev@localhost:5432/bms",
  },
  schemaFilter: ["bms", "telemetry"],
});
