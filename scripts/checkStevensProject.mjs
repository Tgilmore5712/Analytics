import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({
    where: {
      projectName: {
        contains: 'Stevens Feed Mill Schoeneck',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      customerSource: true,
      procoreId: true,
      bidBoardId: true,
      status: true,
      customFields: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
