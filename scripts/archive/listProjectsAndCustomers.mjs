import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({
    select: {
      projectName: true,
      customer: true,
      projectNumber: true,
      status: true,
    },
    orderBy: [
      { customer: 'asc' },
      { projectName: 'asc' },
    ],
  });

  console.log(JSON.stringify({
    count: rows.length,
    rows: rows.map((row) => ({
      projectName: row.projectName || '',
      customer: row.customer || 'UNKNOWN',
      projectNumber: row.projectNumber || '',
      status: row.status || '',
    })),
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
