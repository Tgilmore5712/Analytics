import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

async function main() {
  const row = await prisma.project.findFirst({
    where: {
      procoreId: '598134326377122',
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      customerSource: true,
      customFields: true,
    },
  });

  if (!row) {
    console.log('No row found');
    return;
  }

  const cf = row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
    ? row.customFields
    : {};

  const candidateKeys = [
    'customer',
    'customer_name',
    'customerName',
    'customerLabel',
    'owner',
    'ownerName',
    'client',
    'clientName',
    'companyName',
    'company',
  ];

  console.log(JSON.stringify({
    id: row.id,
    projectName: row.projectName,
    projectNumber: row.projectNumber,
    customer: row.customer,
    customerSource: row.customerSource,
    customFieldKeyCount: Object.keys(cf).length,
    customerCandidates: pick(cf, candidateKeys),
    sampleKeys: Object.keys(cf).slice(0, 40),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
