ALTER TABLE "bms"."work_orders"
ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "status"
      ORDER BY "created_at" DESC, "id" DESC
    ) - 1) * 1000 AS "next_sort_order"
  FROM "bms"."work_orders"
)
UPDATE "bms"."work_orders" AS "work_orders"
SET "sort_order" = ranked."next_sort_order"
FROM ranked
WHERE "work_orders"."id" = ranked."id";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_status_sort_order_idx"
ON "bms"."work_orders" ("status", "sort_order", "created_at");
