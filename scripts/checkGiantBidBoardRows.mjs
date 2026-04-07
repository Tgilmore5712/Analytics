import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT bid_board_id, procore_project_id, name, status, customer, synced_at
   FROM procore_bid_board_live
   WHERE LOWER(name) LIKE '%giant%'
   ORDER BY synced_at DESC`
);

console.log('Giant bid-board rows:', rows.length);
console.log(JSON.stringify(rows, null, 2));

await prisma.$disconnect();
