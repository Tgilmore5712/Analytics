import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureGanttV2Schema, getGanttV2Scopes } from "@/lib/ganttV2Db";

export const dynamic = "force-dynamic";

type LegacyScopeRow = {
  id: string;
  jobKey: string;
  title: string;
  tasks: unknown;
  selectedDays: unknown;
  schedulingMode: string | null;
  updatedAt: Date;
};

type GanttProjectRow = {
  id: string;
  customer: string | null;
  project_number: string | null;
  project_name: string;
};

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseJobKey(jobKey: unknown) {
  const [customer = "", projectNumber = "", projectName = ""] = String(jobKey || "").split("~");
  return { customer, projectNumber, projectName };
}

function makeIdentity(customer: unknown, projectName: unknown) {
  return `${normalizeIdentity(customer)}||${normalizeIdentity(projectName)}`;
}

function normalizeTaskCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function normalizeSelectedDayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function alphaCore(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/\b(?:sq|sf|lf|ln|ft|inch|in|x|co|no|billing|file|budgeted|non|help|and|with)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(value: string) {
  let token = value.trim().toLowerCase();
  if (!token) return "";

  if (token === "sog") {
    return "slab";
  }

  if (token.endsWith("ies") && token.length > 4) {
    token = `${token.slice(0, -3)}y`;
  } else if (token.endsWith("ed") && token.length > 5) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s") && token.length > 4) {
    token = token.slice(0, -1);
  }

  return token;
}

function tokenize(value: unknown) {
  return new Set(
    alphaCore(value)
      .split(" ")
      .map((token) => normalizeToken(token))
      .filter((token) => token.length >= 3)
  );
}

function extractNumericTokens(value: unknown) {
  return new Set(
    Array.from(String(value || "").matchAll(/\d+(?:[.,]\d+)?/g)).map((match) =>
      String(match[0] || "").replace(/[.,]/g, "")
    )
  );
}

const anchorTokens = new Set([
  "sidewalk",
  "footer",
  "footing",
  "foundation",
  "slab",
  "paver",
  "porch",
  "curb",
  "wall",
  "pier",
  "bollard",
  "stair",
  "step",
  "deck",
  "ramp",
  "pit",
  "apron",
]);

function compareTitles(scopeTitle: string, candidateTitle: string): number {
  const scopeNorm = normalizeIdentity(scopeTitle);
  const candidateNorm = normalizeIdentity(candidateTitle);
  if (!scopeNorm || !candidateNorm) return 0;
  if (scopeNorm === candidateNorm) return 100;

  const scopeCore = alphaCore(scopeTitle);
  const candidateCore = alphaCore(candidateTitle);
  if (scopeCore && candidateCore && scopeCore === candidateCore) return 90;
  if (scopeCore && candidateCore && (scopeCore.includes(candidateCore) || candidateCore.includes(scopeCore))) {
    return 75;
  }

  const scopeTokens = tokenize(scopeTitle);
  const candidateTokens = tokenize(candidateTitle);
  if (scopeTokens.size === 0 || candidateTokens.size === 0) return 0;

  const scopeNumbers = extractNumericTokens(scopeTitle);
  const candidateNumbers = extractNumericTokens(candidateTitle);

  let overlap = 0;
  const sharedTokens: string[] = [];
  for (const token of scopeTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
      sharedTokens.push(token);
    }
  }
  if (overlap === 0) return 0;

  const sharedNumberCount = Array.from(scopeNumbers).filter((token) => candidateNumbers.has(token)).length;
  const hasSharedAnchor = sharedTokens.some((token) => anchorTokens.has(token));

  if (scopeNumbers.size > 0 && candidateNumbers.size > 0 && sharedNumberCount === 0 && hasSharedAnchor && overlap <= 1) {
    return 0;
  }

  const jaccard = overlap / new Set([...scopeTokens, ...candidateTokens]).size;
  if (overlap >= 2 || jaccard >= 0.5) {
    return Math.min(Math.round(55 + jaccard * 20 + sharedNumberCount * 10), 98);
  }

  if (hasSharedAnchor) {
    return Math.min(50 + sharedNumberCount * 10, 70);
  }

  return 0;
}

async function moveActiveScheduleRows(params: {
  oldJobKey: string;
  newJobKey: string;
  oldTitle: string;
  newTitle: string;
}) {
  const { oldJobKey, newJobKey, oldTitle, newTitle } = params;
  const rows = await prisma.activeSchedule.findMany({
    where: {
      jobKey: oldJobKey,
      scopeOfWork: oldTitle,
      source: "gantt",
    },
    orderBy: { date: "asc" },
  });

  let moved = 0;
  let deduped = 0;

  for (const row of rows) {
    await prisma.activeSchedule.upsert({
      where: {
        jobKey_scopeOfWork_date: {
          jobKey: newJobKey,
          scopeOfWork: newTitle,
          date: row.date,
        },
      },
      update: {},
      create: {
        jobKey: newJobKey,
        projectId: row.projectId,
        scopeOfWork: newTitle,
        date: row.date,
        hours: row.hours,
        foreman: row.foreman,
        manpower: row.manpower,
        source: row.source,
      },
    });

    if (row.jobKey === newJobKey && row.scopeOfWork === newTitle) {
      continue;
    }

    const deleted = await prisma.activeSchedule.deleteMany({
      where: { id: row.id },
    });

    if (deleted.count > 0) {
      moved += 1;
    } else {
      deduped += 1;
    }
  }

  return { moved, deduped, scanned: rows.length };
}

async function moveScopeTrackingRows(params: {
  oldJobKey: string;
  newJobKey: string;
  oldTitle: string;
  newTitle: string;
}) {
  const { oldJobKey, newJobKey, oldTitle, newTitle } = params;
  const rows = await prisma.scopeTracking.findMany({
    where: {
      jobKey: oldJobKey,
      scopeOfWork: oldTitle,
    },
  });

  let moved = 0;
  let deduped = 0;

  for (const row of rows) {
    await prisma.scopeTracking.upsert({
      where: {
        jobKey_scopeOfWork: {
          jobKey: newJobKey,
          scopeOfWork: newTitle,
        },
      },
      update: {},
      create: {
        jobKey: newJobKey,
        projectId: row.projectId,
        scopeOfWork: newTitle,
        totalHours: row.totalHours,
        scheduledHours: row.scheduledHours,
        unscheduledHours: row.unscheduledHours,
      },
    });

    if (row.jobKey === newJobKey && row.scopeOfWork === newTitle) {
      continue;
    }

    const deleted = await prisma.scopeTracking.deleteMany({
      where: { id: row.id },
    });

    if (deleted.count > 0) {
      moved += 1;
    } else {
      deduped += 1;
    }
  }

  return { moved, deduped, scanned: rows.length };
}

export async function POST(request: NextRequest) {
  try {
    await ensureGanttV2Schema();
    const body = await request.json();

    const customer = String(body?.customer || "").trim();
    const projectName = String(body?.projectName || "").trim();
    const requestedProjectNumber = String(body?.projectNumber || "").trim();
    const dryRun = Boolean(body?.dryRun);

    if (!customer || !projectName) {
      return NextResponse.json(
        { success: false, error: "customer and projectName are required" },
        { status: 400 }
      );
    }

    const identity = makeIdentity(customer, projectName);
    const ganttProjects = await prisma.$queryRawUnsafe<GanttProjectRow[]>(
      `
        SELECT id, customer, project_number, project_name
        FROM gantt_v2_projects
        ORDER BY created_at DESC
      `
    );

    const matchedProject = ganttProjects.find((project) => {
      if (makeIdentity(project.customer, project.project_name) !== identity) return false;
      if (requestedProjectNumber && String(project.project_number || "").trim() !== requestedProjectNumber) return false;
      return true;
    });

    if (!matchedProject) {
      return NextResponse.json(
        { success: false, error: "Matching Gantt V2 project not found" },
        { status: 404 }
      );
    }

    const canonicalJobKey = `${matchedProject.customer || ""}~${matchedProject.project_number || ""}~${matchedProject.project_name || ""}`;
    const ganttScopes = await getGanttV2Scopes(matchedProject.id);
    const legacyScopesAll = await prisma.projectScope.findMany({
      select: {
        id: true,
        jobKey: true,
        title: true,
        tasks: true,
        selectedDays: true,
        schedulingMode: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const legacyScopes = legacyScopesAll
      .filter((scope) => {
        const parsed = parseJobKey(scope.jobKey);
        return makeIdentity(parsed.customer, parsed.projectName) === identity;
      })
      .sort((a, b) => {
        const taskDiff = normalizeTaskCount(b.tasks) - normalizeTaskCount(a.tasks);
        if (taskDiff !== 0) return taskDiff;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      }) as LegacyScopeRow[];

    const usedScopeIds = new Set<string>();
    const matches: Array<{
      legacyScopeId: string;
      oldJobKey: string;
      oldTitle: string;
      newTitle: string;
      ganttScopeId: string;
      score: number;
      changedJobKey: boolean;
      changedTitle: boolean;
      taskCount: number;
      selectedDayCount: number;
      activeScheduleMoved?: { moved: number; deduped: number; scanned: number };
      scopeTrackingMoved?: { moved: number; deduped: number; scanned: number };
    }> = [];
    const unmatchedLegacy: Array<{
      legacyScopeId: string;
      title: string;
      taskCount: number;
      selectedDayCount: number;
    }> = [];

    for (const legacyScope of legacyScopes) {
      const candidates = ganttScopes
        .filter((scope) => !usedScopeIds.has(scope.id))
        .map((scope) => ({
          scope,
          score: compareTitles(legacyScope.title, scope.title),
        }))
        .sort((a, b) => b.score - a.score || a.scope.title.localeCompare(b.scope.title));

      const best = candidates[0];
      if (!best || best.score < 70) {
        unmatchedLegacy.push({
          legacyScopeId: legacyScope.id,
          title: legacyScope.title,
          taskCount: normalizeTaskCount(legacyScope.tasks),
          selectedDayCount: normalizeSelectedDayCount(legacyScope.selectedDays),
        });
        continue;
      }

      usedScopeIds.add(best.scope.id);
      const changedJobKey = legacyScope.jobKey !== canonicalJobKey;
      const changedTitle = normalizeIdentity(legacyScope.title) !== normalizeIdentity(best.scope.title);
      const matchSummary = {
        legacyScopeId: legacyScope.id,
        oldJobKey: legacyScope.jobKey,
        oldTitle: legacyScope.title,
        newTitle: best.scope.title,
        ganttScopeId: best.scope.id,
        score: best.score,
        changedJobKey,
        changedTitle,
        taskCount: normalizeTaskCount(legacyScope.tasks),
        selectedDayCount: normalizeSelectedDayCount(legacyScope.selectedDays),
      };

      if (!dryRun && (changedJobKey || changedTitle)) {
        await prisma.projectScope.update({
          where: { id: legacyScope.id },
          data: {
            jobKey: canonicalJobKey,
            title: best.scope.title,
          },
        });

        const activeScheduleMoved = await moveActiveScheduleRows({
          oldJobKey: legacyScope.jobKey,
          newJobKey: canonicalJobKey,
          oldTitle: legacyScope.title,
          newTitle: best.scope.title,
        });
        const scopeTrackingMoved = await moveScopeTrackingRows({
          oldJobKey: legacyScope.jobKey,
          newJobKey: canonicalJobKey,
          oldTitle: legacyScope.title,
          newTitle: best.scope.title,
        });

        matches.push({
          ...matchSummary,
          activeScheduleMoved,
          scopeTrackingMoved,
        });
      } else {
        matches.push(matchSummary);
      }
    }

    const unmatchedLiveScopes = ganttScopes
      .filter((scope) => !usedScopeIds.has(scope.id))
      .map((scope) => ({
        ganttScopeId: scope.id,
        title: scope.title,
        totalHours: scope.totalHours,
      }));

    return NextResponse.json({
      success: true,
      dryRun,
      project: {
        id: matchedProject.id,
        customer: matchedProject.customer,
        projectNumber: matchedProject.project_number,
        projectName: matchedProject.project_name,
        canonicalJobKey,
      },
      summary: {
        legacyScopeCount: legacyScopes.length,
        ganttScopeCount: ganttScopes.length,
        matchedCount: matches.length,
        changedCount: matches.filter((match) => match.changedJobKey || match.changedTitle).length,
        unmatchedLegacyCount: unmatchedLegacy.length,
        unmatchedLiveScopeCount: unmatchedLiveScopes.length,
      },
      matches,
      unmatchedLegacy,
      unmatchedLiveScopes,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to sync protected project: ${String(error)}` },
      { status: 500 }
    );
  }
}
