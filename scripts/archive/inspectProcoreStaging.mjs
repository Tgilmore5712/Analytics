import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const summary = await prisma.$queryRawUnsafe(`
    SELECT
      source,
      COUNT(*)::int AS row_count,
      MAX(synced_at) AS latest_synced_at,
      MIN(synced_at) AS earliest_synced_at
    FROM procore_project_staging
    GROUP BY source
    ORDER BY source
  `);

  const distinctProjects = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT procore_project_id)::int AS distinct_procore_projects
    FROM procore_project_staging
    WHERE procore_project_id IS NOT NULL
  `);

  const projectCoverage = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "Project" WHERE "procoreId" IS NOT NULL) AS endpoint_projects,
      (SELECT COUNT(DISTINCT procore_project_id)::int FROM procore_project_staging WHERE procore_project_id IS NOT NULL) AS staging_distinct_project_ids
  `);

  const sampleStatuses = await prisma.$queryRawUnsafe(`
    SELECT source, status, COUNT(*)::int AS c
    FROM procore_project_staging
    WHERE status IS NOT NULL
    GROUP BY source, status
    ORDER BY source, c DESC, status
    LIMIT 30
  `);

  const focus = await prisma.$queryRawUnsafe(`
    SELECT source, external_id, procore_project_id, name, status, customer, synced_at
    FROM procore_project_staging
    WHERE name ILIKE '%Sadsbury Commons%'
       OR name ILIKE '%Burkholder Tractor%'
    ORDER BY name, synced_at DESC
    LIMIT 20
  `);

  console.log(JSON.stringify({
    summary,
    distinctProjects,
    projectCoverage,
    sampleStatuses,
    focus,
  }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
