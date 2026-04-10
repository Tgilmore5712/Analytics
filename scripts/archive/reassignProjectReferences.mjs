import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function countRefs(projectId) {
  const [
    projectScopes,
    schedules,
    activeSchedules,
    scopeTrackings,
    productivityLogs,
    timecardEntries,
    timecardTimeTypes,
    commitmentContracts,
    commitmentChangeOrders,
    commitmentChangeOrderLineItems,
    purchaseOrderContracts,
    purchaseOrderLineItemContractDetails,
  ] = await Promise.all([
    prisma.projectScope.count({ where: { projectId } }),
    prisma.schedule.count({ where: { projectId } }),
    prisma.activeSchedule.count({ where: { projectId } }),
    prisma.scopeTracking.count({ where: { projectId } }),
    prisma.productivityLog.count({ where: { projectId } }),
    prisma.timecardEntry.count({ where: { projectId } }),
    prisma.timecardTimeType.count({ where: { projectId } }),
    prisma.commitmentContract.count({ where: { projectId } }),
    prisma.commitmentChangeOrder.count({ where: { projectId } }),
    prisma.commitmentChangeOrderLineItem.count({ where: { projectId } }),
    prisma.purchaseOrderContract.count({ where: { projectId } }),
    prisma.purchaseOrderLineItemContractDetail.count({ where: { projectId } }),
  ]);

  return {
    projectScopes,
    schedules,
    activeSchedules,
    scopeTrackings,
    productivityLogs,
    timecardEntries,
    timecardTimeTypes,
    commitmentContracts,
    commitmentChangeOrders,
    commitmentChangeOrderLineItems,
    purchaseOrderContracts,
    purchaseOrderLineItemContractDetails,
  };
}

async function main() {
  const [, , oldId, newId, mode] = process.argv;
  const apply = mode === '--apply';

  if (!oldId || !newId) {
    console.error('Usage: node scripts/reassignProjectReferences.mjs <oldProjectId> <newProjectId> [--apply]');
    process.exit(1);
  }

  const [oldProject, newProject] = await Promise.all([
    prisma.project.findUnique({ where: { id: oldId } }),
    prisma.project.findUnique({ where: { id: newId } }),
  ]);

  if (!oldProject) throw new Error(`Old project not found: ${oldId}`);
  if (!newProject) throw new Error(`New project not found: ${newId}`);

  const beforeOld = await countRefs(oldId);
  const beforeNew = await countRefs(newId);

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    oldProject: {
      id: oldProject.id,
      projectName: oldProject.projectName,
      projectNumber: oldProject.projectNumber,
      customer: oldProject.customer,
      customerSource: oldProject.customerSource,
      projectArchived: oldProject.projectArchived,
    },
    newProject: {
      id: newProject.id,
      projectName: newProject.projectName,
      projectNumber: newProject.projectNumber,
      customer: newProject.customer,
      customerSource: newProject.customerSource,
      projectArchived: newProject.projectArchived,
    },
    beforeOld,
    beforeNew,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-reference-reassign-${stamp}.json`);

  await prisma.$transaction(async (tx) => {
    await tx.projectScope.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.schedule.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.activeSchedule.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.scopeTracking.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.productivityLog.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.timecardEntry.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.timecardTimeType.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.commitmentContract.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.commitmentChangeOrder.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.commitmentChangeOrderLineItem.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.purchaseOrderContract.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
    await tx.purchaseOrderLineItemContractDetail.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  });

  const afterOld = await countRefs(oldId);
  const afterNew = await countRefs(newId);

  writeFileSync(snapshotPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    oldId,
    newId,
    beforeOld,
    beforeNew,
    afterOld,
    afterNew,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    snapshotPath,
    afterOld,
    afterNew,
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
