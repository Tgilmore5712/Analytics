import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';

const prisma = new PrismaClient();

function nowStampUtc() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function parseArgs(argv) {
  const args = {
    outDir: 'snapshots/migration',
    limit: 500,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === '--limit' && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) args.limit = n;
      i += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const { outDir, limit } = parseArgs(process.argv.slice(2));

  const feedLinked = await prisma.$queryRawUnsafe(
    `
      SELECT
        linked_project_id,
        COUNT(*)::int AS linked_feed_rows,
        COUNT(DISTINCT COALESCE(procore_id, external_id))::int AS distinct_procore_ids,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(procore_id, external_id)), NULL) AS procore_ids,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT project_name), NULL) AS project_names
      FROM procore_project_feed
      WHERE linked_project_id IS NOT NULL
        AND soft_deleted = FALSE
      GROUP BY linked_project_id
      ORDER BY linked_feed_rows DESC
      LIMIT $1
    `,
    limit
  );

  const duplicateByProcore = await prisma.$queryRawUnsafe(
    `
      WITH canonical_ids AS (
        SELECT
          COALESCE(procore_id, external_id) AS canonical_procore_id,
          linked_project_id
        FROM procore_project_feed
        WHERE linked_project_id IS NOT NULL
          AND soft_deleted = FALSE
          AND COALESCE(procore_id, external_id) IS NOT NULL
      )
      SELECT
        canonical_procore_id,
        COUNT(DISTINCT linked_project_id)::int AS distinct_project_rows,
        ARRAY_AGG(DISTINCT linked_project_id) AS project_ids
      FROM canonical_ids
      GROUP BY canonical_procore_id
      HAVING COUNT(DISTINCT linked_project_id) > 1
      ORDER BY distinct_project_rows DESC, canonical_procore_id ASC
      LIMIT $1
    `,
    limit
  );

  const projectRowsForConflicts = [];
  const seenProjectIds = new Set();
  for (const row of duplicateByProcore) {
    for (const id of row.project_ids || []) {
      if (!id || seenProjectIds.has(id)) continue;
      seenProjectIds.add(id);
      projectRowsForConflicts.push(id);
    }
  }

  let conflictProjectDetails = [];
  if (projectRowsForConflicts.length > 0) {
    conflictProjectDetails = await prisma.project.findMany({
      where: { id: { in: projectRowsForConflicts } },
      select: {
        id: true,
        customer: true,
        projectName: true,
        projectNumber: true,
        status: true,
        dateUpdated: true,
      },
      orderBy: [{ projectName: 'asc' }, { customer: 'asc' }, { id: 'asc' }],
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'dashboard-only-canonical-audit',
    summary: {
      linkedProjectRowsScanned: feedLinked.length,
      canonicalProcoreIdConflicts: duplicateByProcore.length,
      conflictingProjectRows: conflictProjectDetails.length,
    },
    linkedProjectFeedStats: feedLinked,
    canonicalConflictsByProcoreId: duplicateByProcore,
    conflictingProjectRows: conflictProjectDetails,
  };

  await mkdir(outDir, { recursive: true });
  const outputPath = `${outDir}/${nowStampUtc()}-dashboard-canonical-audit.json`;
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Dashboard canonical audit complete');
  console.log(`Report: ${outputPath}`);
  console.log(`Conflicting canonical Procore ids: ${report.summary.canonicalProcoreIdConflicts}`);
  console.log(`Conflicting project rows: ${report.summary.conflictingProjectRows}`);
}

main()
  .catch((error) => {
    console.error('Failed dashboard canonical audit:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
