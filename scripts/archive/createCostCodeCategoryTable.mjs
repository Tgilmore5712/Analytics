/**
 * Creates the cost_code_categories table in PostgreSQL.
 * Run once to set up the table; safe to re-run (uses IF NOT EXISTS).
 *
 * Usage: node scripts/createCostCodeCategoryTable.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cost_code_categories (
      id          TEXT        NOT NULL,
      cost_code   TEXT        NOT NULL,
      cost_name   TEXT        NOT NULL,
      category    TEXT        NOT NULL,
      item_type   TEXT        NOT NULL DEFAULT 'Labor',
      name        TEXT        NOT NULL,
      description TEXT,
      is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT cost_code_categories_pkey PRIMARY KEY (id),
      CONSTRAINT cost_code_categories_cost_code_key UNIQUE (cost_code)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS cost_code_categories_category_idx
      ON cost_code_categories (category);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS cost_code_categories_is_active_idx
      ON cost_code_categories (is_active);
  `);

  // Function to auto-update updated_at on every row change
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'cost_code_categories_updated_at'
      ) THEN
        CREATE TRIGGER cost_code_categories_updated_at
        BEFORE UPDATE ON cost_code_categories
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END;
    $$;
  `);

  console.log('cost_code_categories table ready.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
