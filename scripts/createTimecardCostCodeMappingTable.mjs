import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "timecard_cost_code_mappings" (
      id TEXT NOT NULL PRIMARY KEY,
      "procore_project_id" TEXT NOT NULL,
      "project_id" TEXT NULL,
      "timecard_cost_code" TEXT NOT NULL,
      "po_cost_code" TEXT NOT NULL,
      "match_type" TEXT NOT NULL DEFAULT 'manual',
      confidence DOUBLE PRECISION NULL,
      "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
      "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tccm_unique_map
    ON "timecard_cost_code_mappings" ("procore_project_id", "timecard_cost_code", "po_cost_code")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tccm_project
    ON "timecard_cost_code_mappings" ("procore_project_id")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tccm_project_id
    ON "timecard_cost_code_mappings" ("project_id")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tccm_timecard_code
    ON "timecard_cost_code_mappings" ("timecard_cost_code")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tccm_po_code
    ON "timecard_cost_code_mappings" ("po_cost_code")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tccm_flags
    ON "timecard_cost_code_mappings" ("is_primary", "is_active")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tccm_primary_active
    ON "timecard_cost_code_mappings" ("procore_project_id", "timecard_cost_code")
    WHERE "is_primary" = TRUE AND "is_active" = TRUE
  `);

  console.log("timecard_cost_code_mappings table and indexes are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
