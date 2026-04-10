import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT name, payload FROM procore_projects_v1_live WHERE payload IS NOT NULL LIMIT 20`
);

const fieldMap = {};

for (const row of rows) {
  const cf = row.payload?.custom_fields;
  if (!cf || typeof cf !== 'object') continue;
  for (const [key, val] of Object.entries(cf)) {
    if (!fieldMap[key]) fieldMap[key] = { data_type: val?.data_type, samples: [] };
    if (fieldMap[key].samples.length < 3 && val?.value != null) {
      fieldMap[key].samples.push({ project: row.name, value: val.value });
    }
  }
}

console.log('\n=== Custom Field Definitions ===\n');
for (const [id, info] of Object.entries(fieldMap)) {
  console.log('Field: ' + id);
  console.log('  data_type: ' + info.data_type);
  for (const s of info.samples) {
    console.log('  sample [' + s.project + ']: ' + JSON.stringify(s.value));
  }
  console.log('');
}

await prisma.$disconnect();
