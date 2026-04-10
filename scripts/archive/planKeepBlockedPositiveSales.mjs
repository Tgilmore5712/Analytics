import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

async function getBlockedArchivedProjects() {
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
      procoreId: true,
      bidBoardId: true,
      updatedAt: true,
    },
  });

  const archivedIds = archivedProjects.map((p) => p.id);
  const [
    scopeRows,
    scheduleRows,
    activeScheduleRows,
    scopeTrackingRows,
    productivityRows,
    timecardRows,
    timecardTypeRows,
    commitmentRows,
    changeOrderRows,
    lineItemRows,
    purchaseOrderRows,
    purchaseOrderDetailRows,
  ] = await Promise.all([
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
  for (const rows of [scopeRows, scheduleRows, activeScheduleRows, scopeTrackingRows, productivityRows, timecardRows, timecardTypeRows, commitmentRows, changeOrderRows, lineItemRows, purchaseOrderRows, purchaseOrderDetailRows]) {
    for (const row of rows) {
      if (row.projectId) blockedIds.add(row.projectId);
    }
  }

  return archivedProjects.filter((p) => blockedIds.has(p.id) && typeof p.sales === 'number' && p.sales > 0);
}

async function main() {
  const blockedPositive = await getBlockedArchivedProjects();
  const allProjects = await prisma.project.findMany({
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
      customerSource: true,
      procoreId: true,
      bidBoardId: true,
      projectArchived: true,
      updatedAt: true,
    },
  });

  const groups = new Map();
  for (const project of allProjects) {
    const key = `${norm(project.projectName)}|${norm(project.customer)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  }

  const plan = blockedPositive.map((keeper) => {
    const key = `${norm(keeper.projectName)}|${norm(keeper.customer)}`;
    const group = (groups.get(key) || []).filter((p) => p.id !== keeper.id);
    const activeDuplicates = group.filter((p) => !p.projectArchived);
    const archivedDuplicates = group.filter((p) => p.projectArchived);
    return {
      keep: keeper,
      key,
      activeDuplicates,
      archivedDuplicates,
      totalOtherRows: group.length,
    };
  }).sort((a, b) => a.keep.projectName.localeCompare(b.keep.projectName));

  console.log(JSON.stringify({
    keepCount: plan.length,
    withActiveDuplicate: plan.filter((p) => p.activeDuplicates.length > 0).length,
    withNoActiveDuplicate: plan.filter((p) => p.activeDuplicates.length === 0).length,
    sample: plan.slice(0, 30),
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
