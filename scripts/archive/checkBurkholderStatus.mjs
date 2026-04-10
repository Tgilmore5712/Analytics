import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({
    where: {
      projectName: {
        contains: 'Burkholder Tractor',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      procoreId: true,
      bidBoardId: true,
      status: true,
      statusSource: true,
      customer: true,
      updatedAt: true,
      customFields: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const simplified = rows.map((row) => {
    const cf = row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
      ? row.customFields
      : {};

    return {
      id: row.id,
      projectName: row.projectName,
      projectNumber: row.projectNumber,
      procoreId: row.procoreId,
      bidBoardId: row.bidBoardId,
      status: row.status,
      statusSource: row.statusSource,
      customer: row.customer,
      updatedAt: row.updatedAt,
      statusRaw: cf.statusRaw ?? null,
      statusSyncedAt: cf.statusSyncedAt ?? null,
      syncedFrom: cf.syncedFrom ?? null,
      statusFeedProjectId: cf.statusFeedProjectId ?? null,
    };
  });

  console.log(JSON.stringify(simplified, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
