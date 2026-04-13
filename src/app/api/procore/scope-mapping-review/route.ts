import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ProjectRecord = {
  id: string;
  customer: string | null;
  projectNumber: string | null;
  projectName: string;
};

type ScopeRecord = {
  id: string;
  title: string;
  jobKey: string;
};

type ContractRecord = {
  id: string;
  title: string | null;
  number: string | null;
  vendorName: string | null;
  projectId: string | null;
  procoreProjectId: string | null;
};

type SourceCandidate = {
  id: string;
  identity: string;
  sourceType: "commitmentContract" | "purchaseOrderContract";
  title: string;
  number: string | null;
  vendorName: string | null;
};

type ProjectMeta = {
  customer: string;
  projectName: string;
  projectNumber: string;
};

type ProcoreProjectFeedRecord = {
  externalId: string;
  procoreId: string | null;
  customer: string | null;
  projectName: string;
  projectNumber: string | null;
  linkedProjectId: string | null;
};

type MatchType = "exact" | "core" | "partial" | "overlap" | "none";

type ScopeCandidateMatch = {
  sourceId: string;
  sourceType: SourceCandidate["sourceType"];
  title: string;
  number: string | null;
  vendorName: string | null;
  score: number;
  matchType: MatchType;
};

function isGiant6582TestCase(customer: string | null | undefined, projectName: string | null | undefined) {
  return normalize(customer) === normalize("Ames Construction, Inc.") && normalize(projectName) === normalize("Giant #6582");
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function tokenize(value: unknown) {
  return new Set(
    alphaCore(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function parseJobKey(jobKey: string) {
  const [customer = "", projectNumber = "", projectName = ""] = String(jobKey || "").split("~");
  return { customer, projectNumber, projectName };
}

function makeIdentity(customer: string | null | undefined, projectName: string | null | undefined) {
  return `${normalize(customer)}||${normalize(projectName)}`;
}

function toProjectMeta(meta?: Partial<ProjectMeta> | null): ProjectMeta {
  return {
    customer: String(meta?.customer || "").trim(),
    projectName: String(meta?.projectName || "").trim(),
    projectNumber: String(meta?.projectNumber || "").trim(),
  };
}

function resolveContractProjectMeta(
  row: ContractRecord,
  projectById: Map<string, ProjectRecord>,
  feedByExternalId: Map<string, ProcoreProjectFeedRecord>,
  feedByProcoreId: Map<string, ProcoreProjectFeedRecord>
) {
  const directProject = row.projectId ? projectById.get(row.projectId) : null;
  const externalFeed = row.procoreProjectId ? feedByExternalId.get(row.procoreProjectId) : null;
  const procoreFeed = row.procoreProjectId ? feedByProcoreId.get(row.procoreProjectId) : null;
  const feed = externalFeed || procoreFeed || null;
  const linkedProject = feed?.linkedProjectId ? projectById.get(feed.linkedProjectId) : null;

  const meta = toProjectMeta({
    customer: feed?.customer || linkedProject?.customer || directProject?.customer,
    projectName: feed?.projectName || linkedProject?.projectName || directProject?.projectName,
    projectNumber: feed?.projectNumber || linkedProject?.projectNumber || directProject?.projectNumber,
  });

  return {
    identity: makeIdentity(meta.customer, meta.projectName),
    meta,
  };
}

function compareTitles(scopeTitle: string, candidateTitle: string): { score: number; matchType: MatchType } {
  const scopeNorm = normalize(scopeTitle);
  const candidateNorm = normalize(candidateTitle);
  if (!scopeNorm || !candidateNorm) {
    return { score: 0, matchType: "none" };
  }
  if (scopeNorm === candidateNorm) {
    return { score: 100, matchType: "exact" };
  }

  const scopeCore = alphaCore(scopeTitle);
  const candidateCore = alphaCore(candidateTitle);
  if (scopeCore && candidateCore && scopeCore === candidateCore) {
    return { score: 90, matchType: "core" };
  }
  if (scopeCore && candidateCore && (scopeCore.includes(candidateCore) || candidateCore.includes(scopeCore))) {
    return { score: 75, matchType: "partial" };
  }

  const scopeTokens = tokenize(scopeTitle);
  const candidateTokens = tokenize(candidateTitle);
  if (scopeTokens.size === 0 || candidateTokens.size === 0) {
    return { score: 0, matchType: "none" };
  }

  let overlap = 0;
  for (const token of scopeTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }

  if (overlap === 0) {
    return { score: 0, matchType: "none" };
  }

  const jaccard = overlap / new Set([...scopeTokens, ...candidateTokens]).size;
  if (overlap >= 2 || jaccard >= 0.5) {
    return { score: Math.round(55 + jaccard * 20), matchType: "overlap" };
  }

  return { score: 0, matchType: "none" };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sourceMode = String(searchParams.get("sourceMode") || "both").trim();
    const search = String(searchParams.get("search") || "").trim().toLowerCase();

    const [projects, scopes, commitmentContracts, purchaseOrderContracts, procoreProjectFeed] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true,
          customer: true,
          projectNumber: true,
          projectName: true,
        },
      }) as Promise<ProjectRecord[]>,
      prisma.projectScope.findMany({
        select: {
          id: true,
          title: true,
          jobKey: true,
        },
      }) as Promise<ScopeRecord[]>,
      prisma.commitmentContract.findMany({
        select: {
          id: true,
          title: true,
          number: true,
          vendorName: true,
          projectId: true,
          procoreProjectId: true,
        },
      }) as Promise<ContractRecord[]>,
      prisma.purchaseOrderContract.findMany({
        select: {
          id: true,
          title: true,
          number: true,
          vendorName: true,
          projectId: true,
          procoreProjectId: true,
        },
      }) as Promise<ContractRecord[]>,
      prisma.procoreProjectFeed.findMany({
        where: {
          syncSource: "procore_v1_projects",
          softDeleted: false,
        },
        select: {
          externalId: true,
          procoreId: true,
          customer: true,
          projectName: true,
          projectNumber: true,
          linkedProjectId: true,
        },
      }) as Promise<ProcoreProjectFeedRecord[]>,
    ]);

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const feedByExternalId = new Map(
      procoreProjectFeed.filter((row) => row.externalId).map((row) => [row.externalId, row])
    );
    const feedByProcoreId = new Map(
      procoreProjectFeed.filter((row) => row.procoreId).map((row) => [row.procoreId as string, row])
    );
    const scopesByIdentity = new Map<string, ScopeRecord[]>();
    const projectMetaByIdentity = new Map<string, ProjectMeta>();

    for (const scope of scopes) {
      const parsed = parseJobKey(scope.jobKey);
      const identity = makeIdentity(parsed.customer, parsed.projectName);
      if (!identity || identity === "||") continue;

      const bucket = scopesByIdentity.get(identity) || [];
      bucket.push(scope);
      scopesByIdentity.set(identity, bucket);

      if (!projectMetaByIdentity.has(identity)) {
        projectMetaByIdentity.set(identity, toProjectMeta(parsed));
      }
    }

    const selectedSources: SourceCandidate[] = [];

    if (sourceMode === "both" || sourceMode === "commitmentContract") {
      for (const row of commitmentContracts) {
        const title = String(row.title || "").trim();
        const resolved = resolveContractProjectMeta(row, projectById, feedByExternalId, feedByProcoreId);
        const identity = resolved.identity;
        if (!title || !identity || identity === "||") continue;
        selectedSources.push({
          id: row.id,
          identity,
          sourceType: "commitmentContract",
          title,
          number: row.number,
          vendorName: row.vendorName,
        });
        if (!projectMetaByIdentity.has(identity)) {
          projectMetaByIdentity.set(identity, resolved.meta);
        }
      }
    }

    if (sourceMode === "both" || sourceMode === "purchaseOrderContract") {
      for (const row of purchaseOrderContracts) {
        const title = String(row.title || "").trim();
        const resolved = resolveContractProjectMeta(row, projectById, feedByExternalId, feedByProcoreId);
        const identity = resolved.identity;
        if (!title || !identity || identity === "||") continue;
        selectedSources.push({
          id: row.id,
          identity,
          sourceType: "purchaseOrderContract",
          title,
          number: row.number,
          vendorName: row.vendorName,
        });
        if (!projectMetaByIdentity.has(identity)) {
          projectMetaByIdentity.set(identity, resolved.meta);
        }
      }
    }

    const sourcesByIdentity = new Map<string, SourceCandidate[]>();
    for (const source of selectedSources) {
      const bucket = sourcesByIdentity.get(source.identity) || [];
      bucket.push(source);
      sourcesByIdentity.set(source.identity, bucket);
    }

    const results = Array.from(scopesByIdentity.entries())
      .map(([identity, scopeRows]) => {
        const meta = projectMetaByIdentity.get(identity) || {
          customer: "",
          projectName: "",
          projectNumber: "",
        };
        const sourceRows = sourcesByIdentity.get(identity) || [];
        const usedSourceIds = new Set<string>();

        const mappedScopes = scopeRows.map((scope) => {
          const candidates = sourceRows
            .map((candidate) => {
              const compared = compareTitles(scope.title, candidate.title);
              return {
                sourceId: candidate.id,
                sourceType: candidate.sourceType,
                title: candidate.title,
                number: candidate.number,
                vendorName: candidate.vendorName,
                score: compared.score,
                matchType: compared.matchType,
              } satisfies ScopeCandidateMatch;
            })
            .filter((candidate) => candidate.score > 0)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

          const bestMatch = candidates[0] || null;
          if (bestMatch) usedSourceIds.add(bestMatch.sourceId);

          return {
            scopeId: scope.id,
            scopeTitle: scope.title,
            bestMatch,
            candidates: candidates.slice(0, 3),
          };
        });

        const unmatchedSources = sourceRows.filter((source) => !usedSourceIds.has(source.id));
        const matchedScopeCount = mappedScopes.filter((scope) => Boolean(scope.bestMatch)).length;

        return {
          identity,
          customer: meta.customer,
          projectName: meta.projectName,
          projectNumber: meta.projectNumber,
          isTestCase: isGiant6582TestCase(meta.customer, meta.projectName),
          scopeCount: scopeRows.length,
          sourceCount: sourceRows.length,
          matchedScopeCount,
          exactCount: mappedScopes.filter((scope) => scope.bestMatch?.matchType === "exact").length,
          fuzzyCount: mappedScopes.filter((scope) => {
            const type = scope.bestMatch?.matchType;
            return type === "core" || type === "partial" || type === "overlap";
          }).length,
          scopes: mappedScopes,
          unmatchedSources: unmatchedSources.slice(0, 25),
        };
      })
      .filter((project) => {
        if (!search) return true;
        const projectText = `${project.customer} ${project.projectName} ${project.projectNumber}`.toLowerCase();
        if (projectText.includes(search)) return true;
        if (project.scopes.some((scope) => scope.scopeTitle.toLowerCase().includes(search))) return true;
        if (project.scopes.some((scope) => scope.bestMatch?.title.toLowerCase().includes(search))) return true;
        if (project.unmatchedSources.some((source) => source.title.toLowerCase().includes(search))) return true;
        return false;
      })
      .sort((a, b) => {
        if (a.isTestCase !== b.isTestCase) {
          return a.isTestCase ? -1 : 1;
        }
        const aStrength = a.exactCount + a.fuzzyCount;
        const bStrength = b.exactCount + b.fuzzyCount;
        return bStrength - aStrength || a.projectName.localeCompare(b.projectName);
      });

    return NextResponse.json({
      success: true,
      sourceMode,
      totalProjects: results.length,
      totals: {
        scopeCount: results.reduce((sum, project) => sum + project.scopeCount, 0),
        sourceCount: results.reduce((sum, project) => sum + project.sourceCount, 0),
        matchedScopeCount: results.reduce((sum, project) => sum + project.matchedScopeCount, 0),
      },
      data: results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to build scope mapping review:", message);
    return NextResponse.json(
      { success: false, error: "Failed to build scope mapping review", details: message },
      { status: 500 }
    );
  }
}
