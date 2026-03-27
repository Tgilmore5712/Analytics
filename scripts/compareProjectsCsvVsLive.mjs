import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv) {
  const args = {
    file: "C:/Users/ToddGilmore/Downloads/names and numbers.csv",
    companyId: process.env.PROCORE_COMPANY_ID || "598134325658789",
    includeArchived: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file" && argv[i + 1]) {
      args.file = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--company-id" && argv[i + 1]) {
      args.companyId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--include-archived") {
      args.includeArchived = true;
      continue;
    }
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeText(value) {
  return (value ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeProjectNumber(value) {
  const clean = (value ?? "").toString().trim().replace(/\s+/g, " ");
  return clean.length > 0 ? clean : null;
}

function mappingKey(customer, projectName) {
  return `${normalizeText(customer)}||${normalizeText(projectName)}`;
}

function projectNameKey(projectName) {
  return normalizeText(projectName);
}

function takeSample(arr, limit = 15) {
  return arr.slice(0, limit);
}

async function main() {
  const { file, companyId, includeArchived } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const csvText = readFileSync(file, "utf8");
    const rows = parseCsv(csvText);
    if (rows.length < 2) throw new Error("CSV appears empty or invalid");

    const header = rows[0].map((h) => h.trim());
    const customerIdx = header.findIndex((h) => h.toLowerCase() === "customer");
    const projectNameIdx = header.findIndex((h) => h.toLowerCase() === "projectname");
    const projectNumberIdx = header.findIndex((h) => h.toLowerCase() === "projectnumber");

    if (customerIdx === -1 || projectNameIdx === -1 || projectNumberIdx === -1) {
      throw new Error("CSV must include headers: customer, projectName, projectNumber");
    }

    const csvMap = new Map();
    let skippedBlankName = 0;
    let csvConflicts = 0;

    for (const row of rows.slice(1)) {
      const customer = (row[customerIdx] ?? "").toString().trim();
      const projectName = (row[projectNameIdx] ?? "").toString().trim();
      const projectNumber = normalizeProjectNumber(row[projectNumberIdx]);
      if (!projectName) {
        skippedBlankName += 1;
        continue;
      }

      const key = mappingKey(customer, projectName);
      const existing = csvMap.get(key);
      if (!existing) {
        csvMap.set(key, { customer, projectName, projectNumber });
        continue;
      }

      if (normalizeProjectNumber(existing.projectNumber) !== projectNumber) {
        csvConflicts += 1;
      }
    }

    const projectWhere = includeArchived ? {} : { projectArchived: { not: true } };
    const [projects, feedRows] = await Promise.all([
      prisma.project.findMany({
        where: projectWhere,
        select: { id: true, customer: true, projectName: true, projectNumber: true, projectArchived: true },
      }),
      prisma.$queryRawUnsafe(
        `
        SELECT customer, project_name, project_number, procore_id, sync_source
        FROM procore_project_feed
        WHERE company_id = $1
          AND soft_deleted = FALSE
        `,
        companyId
      ),
    ]);

    const projectMap = new Map();
    const projectsByName = new Map();
    for (const p of projects) {
      const strictKey = mappingKey(p.customer, p.projectName);
      const nameOnlyKey = projectNameKey(p.projectName);

      projectMap.set(strictKey, p);

      if (!projectsByName.has(nameOnlyKey)) {
        projectsByName.set(nameOnlyKey, []);
      }
      projectsByName.get(nameOnlyKey).push(p);
    }

    const feedMap = new Map();
    const feedByName = new Map();
    for (const r of feedRows) {
      const key = mappingKey(r.customer, r.project_name);
      const nameOnlyKey = projectNameKey(r.project_name);

      if (!feedMap.has(key)) feedMap.set(key, []);
      feedMap.get(key).push(r);

      if (!feedByName.has(nameOnlyKey)) feedByName.set(nameOnlyKey, []);
      feedByName.get(nameOnlyKey).push(r);
    }

    const csvMissingInProjects = [];
    const csvMissingInFeed = [];
    const projectNumberMismatches = [];
    const feedNumberMismatches = [];
    const csvMatchedProjectRelaxed = [];
    const csvMatchedFeedRelaxed = [];
    const csvAmbiguousProjectNameMatches = [];
    const csvAmbiguousFeedNameMatches = [];

    let strictProjectMatches = 0;
    let relaxedProjectMatches = 0;
    let strictFeedMatches = 0;
    let relaxedFeedMatches = 0;

    for (const [key, csv] of csvMap.entries()) {
      const project = projectMap.get(key);
      const strictFeedCandidates = feedMap.get(key) || [];
      const nameOnlyKey = projectNameKey(csv.projectName);
      const relaxedProjects = projectsByName.get(nameOnlyKey) || [];
      const relaxedFeedCandidates = feedByName.get(nameOnlyKey) || [];

      if (!project) {
        if (relaxedProjects.length === 1) {
          relaxedProjectMatches += 1;
          csvMatchedProjectRelaxed.push({
            customer: csv.customer,
            projectName: csv.projectName,
            csvNumber: normalizeProjectNumber(csv.projectNumber),
            dbCustomer: relaxedProjects[0].customer,
            dbNumber: normalizeProjectNumber(relaxedProjects[0].projectNumber),
            projectId: relaxedProjects[0].id,
          });
        } else {
          csvMissingInProjects.push(csv);
          if (relaxedProjects.length > 1) {
            csvAmbiguousProjectNameMatches.push({
              customer: csv.customer,
              projectName: csv.projectName,
              matches: relaxedProjects.map((p) => ({
                id: p.id,
                customer: p.customer,
                projectNumber: normalizeProjectNumber(p.projectNumber),
              })),
            });
          }
        }
      } else {
        strictProjectMatches += 1;
        const dbNum = normalizeProjectNumber(project.projectNumber);
        const csvNum = normalizeProjectNumber(csv.projectNumber);
        if (dbNum !== csvNum) {
          projectNumberMismatches.push({
            customer: csv.customer,
            projectName: csv.projectName,
            csvNumber: csvNum,
            dbNumber: dbNum,
            projectId: project.id,
          });
        }
      }

      if (!strictFeedCandidates.length) {
        if (relaxedFeedCandidates.length === 1) {
          relaxedFeedMatches += 1;
          csvMatchedFeedRelaxed.push({
            customer: csv.customer,
            projectName: csv.projectName,
            csvNumber: normalizeProjectNumber(csv.projectNumber),
            feedCustomer: relaxedFeedCandidates[0].customer,
            feedNumber: normalizeProjectNumber(relaxedFeedCandidates[0].project_number),
            procoreId: relaxedFeedCandidates[0].procore_id,
          });
        } else {
          csvMissingInFeed.push(csv);
          if (relaxedFeedCandidates.length > 1) {
            csvAmbiguousFeedNameMatches.push({
              customer: csv.customer,
              projectName: csv.projectName,
              matches: relaxedFeedCandidates.map((f) => ({
                customer: f.customer,
                procoreId: f.procore_id,
                projectNumber: normalizeProjectNumber(f.project_number),
              })),
            });
          }
        }
      } else {
        strictFeedMatches += 1;
        const csvNum = normalizeProjectNumber(csv.projectNumber);
        const anyMatch = strictFeedCandidates.some((f) => normalizeProjectNumber(f.project_number) === csvNum);
        if (!anyMatch) {
          feedNumberMismatches.push({
            customer: csv.customer,
            projectName: csv.projectName,
            csvNumber: csvNum,
            feedNumbers: strictFeedCandidates.map((f) => normalizeProjectNumber(f.project_number)),
            procoreIds: strictFeedCandidates.map((f) => f.procore_id),
          });
        }
      }
    }

    const projectsMissingInCsv = [];
    for (const p of projects) {
      const key = mappingKey(p.customer, p.projectName);
      if (!csvMap.has(key)) {
        projectsMissingInCsv.push({ customer: p.customer, projectName: p.projectName, projectNumber: p.projectNumber, id: p.id });
      }
    }

    console.log("=== CSV vs DB vs Procore Feed Diff Report ===");
    console.log(`CSV file: ${file}`);
    console.log(`Company ID: ${companyId}`);
    console.log(`CSV mappings loaded: ${csvMap.size}`);
    console.log(`CSV rows skipped (blank projectName): ${skippedBlankName}`);
    console.log(`CSV key conflicts detected: ${csvConflicts}`);
    console.log(`Project rows scanned: ${projects.length}`);
    console.log(`Procore feed rows scanned: ${feedRows.length}`);
    console.log("");
    console.log("Match coverage:");
    console.log(`- Project strict matches (customer + name): ${strictProjectMatches}`);
    console.log(`- Project relaxed matches (name only): ${relaxedProjectMatches}`);
    console.log(`- Feed strict matches (customer + name): ${strictFeedMatches}`);
    console.log(`- Feed relaxed matches (name only): ${relaxedFeedMatches}`);
    console.log(`- Project ambiguous relaxed matches: ${csvAmbiguousProjectNameMatches.length}`);
    console.log(`- Feed ambiguous relaxed matches: ${csvAmbiguousFeedNameMatches.length}`);
    console.log("");
    console.log(`CSV missing in Project table: ${csvMissingInProjects.length}`);
    console.log(`CSV missing in Procore feed: ${csvMissingInFeed.length}`);
    console.log(`CSV vs ProjectNumber mismatches: ${projectNumberMismatches.length}`);
    console.log(`CSV vs Feed project_number mismatches: ${feedNumberMismatches.length}`);
    console.log(`Projects missing in CSV: ${projectsMissingInCsv.length}`);

    if (projectNumberMismatches.length) {
      console.log("\nSample CSV vs ProjectNumber mismatches:");
      for (const row of takeSample(projectNumberMismatches)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: CSV=${row.csvNumber || "(blank)"} DB=${row.dbNumber || "(blank)"} [${row.projectId}]`);
      }
    }

    if (feedNumberMismatches.length) {
      console.log("\nSample CSV vs Feed project_number mismatches:");
      for (const row of takeSample(feedNumberMismatches)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: CSV=${row.csvNumber || "(blank)"} FEED=${JSON.stringify(row.feedNumbers)}`);
      }
    }

    if (csvMissingInProjects.length) {
      console.log("\nSample CSV mappings not found in Project table:");
      for (const row of takeSample(csvMissingInProjects)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: CSV=${row.projectNumber || "(blank)"}`);
      }
    }

    if (csvMatchedProjectRelaxed.length) {
      console.log("\nSample relaxed Project matches (name only):");
      for (const row of takeSample(csvMatchedProjectRelaxed)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: CSV=${row.csvNumber || "(blank)"} DB=${row.dbNumber || "(blank)"} DB.customer=${row.dbCustomer || ""}`);
      }
    }

    if (csvMatchedFeedRelaxed.length) {
      console.log("\nSample relaxed Feed matches (name only):");
      for (const row of takeSample(csvMatchedFeedRelaxed)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: CSV=${row.csvNumber || "(blank)"} FEED=${row.feedNumber || "(blank)"} FEED.customer=${row.feedCustomer || ""}`);
      }
    }

    if (csvAmbiguousProjectNameMatches.length) {
      console.log("\nSample ambiguous Project relaxed matches:");
      for (const row of takeSample(csvAmbiguousProjectNameMatches, 8)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: matches=${row.matches.length}`);
      }
    }

    if (csvAmbiguousFeedNameMatches.length) {
      console.log("\nSample ambiguous Feed relaxed matches:");
      for (const row of takeSample(csvAmbiguousFeedNameMatches, 8)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: matches=${row.matches.length}`);
      }
    }

    if (projectsMissingInCsv.length) {
      console.log("\nSample Project rows not found in CSV:");
      for (const row of takeSample(projectsMissingInCsv)) {
        console.log(`- ${row.customer || ""} | ${row.projectName}: DB=${row.projectNumber || "(blank)"} [${row.id}]`);
      }
    }

    console.log("\nDry-run only: no database changes were made.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
