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
    schedules,
    productivityLogs,
    timecardEntries,
    timecardTimeTypes,
    commitmentContracts,
    purchaseOrderContracts,
    purchaseOrderLineItemContractDetails,
  ] = await Promise.all([
    prisma.schedule.count({ where: { projectId } }),
    prisma.productivityLog.count({ where: { projectId } }),
    prisma.timecardEntry.count({ where: { projectId } }),
    prisma.timecardTimeType.count({ where: { projectId } }),
    prisma.commitmentContract.count({ where: { projectId } }),
    prisma.purchaseOrderContract.count({ where: { projectId } }),
    prisma.purchaseOrderLineItemContractDetail.count({ where: { projectId } }),
  ]);

  return {
    schedules,
    productivityLogs,
    timecardEntries,
    timecardTimeTypes,
    commitmentContracts,
    purchaseOrderContracts,
    purchaseOrderLineItemContractDetails,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');

  const keepJonasId = 'cmmf747l70001e3w44cuzps5j';
  const deleteJonasId = 'cmmaqpkxk0003e3fsuso9b024';
  const deletePmcOpsId = 'cmmm511oh0018e3k0sddst5a6';

  const [keepJonas, deleteJonas, deletePmc] = await Promise.all([
    prisma.project.findUnique({ where: { id: keepJonasId } }),
    prisma.project.findUnique({ where: { id: deleteJonasId } }),
    prisma.project.findUnique({ where: { id: deletePmcOpsId } }),
  ]);

  if (!keepJonas || !deleteJonas || !deletePmc) {
    throw new Error('One or more target IDs were not found.');
  }

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    keepJonas: {
      id: keepJonas.id,
      projectName: keepJonas.projectName,
      projectArchived: keepJonas.projectArchived,
      refs: await countRefs(keepJonas.id),
    },
    deleteJonas: {
      id: deleteJonas.id,
      projectName: deleteJonas.projectName,
      projectArchived: deleteJonas.projectArchived,
      refs: await countRefs(deleteJonas.id),
    },
    deletePmcOperations: {
      id: deletePmc.id,
      projectName: deletePmc.projectName,
      projectArchived: deletePmc.projectArchived,
      refs: await countRefs(deletePmc.id),
    },
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_manual_delete_backup_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  await prisma.$transaction(async (tx) => {
    // Repoint Jonas schedule and any other refs from losing row to keeper.
    await tx.projectScope.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.schedule.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.activeSchedule.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.scopeTracking.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.productivityLog.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.timecardEntry.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.timecardTimeType.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.commitmentContract.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.commitmentChangeOrder.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.commitmentChangeOrderLineItem.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.purchaseOrderContract.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });
    await tx.purchaseOrderLineItemContractDetail.updateMany({ where: { projectId: deleteJonasId }, data: { projectId: keepJonasId } });

    await tx.project.delete({ where: { id: deleteJonasId } });

    // User requested deleting PMC Operations row.
    await tx.project.delete({ where: { id: deletePmcOpsId } });
  }, {
    maxWait: 30000,
    timeout: 120000,
  });

  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-manual-delete-${stamp}.json`);

  const after = {
    keepJonas: await countRefs(keepJonasId),
    deleteJonasExists: await prisma.project.findUnique({ where: { id: deleteJonasId } }),
    deletePmcExists: await prisma.project.findUnique({ where: { id: deletePmcOpsId } }),
  };

  writeFileSync(snapshotPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    backupTable,
    deletedIds: [deleteJonasId, deletePmcOpsId],
    keptId: keepJonasId,
    after,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    backupTable,
    snapshotPath,
    after,
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
