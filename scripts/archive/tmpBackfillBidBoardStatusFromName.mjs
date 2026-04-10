import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.$executeRawUnsafe(`
    WITH ranked_bid AS (
      SELECT
        b.company_id,
        LOWER(BTRIM(COALESCE(b.name, ''))) AS name_key,
        b.status,
        b.bid_board_id,
        ROW_NUMBER() OVER (
          PARTITION BY b.company_id, LOWER(BTRIM(COALESCE(b.name, '')))
          ORDER BY b.synced_at DESC
        ) AS rn
      FROM procore_bid_board_live b
      WHERE COALESCE(BTRIM(b.name), '') <> ''
    ), latest_bid AS (
      SELECT company_id, name_key, status, bid_board_id
      FROM ranked_bid
      WHERE rn = 1
    )
    UPDATE procore_project_staging s
    SET
      bid_board_status = lb.status,
      payload = COALESCE(s.payload, '{}'::jsonb) || jsonb_build_object(
        'bidBoardStatus', lb.status,
        'bidBoardExternalId', lb.bid_board_id,
        'bidBoardSyncedAt', NOW()::text,
        'bidBoardMatchMode', 'name_backfill'
      ),
      synced_at = NOW()
    FROM latest_bid lb
    WHERE s.source = 'procore_v1_projects'
      AND s.company_id = lb.company_id
      AND LOWER(BTRIM(COALESCE(s.name, ''))) = lb.name_key
      AND COALESCE(s.bid_board_status, '') = ''
  `);

  const after = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total
    FROM procore_project_staging
    WHERE source = 'procore_v1_projects'
      AND bid_board_status IS NOT NULL
  `);

  console.log(JSON.stringify({ updatedRows: updated, v1WithBidBoardStatusAfter: after?.[0]?.total ?? 0 }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
