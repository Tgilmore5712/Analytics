import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stats = await prisma.$queryRawUnsafe(`
    SELECT bid_board_status, COUNT(*)::int AS total
    FROM procore_project_staging
    WHERE source = 'procore_v1_projects'
    GROUP BY bid_board_status
    ORDER BY total DESC
  `);

  console.log(JSON.stringify(stats, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
