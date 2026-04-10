import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function main() {
  const archivedProjects = await prisma.project.findMany({
    where: { projectArchived: true },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      status: true,
      updatedAt: true,
    },
    orderBy: [{ projectName: 'asc' }, { customer: 'asc' }],
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

  const refMap = new Map();
  for (const id of archivedIds) {
    refMap.set(id, {
      projectScopes: 0,
      schedules: 0,
      activeSchedules: 0,
      scopeTrackings: 0,
      productivityLogs: 0,
      timecardEntries: 0,
      timecardTimeTypes: 0,
      commitmentContracts: 0,
      commitmentChangeOrders: 0,
      commitmentChangeOrderLineItems: 0,
      purchaseOrderContracts: 0,
      purchaseOrderLineItemContractDetails: 0,
    });
  }

  const add = (rows, field) => {
    for (const row of rows) {
      const id = row.projectId;
      if (!id || !refMap.has(id)) continue;
      refMap.get(id)[field] += 1;
    }
  };

  add(scopeRows, 'projectScopes');
  add(scheduleRows, 'schedules');
  add(activeScheduleRows, 'activeSchedules');
  add(scopeTrackingRows, 'scopeTrackings');
  add(productivityRows, 'productivityLogs');
  add(timecardRows, 'timecardEntries');
  add(timecardTypeRows, 'timecardTimeTypes');
  add(commitmentRows, 'commitmentContracts');
  add(changeOrderRows, 'commitmentChangeOrders');
  add(lineItemRows, 'commitmentChangeOrderLineItems');
  add(purchaseOrderRows, 'purchaseOrderContracts');
  add(purchaseOrderDetailRows, 'purchaseOrderLineItemContractDetails');

  const blocked = archivedProjects
    .map((project) => {
      const refs = refMap.get(project.id);
      const totalRefs = Object.values(refs).reduce((sum, value) => sum + value, 0);
      return { ...project, refs, totalRefs };
    })
    .filter((row) => row.totalRefs > 0)
    .sort((a, b) => b.totalRefs - a.totalRefs || a.projectName.localeCompare(b.projectName));

  const outDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'blocked-archived-projects-full-report.json');
  const csvPath = join(outDir, 'blocked-archived-projects-full-report.csv');

  writeFileSync(jsonPath, JSON.stringify({ blockedCount: blocked.length, blocked }, null, 2), 'utf8');

  const header = [
    'id','projectName','projectNumber','customer','status','updatedAt','totalRefs',
    'projectScopes','schedules','activeSchedules','scopeTrackings','productivityLogs','timecardEntries','timecardTimeTypes',
    'commitmentContracts','commitmentChangeOrders','commitmentChangeOrderLineItems','purchaseOrderContracts','purchaseOrderLineItemContractDetails'
  ];
  const lines = [header.join(',')];
  for (const row of blocked) {
    lines.push([
      row.id,
      row.projectName,
      row.projectNumber,
      row.customer,
      row.status,
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      row.totalRefs,
      row.refs.projectScopes,
      row.refs.schedules,
      row.refs.activeSchedules,
      row.refs.scopeTrackings,
      row.refs.productivityLogs,
      row.refs.timecardEntries,
      row.refs.timecardTimeTypes,
      row.refs.commitmentContracts,
      row.refs.commitmentChangeOrders,
      row.refs.commitmentChangeOrderLineItems,
      row.refs.purchaseOrderContracts,
      row.refs.purchaseOrderLineItemContractDetails,
    ].map(csvEscape).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'), 'utf8');

  console.log(JSON.stringify({
    blockedCount: blocked.length,
    jsonPath,
    csvPath,
    topBlocked: blocked.slice(0, 15),
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
