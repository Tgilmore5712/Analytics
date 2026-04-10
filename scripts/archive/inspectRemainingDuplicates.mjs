import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function n(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function main() {
  const active = await prisma.project.findMany({
    where: { projectArchived: { not: true } },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      procoreId: true,
      bidBoardId: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { projectName: 'asc' },
  });

  const byName = new Map();
  for (const row of active) {
    const key = n(row.projectName);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  const duplicateNameGroups = [...byName.entries()]
    .map(([key, rows]) => ({ key, rows }))
    .filter((g) => g.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));

  const conservativeCandidates = duplicateNameGroups
    .filter((g) => {
      const hasProcore = g.rows.some((r) => !!r.procoreId);
      const hasNoProcore = g.rows.some((r) => !r.procoreId);
      return hasProcore && hasNoProcore;
    })
    .map((g) => ({
      key: g.key,
      count: g.rows.length,
      rows: g.rows.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        projectNumber: r.projectNumber,
        customer: r.customer,
        status: r.status,
        procoreId: r.procoreId,
        bidBoardId: r.bidBoardId,
        updatedAt: r.updatedAt,
      })),
    }));

  console.log(JSON.stringify({
    activeCount: active.length,
    duplicateNameGroupCount: duplicateNameGroups.length,
    conservativeCandidateGroupCount: conservativeCandidates.length,
    conservativeCandidates,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
