import { readFile, writeFile, mkdir } from "node:fs/promises";

function parseArgs(argv) {
  const args = {
    before: "",
    after: "",
    outDir: "snapshots/migration",
    writeReport: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--before" && argv[i + 1]) {
      args.before = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === "--after" && argv[i + 1]) {
      args.after = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === "--out-dir" && argv[i + 1]) {
      args.outDir = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (token === "--no-write") {
      args.writeReport = false;
      continue;
    }
  }

  return args;
}

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return asString(value).trim();
}

function mapById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = asString(row?.id).trim();
    if (!id) continue;
    map.set(id, row);
  }
  return map;
}

function nowStampUtc() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function safeField(row, field) {
  if (!row || typeof row !== "object") return "";
  return normalizeText(row[field]);
}

function compareProjectFields(beforeRows, afterRows) {
  const fields = [
    "customer",
    "status",
    "projectName",
    "projectNumber",
    "dateCreated",
    "dateUpdated",
  ];

  const beforeById = mapById(beforeRows);
  const afterById = mapById(afterRows);

  const beforeIds = new Set(beforeById.keys());
  const afterIds = new Set(afterById.keys());

  const addedIds = [];
  const removedIds = [];
  const commonIds = [];

  for (const id of afterIds) {
    if (!beforeIds.has(id)) addedIds.push(id);
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) removedIds.push(id);
    else commonIds.push(id);
  }

  const fieldChanges = {};
  for (const f of fields) {
    fieldChanges[f] = { count: 0, samples: [] };
  }

  const statusTransitions = {};

  for (const id of commonIds) {
    const before = beforeById.get(id);
    const after = afterById.get(id);

    for (const field of fields) {
      const a = safeField(before, field);
      const b = safeField(after, field);
      if (a === b) continue;

      fieldChanges[field].count += 1;
      if (fieldChanges[field].samples.length < 20) {
        fieldChanges[field].samples.push({
          id,
          before: a,
          after: b,
          projectNameBefore: safeField(before, "projectName"),
          projectNameAfter: safeField(after, "projectName"),
          customerBefore: safeField(before, "customer"),
          customerAfter: safeField(after, "customer"),
        });
      }

      if (field === "status") {
        const key = `${a || "(blank)"} -> ${b || "(blank)"}`;
        statusTransitions[key] = (statusTransitions[key] || 0) + 1;
      }
    }
  }

  return {
    rowCounts: {
      before: beforeRows.length,
      after: afterRows.length,
      added: addedIds.length,
      removed: removedIds.length,
      common: commonIds.length,
    },
    fieldChanges,
    statusTransitions: Object.fromEntries(
      Object.entries(statusTransitions).sort((a, b) => b[1] - a[1])
    ),
    addedSamples: addedIds.slice(0, 20).map((id) => {
      const row = afterById.get(id);
      return {
        id,
        projectName: safeField(row, "projectName"),
        customer: safeField(row, "customer"),
        status: safeField(row, "status"),
      };
    }),
    removedSamples: removedIds.slice(0, 20).map((id) => {
      const row = beforeById.get(id);
      return {
        id,
        projectName: safeField(row, "projectName"),
        customer: safeField(row, "customer"),
        status: safeField(row, "status"),
      };
    }),
  };
}

function compareTotals(before, after) {
  const keys = [
    "countAll",
    "countActive",
    "salesActive",
    "costActive",
    "hoursActive",
    "salesAll",
    "costAll",
    "hoursAll",
  ];

  const result = {};
  for (const key of keys) {
    const b = asNumber(before?.aggregates?.totals?.[key]);
    const a = asNumber(after?.aggregates?.totals?.[key]);
    result[key] = {
      before: b,
      after: a,
      delta: a - b,
    };
  }

  return result;
}

function compareDashboardSummary(before, after) {
  const b = before?.dashboardSummary || null;
  const a = after?.dashboardSummary || null;

  if (!b && !a) {
    return {
      available: false,
      message: "Dashboard summary missing in both snapshots",
    };
  }

  if (!b || !a) {
    return {
      available: true,
      changedShape: true,
      beforeExists: Boolean(b),
      afterExists: Boolean(a),
    };
  }

  return {
    available: true,
    changedShape: false,
    totals: {
      totalSales: {
        before: asNumber(b.totalSales),
        after: asNumber(a.totalSales),
        delta: asNumber(a.totalSales) - asNumber(b.totalSales),
      },
      totalCost: {
        before: asNumber(b.totalCost),
        after: asNumber(a.totalCost),
        delta: asNumber(a.totalCost) - asNumber(b.totalCost),
      },
      totalHours: {
        before: asNumber(b.totalHours),
        after: asNumber(a.totalHours),
        delta: asNumber(a.totalHours) - asNumber(b.totalHours),
      },
    },
    lastUpdated: {
      before: asString(b.lastUpdated),
      after: asString(a.lastUpdated),
    },
  };
}

function compareChecksums(before, after) {
  return {
    projects: {
      before: asString(before?.checksums?.projectsSha256),
      after: asString(after?.checksums?.projectsSha256),
      changed: asString(before?.checksums?.projectsSha256) !== asString(after?.checksums?.projectsSha256),
    },
    dashboardSummary: {
      before: asString(before?.checksums?.dashboardSummarySha256),
      after: asString(after?.checksums?.dashboardSummarySha256),
      changed:
        asString(before?.checksums?.dashboardSummarySha256) !==
        asString(after?.checksums?.dashboardSummarySha256),
    },
  };
}

async function loadJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function printSummary(report) {
  console.log("Dashboard Snapshot Comparison");
  console.log(`Before: ${report.inputs.before}`);
  console.log(`After:  ${report.inputs.after}`);
  console.log(`Rows:   ${report.projects.rowCounts.before} -> ${report.projects.rowCounts.after}`);
  console.log(
    `Changes(customer/status/name/number/dateCreated/dateUpdated): ${
      report.summary.totalFieldChanges
    }`
  );
  console.log(
    `Checksum changed (projects, summary): ${
      report.checksums.projects.changed
    }, ${report.checksums.dashboardSummary.changed}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before || !args.after) {
    throw new Error("Usage: node scripts/compareDashboardSnapshots.mjs --before <file> --after <file>");
  }

  const [before, after] = await Promise.all([loadJson(args.before), loadJson(args.after)]);

  const projects = compareProjectFields(before.projects || [], after.projects || []);
  const checksums = compareChecksums(before, after);
  const totals = compareTotals(before, after);
  const dashboardSummary = compareDashboardSummary(before, after);

  const totalFieldChanges = Object.values(projects.fieldChanges).reduce(
    (sum, entry) => sum + asNumber(entry.count),
    0
  );

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "dashboard-only",
    inputs: {
      before: args.before,
      after: args.after,
      beforeLabel: before?.metadata?.label || "",
      afterLabel: after?.metadata?.label || "",
    },
    checksums,
    summary: {
      totalFieldChanges,
      changedFields: Object.fromEntries(
        Object.entries(projects.fieldChanges)
          .map(([k, v]) => [k, asNumber(v.count)])
          .filter(([, count]) => count > 0)
      ),
    },
    totals,
    dashboardSummary,
    projects,
  };

  printSummary(report);

  if (args.writeReport) {
    await mkdir(args.outDir, { recursive: true });
    const file = `${args.outDir}/${nowStampUtc()}-dashboard-compare.json`;
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report: ${file}`);
  }
}

main().catch((error) => {
  console.error("Failed to compare dashboard snapshots:", error.message || error);
  process.exit(1);
});
