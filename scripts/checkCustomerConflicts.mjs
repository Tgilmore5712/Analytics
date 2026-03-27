import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    WITH candidates AS (
      SELECT
        linked_project_id,
        project_name,
        customer,
        customer_source,
        sync_source,
        match_confidence,
        id,
        synced_at
      FROM procore_project_feed
      WHERE linked_project_id IS NOT NULL
        AND soft_deleted = FALSE
        AND match_confidence IN ('high', 'medium')
        AND customer IS NOT NULL
        AND BTRIM(customer) <> ''
        AND LOWER(BTRIM(customer)) NOT IN ('unknown', 'n/a', 'na', 'none', 'null', '-')
    )
    SELECT
      linked_project_id,
      MIN(project_name) AS project_name,
      COUNT(*)::int AS row_count,
      COUNT(DISTINCT customer)::int AS distinct_customer_count,
      ARRAY_AGG(DISTINCT customer ORDER BY customer) AS customers,
      ARRAY_AGG(
        sync_source || ':' || COALESCE(customer_source, 'unknown') || ':' || customer
        ORDER BY synced_at DESC, id DESC
      ) AS evidence
    FROM candidates
    GROUP BY linked_project_id
    HAVING COUNT(DISTINCT customer) > 1
    ORDER BY COUNT(DISTINCT customer) DESC, MIN(project_name) ASC
  `);

  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
