import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function family(code) {
  return String(code || "").trim().slice(0, 9);
}

function normalize(code) {
  return String(code || "").trim();
}

async function main() {
  const timecardRows = await prisma.$queryRaw`
    SELECT
      t."procoreProjectId" AS procore_project_id,
      MIN(t."projectId") AS project_id,
      t."costCodeFullCode" AS timecard_cost_code,
      COALESCE(SUM(t.hours), 0) AS total_hours
    FROM "TimecardEntry" t
    WHERE t."procoreProjectId" IS NOT NULL
      AND t."costCodeFullCode" IS NOT NULL
      AND t."costCodeFullCode" <> ''
    GROUP BY t."procoreProjectId", t."costCodeFullCode"
  `;

  const poRows = await prisma.$queryRaw`
    SELECT
      po."procoreProjectId" AS procore_project_id,
      li."costCode" AS po_cost_code,
      COUNT(*)::INT AS po_line_count
    FROM "PurchaseOrderContract" po
    JOIN "PurchaseOrderLineItemContractDetail" li
      ON li."purchaseOrderContractId" = po.id
    WHERE po."procoreProjectId" IS NOT NULL
      AND li."costCode" IS NOT NULL
      AND li."costCode" <> ''
    GROUP BY po."procoreProjectId", li."costCode"
  `;

  const poByProject = new Map();
  const poFamiliesByProject = new Map();

  for (const row of poRows) {
    const projectId = normalize(row.procore_project_id);
    const poCostCode = normalize(row.po_cost_code);
    if (!projectId || !poCostCode) continue;

    if (!poByProject.has(projectId)) poByProject.set(projectId, new Set());
    poByProject.get(projectId).add(poCostCode);

    const poFamily = family(poCostCode);
    if (!poFamiliesByProject.has(projectId)) poFamiliesByProject.set(projectId, new Map());
    if (!poFamiliesByProject.get(projectId).has(poFamily)) {
      poFamiliesByProject.get(projectId).set(poFamily, new Set());
    }
    poFamiliesByProject.get(projectId).get(poFamily).add(poCostCode);
  }

  let exactPrimary = 0;
  let familySinglePrimary = 0;
  let familyCandidates = 0;
  let skippedNoMatch = 0;

  for (const row of timecardRows) {
    const procoreProjectId = normalize(row.procore_project_id);
    const projectId = normalize(row.project_id) || null;
    const timecardCostCode = normalize(row.timecard_cost_code);
    if (!procoreProjectId || !timecardCostCode) continue;

    const projectCodes = poByProject.get(procoreProjectId) || new Set();

    if (projectCodes.has(timecardCostCode)) {
      await prisma.$executeRaw`
        INSERT INTO "timecard_cost_code_mappings"
          (id, "procore_project_id", "project_id", "timecard_cost_code", "po_cost_code", "match_type", confidence, "is_primary", "is_active", notes)
        VALUES
          (${randomUUID()}, ${procoreProjectId}, ${projectId}, ${timecardCostCode}, ${timecardCostCode}, 'exact_auto', 1.0, TRUE, TRUE, 'Auto-mapped exact code match')
        ON CONFLICT ("procore_project_id", "timecard_cost_code", "po_cost_code")
        DO UPDATE SET
          "match_type" = EXCLUDED."match_type",
          confidence = EXCLUDED.confidence,
          "is_primary" = EXCLUDED."is_primary",
          "is_active" = EXCLUDED."is_active",
          notes = EXCLUDED.notes,
          "project_id" = COALESCE(EXCLUDED."project_id", "timecard_cost_code_mappings"."project_id"),
          "updated_at" = NOW()
      `;
      exactPrimary += 1;
      continue;
    }

    const familyCode = family(timecardCostCode);
    const familyCandidatesSet = poFamiliesByProject.get(procoreProjectId)?.get(familyCode) || new Set();
    const familyCodes = Array.from(familyCandidatesSet.values());

    if (!familyCodes.length) {
      skippedNoMatch += 1;
      continue;
    }

    if (familyCodes.length === 1) {
      await prisma.$executeRaw`
        INSERT INTO "timecard_cost_code_mappings"
          (id, "procore_project_id", "project_id", "timecard_cost_code", "po_cost_code", "match_type", confidence, "is_primary", "is_active", notes)
        VALUES
          (${randomUUID()}, ${procoreProjectId}, ${projectId}, ${timecardCostCode}, ${familyCodes[0]}, 'family_auto_single', 0.9, TRUE, TRUE, 'Auto-mapped by unique family candidate')
        ON CONFLICT ("procore_project_id", "timecard_cost_code", "po_cost_code")
        DO UPDATE SET
          "match_type" = EXCLUDED."match_type",
          confidence = EXCLUDED.confidence,
          "is_primary" = EXCLUDED."is_primary",
          "is_active" = EXCLUDED."is_active",
          notes = EXCLUDED.notes,
          "project_id" = COALESCE(EXCLUDED."project_id", "timecard_cost_code_mappings"."project_id"),
          "updated_at" = NOW()
      `;
      familySinglePrimary += 1;
      continue;
    }

    for (const candidate of familyCodes) {
      await prisma.$executeRaw`
        INSERT INTO "timecard_cost_code_mappings"
          (id, "procore_project_id", "project_id", "timecard_cost_code", "po_cost_code", "match_type", confidence, "is_primary", "is_active", notes)
        VALUES
          (${randomUUID()}, ${procoreProjectId}, ${projectId}, ${timecardCostCode}, ${candidate}, 'family_candidate', 0.5, FALSE, TRUE, 'Candidate from family match; review and set primary')
        ON CONFLICT ("procore_project_id", "timecard_cost_code", "po_cost_code")
        DO UPDATE SET
          "match_type" = EXCLUDED."match_type",
          confidence = EXCLUDED.confidence,
          "is_active" = EXCLUDED."is_active",
          notes = EXCLUDED.notes,
          "project_id" = COALESCE(EXCLUDED."project_id", "timecard_cost_code_mappings"."project_id"),
          "updated_at" = NOW()
      `;
      familyCandidates += 1;
    }
  }

  const stats = await prisma.$queryRaw`
    SELECT
      "match_type",
      COUNT(*)::INT AS row_count,
      COUNT(*) FILTER (WHERE "is_primary" = TRUE)::INT AS primary_count
    FROM "timecard_cost_code_mappings"
    GROUP BY "match_type"
    ORDER BY "match_type"
  `;

  console.log(
    JSON.stringify(
      {
        exactPrimary,
        familySinglePrimary,
        familyCandidates,
        skippedNoMatch,
        stats,
      },
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
