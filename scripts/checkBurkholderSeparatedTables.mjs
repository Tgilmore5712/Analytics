import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const v1 = await prisma.$queryRawUnsafe(`
    SELECT procore_project_id, name, status, status_raw, customer, synced_at
    FROM procore_projects_v1_live
    WHERE name ILIKE '%Burkholder Tractor%' OR procore_project_id = '598134326278124'
    ORDER BY synced_at DESC
    LIMIT 10
  `);

  const bb = await prisma.$queryRawUnsafe(`
    SELECT bid_board_id, procore_project_id, name, status, status_raw, customer, synced_at
    FROM procore_bid_board_live
    WHERE name ILIKE '%Burkholder Tractor%' OR procore_project_id = '598134326278124'
    ORDER BY synced_at DESC
    LIMIT 10
  `);

  console.log(JSON.stringify({ v1, bidBoard: bb }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
