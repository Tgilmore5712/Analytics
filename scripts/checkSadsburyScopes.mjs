import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projectScopes = await prisma.$queryRawUnsafe(`
    SELECT id, "jobKey", title, "startDate", "endDate", hours, manpower, "updatedAt"
    FROM "ProjectScope"
    WHERE LOWER("jobKey") LIKE '%sadsbury%'
       OR LOWER(title) LIKE '%sadsbury%'
    ORDER BY "updatedAt" DESC
  `);

  const ganttProjects = await prisma.$queryRawUnsafe(`
    SELECT id, customer, project_number, project_name, created_at, updated_at
    FROM gantt_v2_projects
    WHERE LOWER(COALESCE(customer, '')) LIKE '%milex%'
       OR LOWER(COALESCE(project_name, '')) LIKE '%sadsbury%'
    ORDER BY updated_at DESC
  `);

  const ganttScopes = await prisma.$queryRawUnsafe(`
    SELECT p.id AS project_id, p.customer, p.project_number, p.project_name,
           s.id AS scope_id, s.title, s.start_date, s.end_date, s.total_hours, s.created_at, s.updated_at
    FROM gantt_v2_projects p
    LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
    WHERE LOWER(COALESCE(p.customer, '')) LIKE '%milex%'
       OR LOWER(COALESCE(p.project_name, '')) LIKE '%sadsbury%'
    ORDER BY p.updated_at DESC, s.updated_at DESC NULLS LAST
  `);

  console.log('\n=== ProjectScope rows ===');
  console.table(projectScopes);

  console.log('\n=== gantt_v2_projects rows ===');
  console.table(ganttProjects);

  console.log('\n=== gantt_v2_scopes rows ===');
  console.table(ganttScopes);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
