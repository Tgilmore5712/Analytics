import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.project.groupBy({
    by: ['status'],
    where: {
      procoreId: { not: null },
      projectArchived: { not: true },
    },
    _count: { _all: true },
    orderBy: { _count: { status: 'desc' } },
  });

  console.log('Endpoint-backed project status counts:');
  for (const row of counts) {
    console.log(`${String(row.status ?? '(null)')}: ${row._count._all}`);
  }

  const weird = await prisma.project.findMany({
    where: {
      procoreId: { not: null },
      status: { in: ['Course of Constructions', 'Post-Construction', 'Post Construction'] },
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      status: true,
      customer: true,
      customerSource: true,
      procoreId: true,
      customFields: true,
      updatedAt: true,
    },
    take: 25,
    orderBy: { updatedAt: 'desc' },
  });

  console.log('\nRows with questionable statuses:');
  console.log(JSON.stringify(weird, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
