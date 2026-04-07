import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_projects_v1_live (
      procore_project_id TEXT PRIMARY KEY,
      company_id TEXT,
      name TEXT,
      project_number TEXT,
      status TEXT,
      status_raw TEXT,
      customer TEXT,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_projects_v1_live_status_idx
      ON procore_projects_v1_live (status)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_projects_v1_live_synced_at_idx
      ON procore_projects_v1_live (synced_at DESC)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_bid_board_live (
      bid_board_id TEXT PRIMARY KEY,
      company_id TEXT,
      procore_project_id TEXT,
      name TEXT,
      status TEXT,
      status_raw TEXT,
      customer TEXT,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_procore_project_id_idx
      ON procore_bid_board_live (procore_project_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_status_idx
      ON procore_bid_board_live (status)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_synced_at_idx
      ON procore_bid_board_live (synced_at DESC)
  `);

  const counts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM procore_projects_v1_live) AS v1_rows,
      (SELECT COUNT(*)::int FROM procore_bid_board_live) AS bid_board_rows
  `);

  console.log('Separated live endpoint tables are ready.');
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
