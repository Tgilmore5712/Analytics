import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.project.findUnique({
    where: { id: 'cmm9abzdu000de3n4dqpmzn5x' },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      procoreId: true,
      bidBoardId: true,
      status: true,
      statusSource: true,
      customerSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const feedRows = await prisma.$queryRawUnsafe(
    `
      SELECT status, synced_at, linked_project_id, procore_id, external_id, match_confidence
      FROM procore_project_feed
      WHERE procore_id = $1
      ORDER BY synced_at DESC
      LIMIT 10
    `,
    '598134326376810'
  );

  console.log(
    JSON.stringify(
      { row, feedRows },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
