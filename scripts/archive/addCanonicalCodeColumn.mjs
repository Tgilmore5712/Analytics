import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE cost_code_categories ADD COLUMN IF NOT EXISTS canonical_code TEXT;`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS cost_code_categories_canonical_code_idx ON cost_code_categories (canonical_code);`
  );
  console.log('canonical_code column added.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
