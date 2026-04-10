import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS count FROM "timecard_cost_code_mappings"'
  );

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "timecard_cost_code_mappings"');

  const after = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS count FROM "timecard_cost_code_mappings"'
  );

  console.log(
    JSON.stringify(
      {
        before: before?.[0]?.count ?? null,
        after: after?.[0]?.count ?? null,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
