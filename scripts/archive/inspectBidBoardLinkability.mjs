import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE procore_project_id IS NOT NULL AND BTRIM(procore_project_id) <> '')::int AS with_project_id,
      COUNT(*) FILTER (WHERE procore_project_id IS NULL OR BTRIM(procore_project_id) = '')::int AS without_project_id
    FROM procore_bid_board_live
  `);

  const sampleNoId = await prisma.$queryRawUnsafe(`
    SELECT bid_board_id, name, status, procore_project_id, synced_at
    FROM procore_bid_board_live
    WHERE procore_project_id IS NULL OR BTRIM(procore_project_id) = ''
    ORDER BY synced_at DESC
    LIMIT 20
  `);

  console.log(JSON.stringify({ stats, sampleNoId }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
