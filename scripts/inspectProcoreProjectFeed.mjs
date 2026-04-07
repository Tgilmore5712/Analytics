import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const totals = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE soft_deleted = FALSE)::int AS active_rows,
      COUNT(*) FILTER (WHERE linked_project_id IS NOT NULL)::int AS linked_rows,
      COUNT(*) FILTER (WHERE match_confidence = 'high')::int AS high_confidence_rows,
      COUNT(*) FILTER (WHERE match_confidence = 'medium')::int AS medium_confidence_rows,
      COUNT(*) FILTER (WHERE match_confidence = 'low')::int AS low_confidence_rows,
      MAX(synced_at) AS latest_synced_at,
      MIN(synced_at) AS earliest_synced_at
    FROM procore_project_feed
  `);

  const statusCounts = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*)::int AS c
    FROM procore_project_feed
    WHERE soft_deleted = FALSE
    GROUP BY status
    ORDER BY c DESC, status
    LIMIT 40
  `);

  const linkedWithProjectStatus = await prisma.$queryRawUnsafe(`
    SELECT
      f.status AS feed_status,
      p."status" AS project_status,
      COUNT(*)::int AS c
    FROM procore_project_feed f
    JOIN "Project" p ON p.id = f.linked_project_id
    WHERE f.soft_deleted = FALSE
      AND f.linked_project_id IS NOT NULL
    GROUP BY f.status, p."status"
    ORDER BY c DESC
    LIMIT 30
  `);

  const focus = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      company_id,
      external_id,
      procore_id,
      project_name,
      status,
      linked_project_id,
      match_confidence,
      synced_at,
      soft_deleted
    FROM procore_project_feed
    WHERE project_name ILIKE '%Sadsbury Commons%'
       OR project_name ILIKE '%Burkholder Tractor%'
    ORDER BY synced_at DESC
    LIMIT 30
  `);

  console.log(JSON.stringify({ totals, statusCounts, linkedWithProjectStatus, focus }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
