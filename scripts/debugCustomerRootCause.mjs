import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toJsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
}

async function main() {
  const projectName = 'Sadsbury Commons';

  const feedRows = await prisma.$queryRawUnsafe(
    `
      SELECT
        id,
        company_id,
        project_name,
        customer,
        customer_source,
        procore_id,
        external_id,
        linked_project_id,
        match_confidence,
        synced_at
      FROM procore_project_feed
      WHERE lower(project_name) = lower($1)
        AND soft_deleted = FALSE
      ORDER BY synced_at DESC, id DESC
    `,
    projectName
  );

  const procoreIds = new Set();
  const linkedProjectIds = new Set();
  for (const row of feedRows) {
    const procoreId = (row.procore_id || row.external_id || '').toString().trim();
    if (procoreId) procoreIds.add(procoreId);
    const linked = (row.linked_project_id || '').toString().trim();
    if (linked) linkedProjectIds.add(linked);
  }

  const vendorRowsByProject = [];
  for (const projectId of procoreIds) {
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT
          project_id,
          name,
          is_active,
          soft_deleted,
          synced_at,
          updated_at
        FROM procore_project_vendors
        WHERE project_id = $1
        ORDER BY soft_deleted ASC, is_active DESC NULLS LAST, name ASC NULLS LAST
      `,
      projectId
    );

    vendorRowsByProject.push({ projectId, rows });
  }

  const milexAnywhere = await prisma.$queryRawUnsafe(
    `
      SELECT
        project_id,
        name,
        is_active,
        soft_deleted,
        synced_at
      FROM procore_project_vendors
      WHERE lower(coalesce(name, '')) LIKE '%milex%'
      ORDER BY synced_at DESC
      LIMIT 100
    `
  );

  let projectRows = [];
  if (linkedProjectIds.size > 0) {
    projectRows = await prisma.project.findMany({
      where: { id: { in: [...linkedProjectIds] } },
      select: {
        id: true,
        projectName: true,
        projectNumber: true,
        customer: true,
        status: true,
      },
      orderBy: [{ id: 'asc' }],
    });
  }

  console.log(
    JSON.stringify(
      toJsonSafe({
        projectName,
        feedRows,
        procoreIds: [...procoreIds],
        linkedProjectIds: [...linkedProjectIds],
        projectRows,
        vendorRowsByProject,
        milexAnywhere,
      }),
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
