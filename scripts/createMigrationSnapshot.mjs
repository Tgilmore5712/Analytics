import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv) {
  const args = {
    label: "snapshot",
    outDir: "snapshots/migration",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--label" && argv[i + 1]) {
      args.label = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === "--out-dir" && argv[i + 1]) {
      args.outDir = argv[i + 1].trim();
      i += 1;
      continue;
    }
  }

  return args;
}

function slugify(value) {
  return (value || "snapshot")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "snapshot";
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatDateUTC(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function projectRowForSnapshot(project) {
  return {
    id: project.id,
    projectNumber: project.projectNumber || null,
    projectName: project.projectName || null,
    customer: project.customer || null,
    status: project.status || null,
    sales: project.sales ?? null,
    cost: project.cost ?? null,
    hours: project.hours ?? null,
    laborSales: project.laborSales ?? null,
    laborCost: project.laborCost ?? null,
    dateCreated: normalizeDate(project.dateCreated),
    dateUpdated: normalizeDate(project.dateUpdated),
    projectArchived: Boolean(project.projectArchived),
    estimator: project.estimator || null,
    projectManager: project.projectManager || null,
    customFields: project.customFields ?? null,
  };
}

function aggregateProjects(projects) {
  const active = projects.filter((p) => !p.projectArchived);
  const sum = (rows, field) => rows.reduce((acc, row) => acc + numberOrZero(row[field]), 0);

  const byStatus = {};
  for (const p of active) {
    const status = (p.status || "Unknown").toString();
    if (!byStatus[status]) {
      byStatus[status] = { count: 0, sales: 0, cost: 0, hours: 0 };
    }
    byStatus[status].count += 1;
    byStatus[status].sales += numberOrZero(p.sales);
    byStatus[status].cost += numberOrZero(p.cost);
    byStatus[status].hours += numberOrZero(p.hours);
  }

  const topCustomers = Object.entries(
    active.reduce((acc, p) => {
      const customer = (p.customer || "Unknown").toString();
      if (!acc[customer]) acc[customer] = { count: 0, sales: 0, cost: 0, hours: 0 };
      acc[customer].count += 1;
      acc[customer].sales += numberOrZero(p.sales);
      acc[customer].cost += numberOrZero(p.cost);
      acc[customer].hours += numberOrZero(p.hours);
      return acc;
    }, {})
  )
    .map(([customer, data]) => ({ customer, ...data }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 25);

  return {
    totals: {
      countAll: projects.length,
      countActive: active.length,
      salesActive: sum(active, "sales"),
      costActive: sum(active, "cost"),
      hoursActive: sum(active, "hours"),
      salesAll: sum(projects, "sales"),
      costAll: sum(projects, "cost"),
      hoursAll: sum(projects, "hours"),
    },
    byStatus,
    topCustomers,
  };
}

async function getFeedSummary(prisma) {
  try {
    const [feedTotalRows, feedLinkedRows, feedSoftDeletedRows, vendorTotalRows, vendorSoftDeletedRows] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM procore_project_feed`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM procore_project_feed WHERE linked_project_id IS NOT NULL`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM procore_project_feed WHERE soft_deleted = TRUE`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM procore_project_vendors`),
      prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM procore_project_vendors WHERE soft_deleted = TRUE`),
    ]);

    const readCount = (rows) => Number((rows?.[0]?.c ?? 0n));

    return {
      available: true,
      totalRows: readCount(feedTotalRows),
      linkedRows: readCount(feedLinkedRows),
      softDeletedRows: readCount(feedSoftDeletedRows),
      vendorRows: readCount(vendorTotalRows),
      vendorSoftDeletedRows: readCount(vendorSoftDeletedRows),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Failed to read Procore feed tables",
    };
  }
}

async function main() {
  const { label, outDir } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const stamp = formatDateUTC(now);
  const labelSlug = slugify(label);
  const baseName = `${stamp}-${labelSlug}`;

  const prisma = new PrismaClient();

  try {
    const [projects, dashboardSummary] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true,
          projectNumber: true,
          projectName: true,
          customer: true,
          status: true,
          sales: true,
          cost: true,
          hours: true,
          laborSales: true,
          laborCost: true,
          dateCreated: true,
          dateUpdated: true,
          projectArchived: true,
          estimator: true,
          projectManager: true,
          customFields: true,
        },
        orderBy: [{ projectName: "asc" }, { customer: "asc" }, { id: "asc" }],
      }),
      prisma.dashboardSummary.findUnique({ where: { id: "summary" } }),
    ]);

    const normalizedProjects = projects.map(projectRowForSnapshot);
    const projectHash = createHash("sha256").update(stableStringify(normalizedProjects)).digest("hex");
    const summaryHash = createHash("sha256")
      .update(stableStringify(dashboardSummary || null))
      .digest("hex");

    const feedSummary = await getFeedSummary(prisma);
    const aggregates = aggregateProjects(normalizedProjects);

    const payload = {
      metadata: {
        generatedAt: now.toISOString(),
        label,
        labelSlug,
        schemaVersion: 1,
      },
      checksums: {
        projectsSha256: projectHash,
        dashboardSummarySha256: summaryHash,
      },
      counts: {
        projectRows: normalizedProjects.length,
        hasDashboardSummary: Boolean(dashboardSummary),
      },
      aggregates,
      dashboardSummary: dashboardSummary
        ? {
            totalSales: dashboardSummary.totalSales,
            totalCost: dashboardSummary.totalCost,
            totalHours: dashboardSummary.totalHours,
            statusGroups: dashboardSummary.statusGroups,
            contractors: dashboardSummary.contractors,
            pmcGroupHours: dashboardSummary.pmcGroupHours,
            laborBreakdown: dashboardSummary.laborBreakdown,
            lastUpdated: normalizeDate(dashboardSummary.lastUpdated),
          }
        : null,
      procoreFeedSummary: feedSummary,
      projects: normalizedProjects,
    };

    await mkdir(outDir, { recursive: true });

    const jsonPath = `${outDir}/${baseName}.json`;
    const miniPath = `${outDir}/${baseName}.mini.json`;

    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
      writeFile(
        miniPath,
        `${JSON.stringify({
          metadata: payload.metadata,
          checksums: payload.checksums,
          counts: payload.counts,
          aggregates: payload.aggregates,
          dashboardSummary: payload.dashboardSummary
            ? {
                totalSales: payload.dashboardSummary.totalSales,
                totalCost: payload.dashboardSummary.totalCost,
                totalHours: payload.dashboardSummary.totalHours,
                lastUpdated: payload.dashboardSummary.lastUpdated,
              }
            : null,
          procoreFeedSummary: payload.procoreFeedSummary,
        }, null, 2)}\n`,
        "utf8"
      ),
    ]);

    console.log("Snapshot created");
    console.log(`Full: ${jsonPath}`);
    console.log(`Mini: ${miniPath}`);
    console.log(`Projects: ${normalizedProjects.length}`);
    console.log(`Project checksum: ${projectHash}`);
    console.log(`Summary checksum: ${summaryHash}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to create migration snapshot:", error);
  process.exit(1);
});
