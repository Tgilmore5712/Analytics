import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT name, status FROM procore_bid_board_live ORDER BY name`
);
console.log('All bid board names:');
for (const r of rows) console.log(' ', r.name, '|', r.status);

await prisma.$disconnect();
