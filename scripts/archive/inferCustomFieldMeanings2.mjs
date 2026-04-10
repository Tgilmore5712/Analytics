import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  'SELECT name, payload FROM procore_projects_v1_live LIMIT 65'
);

const fieldMap = {};

for (const row of rows) {
  const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const cf = parsed?.custom_fields;
  if (!cf || typeof cf !== 'object') continue;
  for (const [key, val] of Object.entries(cf)) {
    if (!fieldMap[key]) fieldMap[key] = { data_type: val?.data_type, samples: [] };
    // Collect non-null, non-empty samples
    const v = val?.value;
    const hasValue = v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
    if (fieldMap[key].samples.length < 5 && hasValue) {
      fieldMap[key].samples.push({ project: row.name, value: v });
    }
  }
}

console.log('\n=== Custom Field Definitions across all V1 projects ===\n');
for (const [id, info] of Object.entries(fieldMap)) {
  console.log(`Field: ${id}`);
  console.log(`  data_type: ${info.data_type}`);
  if (info.samples.length === 0) {
    console.log('  (all values null/empty)');
  }
  for (const s of info.samples) {
    console.log(`  [${s.project}]: ${JSON.stringify(s.value)}`);
  }
  console.log('');
}

await prisma.$disconnect();
