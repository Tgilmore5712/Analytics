import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();

function csvCell(value) {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

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

  const lines = [
    ['customer', 'projectName', 'projectNumber', 'status'].map(csvCell).join(','),
    ...rows.map((row) => [
      row.customer || 'UNKNOWN',
      row.projectName || '',
      row.projectNumber || '',
      row.status || '',
    ].map(csvCell).join(',')),
  ];

  const outputPath = resolve('project_customer_list.csv');
  writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${rows.length} rows to ${outputPath}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
