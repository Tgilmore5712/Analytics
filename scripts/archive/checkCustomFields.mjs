import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const r = await prisma.$queryRawUnsafe(
  'SELECT name, payload FROM procore_projects_v1_live WHERE name ILIKE \'%burkholder%\' LIMIT 1'
);

const row = r[0];
console.log('payload type:', typeof row.payload);

const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
const cf = parsed?.custom_fields;

console.log('\ncustom_fields:');
console.log(JSON.stringify(cf, null, 2));

await prisma.$disconnect();
