import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ids = [
    'cmmaqpkxk0003e3fsuso9b024',
    'cmmm511oh0018e3k0sddst5a6',
    'cmmf747l70001e3w44cuzps5j',
  ];

  const rows = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      projectName: true,
      projectArchived: true,
    },
  });

  console.log(JSON.stringify({ requestedIds: ids, found: rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
