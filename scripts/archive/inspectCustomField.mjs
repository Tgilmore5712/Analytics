import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projectId = '598134326244946';
  const fieldPrefix = '$.custom_fields.custom_field_598134325737314';

  const rows = await prisma.procoreProjectStagingUnpackedField.findMany({
    where: {
      procoreProjectId: projectId,
      fieldPath: { startsWith: fieldPrefix },
    },
    orderBy: { fieldPath: 'asc' },
  });

  console.log(JSON.stringify(rows.map((row) => ({
    fieldPath: row.fieldPath,
    valueType: row.valueType,
    valueText: row.valueText,
    valueNumber: row.valueNumber,
    valueBoolean: row.valueBoolean,
    valueJson: row.valueJson,
  })), null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
