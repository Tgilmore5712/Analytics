import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    WITH v1 AS (
      SELECT company_id, LOWER(BTRIM(name)) AS n
      FROM procore_project_staging
      WHERE source = 'procore_v1_projects' AND name IS NOT NULL AND BTRIM(name) <> ''
    ),
    bb AS (
      SELECT company_id, LOWER(BTRIM(name)) AS n
      FROM procore_bid_board_live
      WHERE name IS NOT NULL AND BTRIM(name) <> ''
    )
    SELECT COUNT(*)::int AS total
    FROM v1
    JOIN bb ON bb.company_id = v1.company_id AND bb.n = v1.n
  `);

  const sample = await prisma.$queryRawUnsafe(`
    WITH v1 AS (
      SELECT company_id, name, LOWER(BTRIM(name)) AS n
      FROM procore_project_staging
      WHERE source = 'procore_v1_projects' AND name IS NOT NULL AND BTRIM(name) <> ''
    ),
    bb AS (
      SELECT company_id, name, status, LOWER(BTRIM(name)) AS n
      FROM procore_bid_board_live
      WHERE name IS NOT NULL AND BTRIM(name) <> ''
    )
    SELECT v1.name AS v1_name, bb.name AS bb_name, bb.status
    FROM v1
    JOIN bb ON bb.company_id = v1.company_id AND bb.n = v1.n
    LIMIT 15
  `);

  console.log(JSON.stringify({ nameMatches: rows?.[0]?.total ?? 0, sample }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
