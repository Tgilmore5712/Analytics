import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.project.findUnique({
    where: { id: 'cmm9abzdu000de3n4dqpmzn5x' },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      status: true,
      statusSource: true,
      procoreId: true,
      bidBoardId: true,
      customerSource: true,
      dateCreated: true,
      dateUpdated: true,
      createdAt: true,
      updatedAt: true,
      customFields: true,
    },
  });

  const feedRows = await prisma.$queryRawUnsafe(
    `
      SELECT id, status, synced_at, linked_project_id, procore_id, external_id, match_confidence
      FROM procore_project_feed
      WHERE linked_project_id = $1 OR procore_id = $2
      ORDER BY synced_at DESC
      LIMIT 20
    `,
    'cmm9abzdu000de3n4dqpmzn5x',
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
