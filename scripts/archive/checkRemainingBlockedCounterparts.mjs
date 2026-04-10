import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

async function getBlockedArchived() {
  const archivedProjects = await prisma.project.findMany({
    where: { projectArchived: true },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
      customerSource: true,
      projectArchived: true,
    },
  });

  const archivedIds = archivedProjects.map((p) => p.id);

  const refSets = await Promise.all([
    prisma.projectScope.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.schedule.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.activeSchedule.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.scopeTracking.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.productivityLog.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.timecardEntry.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.timecardTimeType.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentContract.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentChangeOrder.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentChangeOrderLineItem.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.purchaseOrderContract.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.purchaseOrderLineItemContractDetail.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
  ]);

  const blockedIds = new Set();
  for (const rows of refSets) {
    for (const row of rows) {
      if (row.projectId) blockedIds.add(row.projectId);
    }
  }

  return archivedProjects.filter((p) => blockedIds.has(p.id));
}

async function main() {
  const blocked = await getBlockedArchived();
  const all = await prisma.project.findMany({
    select: {
      id: true,
      projectName: true,
      customer: true,
      sales: true,
      projectArchived: true,
      customerSource: true,
      status: true,
    },
  });

  const byKey = new Map();
  for (const row of all) {
    const key = `${norm(row.projectName)}|${norm(row.customer)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const result = blocked
    .sort((a, b) => a.projectName.localeCompare(b.projectName))
    .map((row) => {
      const key = `${norm(row.projectName)}|${norm(row.customer)}`;
      const others = (byKey.get(key) || []).filter((p) => p.id !== row.id);
      const positive = others.filter((p) => typeof p.sales === 'number' && p.sales > 0);
      const activePositive = positive.filter((p) => !p.projectArchived);
      return {
        id: row.id,
        projectName: row.projectName,
        customer: row.customer,
        sales: row.sales,
        status: row.status,
        customerSource: row.customerSource,
        positiveCounterparts: positive.length,
        activePositiveCounterparts: activePositive.length,
        activePositiveSample: activePositive.slice(0, 3),
      };
    });

  const summary = {
    blockedCount: result.length,
    withAnyPositiveCounterpart: result.filter((r) => r.positiveCounterparts > 0).length,
    withActivePositiveCounterpart: result.filter((r) => r.activePositiveCounterparts > 0).length,
    withoutActivePositiveCounterpart: result.filter((r) => r.activePositiveCounterparts === 0).length,
    rows: result,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
