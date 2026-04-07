import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({
    where: {
      projectName: {
        contains: 'Sadsbury Commons',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      customerSource: true,
      status: true,
      statusSource: true,
      procoreId: true,
      bidBoardId: true,
      projectArchived: true,
      updatedAt: true,
      customFields: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const mapped = rows.map((r) => {
    const cf = r.customFields && typeof r.customFields === 'object' && !Array.isArray(r.customFields)
      ? r.customFields
      : {};

    return {
      id: r.id,
      projectName: r.projectName,
      projectNumber: r.projectNumber,
      customer: r.customer,
      customerSource: r.customerSource,
      status: r.status,
      statusSource: r.statusSource,
      procoreId: r.procoreId,
      bidBoardId: r.bidBoardId,
      projectArchived: r.projectArchived,
      updatedAt: r.updatedAt,
      syncedFrom: cf.syncedFrom ?? null,
      statusRaw: cf.statusRaw ?? null,
      statusFeedProjectId: cf.statusFeedProjectId ?? null,
      customerLabel: cf.customerLabel ?? null,
    };
  });

  console.log(JSON.stringify({ count: mapped.length, rows: mapped }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
