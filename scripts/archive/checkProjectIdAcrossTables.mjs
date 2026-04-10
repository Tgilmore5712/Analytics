import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const targetId = String(process.argv[2] || '598134326375662').trim();

async function main() {
  const v1 = await prisma.$queryRawUnsafe(
    `SELECT procore_project_id, name, project_number, status, synced_at
     FROM procore_projects_v1_live
     WHERE procore_project_id = $1`,
    targetId
  );

  const bidByProjectId = await prisma.$queryRawUnsafe(
    `SELECT bid_board_id, procore_project_id, name, status, synced_at
     FROM procore_bid_board_live
     WHERE procore_project_id = $1`,
    targetId
  );

  const bidByName = await prisma.$queryRawUnsafe(
    `SELECT bid_board_id, procore_project_id, name, status, synced_at
     FROM procore_bid_board_live
     WHERE LOWER(BTRIM(name)) = LOWER(BTRIM('Giant #6582'))`,
  );

  const staging = await prisma.$queryRawUnsafe(
    `SELECT source, external_id, procore_project_id, name, status, synced_at
     FROM procore_project_staging
     WHERE procore_project_id = $1 OR external_id = $1`,
    targetId
  );

  const projectRows = await prisma.project.findMany({
    where: {
      OR: [
        { procoreId: targetId },
        { customFields: { path: ['procoreId'], equals: targetId } },
        { projectName: { contains: 'Giant #6582', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      status: true,
      statusSource: true,
      procoreId: true,
      bidBoardId: true,
      customer: true,
      updatedAt: true,
    },
  });

  console.log('=== procore_projects_v1_live by procore_project_id ===');
  console.log(JSON.stringify(v1, null, 2));

  console.log('\n=== procore_bid_board_live by procore_project_id ===');
  console.log(JSON.stringify(bidByProjectId, null, 2));

  console.log('\n=== procore_bid_board_live by name Giant #6582 ===');
  console.log(JSON.stringify(bidByName, null, 2));

  console.log('\n=== procore_project_staging by procore_project_id/external_id ===');
  console.log(JSON.stringify(staging, null, 2));

  console.log('\n=== Project table matches ===');
  console.log(JSON.stringify(projectRows, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
