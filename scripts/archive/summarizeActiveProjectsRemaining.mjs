import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

async function main() {
  const rows = await prisma.project.findMany({
    where: { projectArchived: { not: true } },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      status: true,
      sales: true,
      customerSource: true,
      procoreId: true,
      bidBoardId: true,
    },
  });

  const byStatus = new Map();
  const byCustomerSource = new Map();
  let withProcoreId = 0;
  let withBidBoardId = 0;
  let salesPositive = 0;
  let salesZero = 0;
  let salesNull = 0;

  const groups = new Map();
  for (const row of rows) {
    byStatus.set(row.status ?? '(null)', (byStatus.get(row.status ?? '(null)') || 0) + 1);
    byCustomerSource.set(row.customerSource ?? '(null)', (byCustomerSource.get(row.customerSource ?? '(null)') || 0) + 1);
    if (row.procoreId) withProcoreId++;
    if (row.bidBoardId) withBidBoardId++;
    if (row.sales == null) salesNull++;
    else if (Number(row.sales) === 0) salesZero++;
    else if (Number(row.sales) > 0) salesPositive++;

    const key = `${norm(row.projectName)}|${norm(row.customer)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [...groups.entries()]
    .map(([key, items]) => ({ key, count: items.length, items }))
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const topStatus = [...byStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const topCustomerSource = [...byCustomerSource.entries()]
    .map(([customerSource, count]) => ({ customerSource, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  console.log(JSON.stringify({
    activeCount: rows.length,
    withProcoreId,
    withBidBoardId,
    salesPositive,
    salesZero,
    salesNull,
    duplicateGroupCount: duplicateGroups.length,
    duplicateRows: duplicateGroups.reduce((sum, g) => sum + g.count, 0),
    topStatus,
    topCustomerSource,
    duplicateSamples: duplicateGroups.slice(0, 25).map((g) => ({
      key: g.key,
      count: g.count,
      items: g.items.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        projectNumber: r.projectNumber,
        customer: r.customer,
        status: r.status,
        sales: r.sales,
        customerSource: r.customerSource,
        procoreId: r.procoreId,
        bidBoardId: r.bidBoardId,
      })),
    })),
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
