/**
 * Debug script: check jobKey formats for "Canine Partners for Life"
 * and "C. Raymond Davis & Sons, Inc." in both gantt_v2_projects and activeSchedule.
 *
 * Run with: node scripts/debugDoublingBug.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEARCH_TERMS = ['canine partners', 'raymond davis'];

async function main() {
  console.log('=== gantt_v2_projects rows ===');
  const ganttProjects = await prisma.$queryRawUnsafe(`
    SELECT id, customer, project_number, project_name,
           customer || '~' || COALESCE(project_number,'') || '~' || project_name AS derived_job_key
    FROM gantt_v2_projects
    WHERE LOWER(customer) LIKE '%canine%'
       OR LOWER(customer) LIKE '%raymond%'
    ORDER BY customer
  `);
  console.table(ganttProjects);

  console.log('\n=== activeSchedule jobKeys matching these projects ===');
  const activeRows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "jobKey", "scopeOfWork", source, COUNT(*) AS entry_count
    FROM "ActiveSchedule"
    WHERE LOWER("jobKey") LIKE '%canine%'
       OR LOWER("jobKey") LIKE '%raymond%'
    GROUP BY "jobKey", "scopeOfWork", source
    ORDER BY "jobKey", "scopeOfWork"
  `);
  console.table(activeRows);

  console.log('\n=== Summary: distinct jobKeys in activeSchedule ===');
  const distinctKeys = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "jobKey"
    FROM "ActiveSchedule"
    WHERE LOWER("jobKey") LIKE '%canine%'
       OR LOWER("jobKey") LIKE '%raymond%'
    ORDER BY "jobKey"
  `);
  distinctKeys.forEach(r => console.log('  ', JSON.stringify(r.jobKey)));
}

async function main2() {
  console.log('=== gantt_v2_scopes for Canine Partners for Life project ===');
  const ganttScopes = await prisma.$queryRawUnsafe(`
    SELECT s.id, s.title, s.start_date, s.end_date, s.total_hours, s.crew_size, s.predecessor_scope_id,
           p.customer, p.project_number, p.project_name
    FROM gantt_v2_scopes s
    JOIN gantt_v2_projects p ON p.id = s.project_id
    WHERE LOWER(p.customer) LIKE '%raymond%'
       OR LOWER(p.customer) LIKE '%canine%'
    ORDER BY p.customer, s.title
  `);
  console.table(ganttScopes);

  console.log('\n=== gantt_v2_schedule_entries for these scopes ===');
  if (ganttScopes.length > 0) {
    const scopeIds = ganttScopes.map(s => s.id);
    const placeholder = scopeIds.map((_, i) => `$${i + 1}`).join(', ');
    const schedEntries = await prisma.$queryRawUnsafe(`
      SELECT scope_id, COUNT(*) as entry_count, SUM(scheduled_hours) as total_hours
      FROM gantt_v2_schedule_entries
      WHERE scope_id IN (${placeholder})
      GROUP BY scope_id
      ORDER BY scope_id
    `, ...scopeIds);
    console.table(schedEntries);
  }
}

async function main3() {
  console.log('=== ProjectScope entries for this project ===');
  const projectScopes = await prisma.$queryRawUnsafe(`
    SELECT id, "jobKey", title, hours, manpower, "schedulingMode",
           CASE WHEN tasks IS NULL THEN 'null' ELSE tasks::text END AS tasks_json,
           "startDate", "endDate"
    FROM "ProjectScope"
    WHERE "jobKey" LIKE '%canine%' OR "jobKey" LIKE '%raymond%' OR "jobKey" LIKE '%2508%'
    ORDER BY title, "updatedAt" DESC
  `);
  console.table(projectScopes);
}

main()
  .then(() => main2())
  .then(() => main3())
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
