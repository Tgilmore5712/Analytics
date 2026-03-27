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

  const seen = new Set();
  const distinctRows = [];

  for (const row of rows) {
    const normalized = {
      customer: row.customer || 'UNKNOWN',
      projectName: row.projectName || '',
      projectNumber: row.projectNumber || '',
      status: row.status || '',
    };

    const key = [normalized.customer, normalized.projectName, normalized.projectNumber, normalized.status].join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    distinctRows.push(normalized);
  }

  const lines = [
    ['customer', 'projectName', 'projectNumber', 'status'].map(csvCell).join(','),
    ...distinctRows.map((row) => [
      row.customer,
      row.projectName,
      row.projectNumber,
      row.status,
    ].map(csvCell).join(',')),
  ];

  const outputPath = resolve('project_customer_list_distinct.csv');
  writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${distinctRows.length} distinct rows to ${outputPath}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
