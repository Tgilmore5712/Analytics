import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Find Burkholder in bid board
const rows = await prisma.$queryRawUnsafe(
  `SELECT name, status, status_raw, payload FROM procore_bid_board_live WHERE name ILIKE '%burkholder%'`
);

if (rows.length === 0) {
  console.log('Burkholder not found in procore_bid_board_live');
} else {
  for (const r of rows) {
    console.log(`\n--- ${r.name} ---`);
    console.log('status:', r.status);
    console.log('status_raw:', r.status_raw);
    console.log('\nFull payload:');
    console.log(JSON.stringify(r.payload, null, 2));
  }
}

await prisma.$disconnect();
