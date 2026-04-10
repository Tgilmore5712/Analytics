import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetProcoreId = '598134326278124';

  const existing = await prisma.project.findFirst({
    where: { procoreId: targetProcoreId },
    select: { id: true, status: true, statusSource: true, customFields: true },
  });

  if (!existing) {
    console.log('No endpoint-backed Burkholder row found.');
    return;
  }

  const existingCustomFields =
    existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
      ? existing.customFields
      : {};

  await prisma.project.update({
    where: { id: existing.id },
    data: {
      status: 'In Progress',
      statusSource: 'procore_v1',
      customFields: {
        ...existingCustomFields,
        statusRaw: 'In Progress',
        statusSyncedAt: new Date().toISOString(),
      },
    },
  });

  const updated = await prisma.project.findUnique({
    where: { id: existing.id },
    select: { id: true, projectName: true, status: true, statusSource: true, procoreId: true },
  });

  console.log(JSON.stringify({ before: existing, after: updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
