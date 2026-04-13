"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type MatchType = "exact" | "core" | "partial" | "overlap" | "none";

type CandidateMatch = {
  sourceId: string;
  sourceType: "commitmentContract" | "purchaseOrderContract";
  title: string;
  number: string | null;
  vendorName: string | null;
  score: number;
  matchType: MatchType;
};

type ScopeReview = {
  scopeId: string;
  scopeTitle: string;
  bestMatch: CandidateMatch | null;
  candidates: CandidateMatch[];
};

type SourceRow = {
  id: string;
  sourceType: "commitmentContract" | "purchaseOrderContract";
  title: string;
  number: string | null;
  vendorName: string | null;
};

type ProjectReview = {
  identity: string;
  customer: string;
  projectName: string;
  projectNumber: string;
  isTestCase?: boolean;
  scopeCount: number;
  sourceCount: number;
  matchedScopeCount: number;
  exactCount: number;
  fuzzyCount: number;
  scopes: ScopeReview[];
  unmatchedSources: SourceRow[];
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  totalProjects?: number;
  totals?: {
    scopeCount?: number;
    sourceCount?: number;
    matchedScopeCount?: number;
  };
  data?: ProjectReview[];
};

export default function ScopeMappingReviewPage() {
  const [rows, setRows] = useState<ProjectReview[]>([]);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceMode, setSourceMode] = useState("both");
  const [search, setSearch] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const url = new URL("/api/procore/scope-mapping-review", window.location.origin);
      if (sourceMode.trim()) url.searchParams.set("sourceMode", sourceMode.trim());
      if (search.trim()) url.searchParams.set("search", search.trim());
      url.searchParams.set("_ts", String(Date.now()));

      const res = await fetch(url.toString(), { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || payload.details || `Request failed with ${res.status}`);
      }

      setRows(Array.isArray(payload.data) ? payload.data : []);
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, sourceMode]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totals = useMemo(() => {
    return {
      projects: rows.length,
      scopes: rows.reduce((sum, row) => sum + row.scopeCount, 0),
      sources: rows.reduce((sum, row) => sum + row.sourceCount, 0),
      matchedScopes: rows.reduce((sum, row) => sum + row.matchedScopeCount, 0),
    };
  }, [rows]);

  function toggleProject(identity: string) {
    setCollapsedProjects((prev) => ({
      ...prev,
      [identity]: !(prev[identity] ?? true),
    }));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation />

      <div className="flex h-[calc(100vh-48px)] flex-col w-full px-3 py-8 space-y-5 xl:px-4 2xl:px-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-gray-800">Scope Mapping Review</h1>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                Compares `ProjectScope.title` to commitment titles by customer plus project name.
              </p>
              {!!lastRefreshedAt && (
                <p className="mt-1 text-[11px] font-semibold text-gray-500">Last refreshed: {lastRefreshedAt}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatCard label="Projects" value={totals.projects.toLocaleString()} />
              <StatCard label="Scopes" value={totals.scopes.toLocaleString()} />
              <StatCard label="Source Titles" value={totals.sources.toLocaleString()} />
              <StatCard label="Matched Scopes" value={totals.matchedScopes.toLocaleString()} />
              <button
                onClick={() => void loadRows()}
                className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-800"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={sourceMode}
              onChange={(e) => setSourceMode(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            >
              <option value="both">Both contract tables</option>
              <option value="commitmentContract">Commitment contracts only</option>
              <option value="purchaseOrderContract">Purchase order contracts only</option>
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search project, scope, or match title"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              onClick={() => setSearch("")}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-gray-50"
            >
              Clear Search
            </button>
          </div>

          {!!error && <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>}
        </section>

        <section className="min-h-0 flex-1 overflow-auto rounded-2xl border border-gray-200 bg-white p-4">
          <table className="min-w-[1600px] text-xs">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-gray-200 bg-white text-left uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3">Toggle</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Project #</th>
                <th className="py-2 pr-3 text-right">Scopes</th>
                <th className="py-2 pr-3 text-right">Source Titles</th>
                <th className="py-2 pr-3 text-right">Matched</th>
                <th className="py-2 pr-3 text-right">Exact</th>
                <th className="py-2 pr-3 text-right">Fuzzy</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={9}>
                    No scoped projects found.
                  </td>
                </tr>
              )}

              {rows.map((project) => {
                const collapsed = collapsedProjects[project.identity] ?? true;
                return (
                  <Fragment key={project.identity}>
                    <tr className="border-b border-slate-200 bg-slate-100 text-slate-900">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => toggleProject(project.identity)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                        >
                          {collapsed ? "Expand" : "Collapse"}
                        </button>
                      </td>
                      <td className="py-2 pr-3">{project.customer || "-"}</td>
                      <td className="py-2 pr-3 font-semibold">
                        <div className="flex items-center gap-2">
                          <span>{project.projectName || "-"}</span>
                          {project.isTestCase && (
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">
                              Test Case
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{project.projectNumber || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{project.scopeCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{project.sourceCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{project.matchedScopeCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{project.exactCount.toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{project.fuzzyCount.toLocaleString()}</td>
                    </tr>
                    {!collapsed && (
                      <tr className="border-b border-gray-200 bg-white">
                        <td colSpan={9} className="p-0">
                          <div className="space-y-4 p-4">
                            <div className="overflow-auto rounded-lg border border-slate-200">
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wider text-slate-500">
                                    <th className="py-2 pr-3 pl-3">Scope Title</th>
                                    <th className="py-2 pr-3">Best Match</th>
                                    <th className="py-2 pr-3">Match Type</th>
                                    <th className="py-2 pr-3 text-right">Score</th>
                                    <th className="py-2 pr-3">Source</th>
                                    <th className="py-2 pr-3">Number</th>
                                    <th className="py-2 pr-3">Vendor</th>
                                    <th className="py-2 pr-3">Alternatives</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {project.scopes.map((scope) => (
                                    <tr key={scope.scopeId} className="border-b border-gray-100 align-top text-gray-800">
                                      <td className="py-2 pr-3 pl-3 font-semibold">{scope.scopeTitle}</td>
                                      <td className="py-2 pr-3">{scope.bestMatch?.title || "No match"}</td>
                                      <td className="py-2 pr-3">
                                        <MatchBadge matchType={scope.bestMatch?.matchType || "none"} />
                                      </td>
                                      <td className="py-2 pr-3 whitespace-nowrap text-right">{scope.bestMatch?.score ?? 0}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{formatSourceType(scope.bestMatch?.sourceType)}</td>
                                      <td className="py-2 pr-3 whitespace-nowrap">{scope.bestMatch?.number || "-"}</td>
                                      <td className="py-2 pr-3">{scope.bestMatch?.vendorName || "-"}</td>
                                      <td className="py-2 pr-3">
                                        {scope.candidates.length > 1
                                          ? scope.candidates
                                              .slice(1)
                                              .map((candidate) => `${candidate.title} (${candidate.score})`)
                                              .join(" | ")
                                          : "-"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div>
                              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                                Unmatched Source Titles
                              </p>
                              <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
                                <table className="min-w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wider text-slate-500">
                                      <th className="py-2 pr-3 pl-3">Title</th>
                                      <th className="py-2 pr-3">Source</th>
                                      <th className="py-2 pr-3">Number</th>
                                      <th className="py-2 pr-3">Vendor</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {project.unmatchedSources.length === 0 && (
                                      <tr>
                                        <td className="py-3 pr-3 pl-3 text-gray-500" colSpan={4}>
                                          No extra source titles left unmatched.
                                        </td>
                                      </tr>
                                    )}
                                    {project.unmatchedSources.map((source) => (
                                      <tr key={source.id} className="border-b border-gray-100 text-gray-800">
                                        <td className="py-2 pr-3 pl-3">{source.title}</td>
                                        <td className="py-2 pr-3 whitespace-nowrap">{formatSourceType(source.sourceType)}</td>
                                        <td className="py-2 pr-3 whitespace-nowrap">{source.number || "-"}</td>
                                        <td className="py-2 pr-3">{source.vendorName || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <p className="font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function formatSourceType(value: CandidateMatch["sourceType"] | SourceRow["sourceType"] | undefined) {
  if (value === "commitmentContract") return "Commitment";
  if (value === "purchaseOrderContract") return "PO Contract";
  return "-";
}

function MatchBadge({ matchType }: { matchType: MatchType }) {
  const styles: Record<MatchType, string> = {
    exact: "bg-emerald-100 text-emerald-800 border-emerald-200",
    core: "bg-blue-100 text-blue-800 border-blue-200",
    partial: "bg-amber-100 text-amber-800 border-amber-200",
    overlap: "bg-violet-100 text-violet-800 border-violet-200",
    none: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${styles[matchType]}`}>
      {matchType}
    </span>
  );
}
