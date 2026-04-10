import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function scalarCount(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  return rows?.[0]?.total ?? 0;
}

async function main() {
  const v1 = await scalarCount("SELECT COUNT(*)::int AS total FROM procore_project_staging WHERE source='procore_v1_projects'");
  const v1WithPid = await scalarCount("SELECT COUNT(*)::int AS total FROM procore_project_staging WHERE source='procore_v1_projects' AND procore_project_id IS NOT NULL");
  const v1WithBb = await scalarCount("SELECT COUNT(*)::int AS total FROM procore_project_staging WHERE source='procore_v1_projects' AND bid_board_status IS NOT NULL");
  const v2 = await scalarCount("SELECT COUNT(*)::int AS total FROM procore_project_staging WHERE source='procore_v2_bid_board'");
  const joinable = await scalarCount("SELECT COUNT(*)::int AS total FROM procore_project_staging s JOIN procore_bid_board_live b ON b.procore_project_id = s.procore_project_id WHERE s.source='procore_v1_projects'");

  console.log(JSON.stringify({
    v1,
    v1WithProcoreId: v1WithPid,
    v1WithBidBoardStatus: v1WithBb,
    v2Rows: v2,
    joinableWithBidBoardLive: joinable,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
