import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const summary = await prisma.$queryRawUnsafe(`
    SELECT 'procore_projects_v1_live' AS table_name, COUNT(*)::int AS rows, MAX(synced_at) AS latest_synced_at
    FROM procore_projects_v1_live
    UNION ALL
    SELECT 'procore_bid_board_live' AS table_name, COUNT(*)::int AS rows, MAX(synced_at) AS latest_synced_at
    FROM procore_bid_board_live
  `);

  console.log(JSON.stringify(summary, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
