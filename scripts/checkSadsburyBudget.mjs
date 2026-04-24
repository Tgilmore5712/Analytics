import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schedules = await prisma.schedule.findMany({
    where: {
      OR: [
        { customer: { contains: 'Milex', mode: 'insensitive' } },
        { projectName: { contains: 'Sadsbury', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      totalHours: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { customer: { contains: 'Milex', mode: 'insensitive' } },
        { projectName: { contains: 'Sadsbury', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true,
      sales: true,
      procoreId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  const feed = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM procore_project_feed f
    WHERE LOWER(to_jsonb(f)::text) LIKE '%milex%'
       OR LOWER(to_jsonb(f)::text) LIKE '%sadsbury%'
    ORDER BY synced_at DESC
    LIMIT 20
  `);

  const possibleProjectIds = new Set();
  for (const row of feed) {
    const candidateValues = [
      row?.procore_id,
      row?.project_id,
      row?.project_procore_id,
      row?.external_id,
    ];

    for (const value of candidateValues) {
      const text = String(value || '').trim();
      if (text) possibleProjectIds.add(text);
    }
  }

  const budgetByProject = [];
  for (const pid of possibleProjectIds) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT project_id, COUNT(*)::int AS line_items,
             SUM(COALESCE(amount, 0))::numeric(14,2) AS amount_sum,
             SUM(COALESCE(quantity, 0))::numeric(14,2) AS qty_sum,
             MAX(synced_at) AS last_synced
      FROM budgetlineitems
      WHERE project_id = $1
      GROUP BY project_id
    `, pid);
    rows.forEach((r) => budgetByProject.push(r));
  }

  const scheduleColumns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Schedule' OR table_name = 'schedule'
    ORDER BY ordinal_position
  `);

  const budgetColumns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'budgetlineitems'
    ORDER BY ordinal_position
  `);

  console.log('\n=== Schedule rows ===');
  console.table(schedules);

  console.log('\n=== Project rows ===');
  console.table(projects);

  console.log('\n=== Procore project feed rows ===');
  console.table(feed);

  console.log('\n=== Budget line item aggregates by project_id ===');
  console.table(budgetByProject);

  console.log('\n=== schedule columns ===');
  console.table(scheduleColumns);

  console.log('\n=== budgetlineitems columns ===');
  console.table(budgetColumns);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
