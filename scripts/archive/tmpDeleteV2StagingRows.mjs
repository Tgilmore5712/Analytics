import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function countBySource() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT source, COUNT(*)::int AS total, MAX(synced_at) AS latest
    FROM procore_project_staging
    GROUP BY source
    ORDER BY total DESC
  `);
  return rows;
}

async function main() {
  const before = await countBySource();

  const deleted = await prisma.$executeRawUnsafe(`
    DELETE FROM procore_project_staging
    WHERE source = 'procore_v2_bid_board'
  `);

  const after = await countBySource();

  console.log(JSON.stringify({ before, deletedRows: deleted, after }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
