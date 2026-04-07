import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT name, status, status_raw, payload FROM procore_projects_v1_live WHERE name ILIKE '%burkholder%'`
);

if (rows.length === 0) {
  console.log('Not found in V1 live table');
} else {
  for (const r of rows) {
    console.log(`\n=== ${r.name} ===`);
    console.log('stored status:', r.status);
    console.log('\nFull payload:');
    console.log(JSON.stringify(r.payload, null, 2));
  }
}

await prisma.$disconnect();
