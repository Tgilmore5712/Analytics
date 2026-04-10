import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Show all status values in use
const statuses = await prisma.$queryRawUnsafe(
  `SELECT status, status_raw, COUNT(*) as count FROM procore_bid_board_live GROUP BY status, status_raw ORDER BY count DESC`
);
console.log('\n--- Bid Board Status Values in DB ---');
for (const r of statuses) {
  console.log(`  status="${r.status}" | raw="${r.status_raw}" | count=${r.count}`);
}

// Show full payload keys + all status-related fields from a sample row
const sample = await prisma.$queryRawUnsafe(
  `SELECT name, status, status_raw, payload FROM procore_bid_board_live LIMIT 1`
);
if (sample.length > 0) {
  const p = sample[0].payload;
  console.log('\n--- Full payload keys for:', sample[0].name, '---');
  console.log(Object.keys(p).join(', '));

  console.log('\n--- Status-related field values ---');
  for (const key of Object.keys(p).filter(k => 
    k.toLowerCase().includes('stat') || 
    k.toLowerCase().includes('stage') || 
    k.toLowerCase().includes('phase') ||
    k.toLowerCase().includes('bid')
  )) {
    console.log(`  ${key}: ${JSON.stringify(p[key])}`);
  }
}

// Show a few rows with their raw payload status fields
const rows = await prisma.$queryRawUnsafe(
  `SELECT name, status, status_raw, 
          payload->>'bid_status' as bid_status,
          payload->>'project_stage' as p_stage,
          payload->'bid_status'->>'name' as bid_status_name,
          payload->'stage'->>'name' as stage_name
   FROM procore_bid_board_live 
   LIMIT 10`
);
console.log('\n--- Sample Bid Board Rows ---');
for (const r of rows) {
  console.log(`${String(r.name).padEnd(40)} | status=${r.status} | bid_status=${r.bid_status||''} | bid_status_name=${r.bid_status_name||''} | stage=${r.stage_name||''}`);
}

await prisma.$disconnect();
