import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const prisma = new PrismaClient();

async function main() {
  const snapshotArg = process.argv[2];
  if (!snapshotArg) {
    console.error('Usage: node scripts/rollbackProjectDedupe.mjs <snapshot-json-path>');
    process.exit(1);
  }

  const snapshotPath = resolve(snapshotArg);
  const raw = readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(raw);

  if (!Array.isArray(snapshot.changedRows)) {
    throw new Error('Invalid snapshot file: missing changedRows array');
  }

  let restored = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of snapshot.changedRows) {
      if (!row?.id) continue;
      await tx.project.update({
        where: { id: String(row.id) },
        data: {
          projectArchived: Boolean(row.projectArchived),
          customFields: row.customFields ?? null,
        },
      });
      restored++;
    }
  });

  console.log(JSON.stringify({
    success: true,
    snapshotPath,
    restored,
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
