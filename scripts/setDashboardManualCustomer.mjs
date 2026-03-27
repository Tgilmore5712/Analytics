import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {
    projectName: '',
    projectId: '',
    customer: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project-name' && argv[i + 1]) {
      args.projectName = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--project-id' && argv[i + 1]) {
      args.projectId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--customer' && argv[i + 1]) {
      args.customer = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const { projectName, projectId, customer } = parseArgs(process.argv.slice(2));
  const targetCustomer = (customer || '').trim();
  if (!targetCustomer) {
    throw new Error('Missing --customer');
  }

  let whereClause;
  if (projectId.trim()) {
    whereClause = { id: projectId.trim() };
  } else if (projectName.trim()) {
    whereClause = { projectName: projectName.trim() };
  } else {
    throw new Error('Provide --project-id or --project-name');
  }

  const rows = await prisma.project.findMany({
    where: whereClause,
    select: { id: true, projectName: true, customer: true, status: true, customFields: true },
    orderBy: [{ id: 'asc' }],
  });

  if (rows.length === 0) {
    throw new Error('No matching project rows found');
  }

  for (const row of rows) {
    const existingCustomFields =
      row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
        ? row.customFields
        : {};

    await prisma.project.update({
      where: { id: row.id },
      data: {
        customer: targetCustomer,
        customFields: {
          ...existingCustomFields,
          customerManualLock: true,
          customerManualLockAt: new Date().toISOString(),
          customerManualLockNote: 'Dashboard manual override',
          customerSource: 'manual_override',
          customerSyncedAt: new Date().toISOString(),
        },
      },
    });
  }

  const updated = await prisma.project.findMany({
    where: whereClause,
    select: { id: true, projectName: true, customer: true, status: true, customFields: true },
    orderBy: [{ id: 'asc' }],
  });

  console.log(JSON.stringify({ updatedCount: updated.length, rows: updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
