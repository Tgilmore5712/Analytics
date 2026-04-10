import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE procore_project_staging
    SET
      bid_board_status = CASE
        WHEN LOWER(REPLACE(COALESCE(status, ''), '-', ' ')) = 'bidding' THEN 'BID_SUBMITTED'
        WHEN LOWER(REPLACE(COALESCE(status, ''), '-', ' ')) = 'pre construction' THEN 'ESTIMATING'
        WHEN LOWER(REPLACE(COALESCE(status, ''), '-', ' ')) = 'post construction' THEN 'COMPLETE'
        WHEN LOWER(REPLACE(COALESCE(status, ''), '-', ' ')) = 'course of construction' THEN 'IN_PROGRESS'
        ELSE bid_board_status
      END,
      payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
        'bidBoardStatusFallbackAppliedAt', NOW()::text,
        'bidBoardMatchMode', 'v1_status_fallback'
      ),
      synced_at = NOW()
    WHERE source = 'procore_v1_projects'
      AND (bid_board_status IS NULL OR BTRIM(bid_board_status) = '')
      AND LOWER(REPLACE(COALESCE(status, ''), '-', ' ')) IN (
        'bidding',
        'pre construction',
        'post construction',
        'course of construction'
      )
  `);

  const stats = await prisma.$queryRawUnsafe(`
    SELECT bid_board_status, COUNT(*)::int AS total
    FROM procore_project_staging
    WHERE source = 'procore_v1_projects'
      AND bid_board_status IS NOT NULL
    GROUP BY bid_board_status
    ORDER BY total DESC
  `);

  console.log(JSON.stringify({ updatedRows: updated, stats }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
