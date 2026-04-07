"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ProjectRow = {
  id: string;
  projectName?: string | null;
  projectNumber?: string | null;
  customer?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  projectStageName?: string | null;
  projectStageCategory?: string | null;
  bidBoardStatus?: string | null;
  bidBoardId?: string | null;
  procoreId?: string | null;
  syncedAt?: string | null;
};

type BidBoardRow = {
  id: string;
  bidBoardId?: string | null;
  projectName?: string | null;
  customer?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  procoreId?: string | null;
  syncedAt?: string | null;
};

type SortKey = "projectName" | "projectNumber" | "customer" | "status" | "projectStageName" | "bidBoardStatus";

type ApiResponse = {
  success?: boolean;
  data?: ProjectRow[];
};

type BidBoardApiResponse = {
  success?: boolean;
  data?: BidBoardRow[];
};

export default function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [bidBoardRows, setBidBoardRows] = useState<BidBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("projectName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const projectsUrl = new URL("/api/projects-v1-live", window.location.origin);
      projectsUrl.searchParams.set("page", "1");
      projectsUrl.searchParams.set("pageSize", "500");
      projectsUrl.searchParams.set("_ts", String(Date.now()));

      const bidBoardUrl = new URL("/api/bid-board-live", window.location.origin);
      bidBoardUrl.searchParams.set("page", "1");
      bidBoardUrl.searchParams.set("pageSize", "500");
      bidBoardUrl.searchParams.set("_ts", String(Date.now()));

      const [projectsResponse, bidBoardResponse] = await Promise.all([
        fetch(projectsUrl.toString(), { cache: "no-store" }),
        fetch(bidBoardUrl.toString(), { cache: "no-store" }),
      ]);

      if (!projectsResponse.ok) {
        throw new Error(`Projects request failed with ${projectsResponse.status}`);
      }
      if (!bidBoardResponse.ok) {
        throw new Error(`Bid Board request failed with ${bidBoardResponse.status}`);
      }

      const payload = (await projectsResponse.json()) as ApiResponse;
      const bidPayload = (await bidBoardResponse.json()) as BidBoardApiResponse;
      const projectItems = Array.isArray(payload.data) ? payload.data : [];
      const bidItems = Array.isArray(bidPayload.data) ? bidPayload.data : [];

      setRows(projectItems);
      setBidBoardRows(bidItems);
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      setRows([]);
      setBidBoardRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAndReload = useCallback(async () => {
    setSyncing(true);
    setError("");

    try {
      const response = await fetch("/api/procore/sync/all-projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fetchAll: true,
          includeInactiveV1: true,
          includeTestProjects: true,
          maxPages: 1000,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Sync failed with ${response.status}`);
      }

      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync from Procore");
    } finally {
      setSyncing(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const statusOptions = useMemo(() => {
    const all = new Set<string>();

    for (const row of rows) {
      const status = (row.status || "").trim();
      if (status) all.add(status);
    }
    for (const row of bidBoardRows) {
      const status = (row.status || "").trim();
      if (status) all.add(status);
    }

    return ["All", ...Array.from(all).sort((a, b) => a.localeCompare(b))];
  }, [rows, bidBoardRows]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();

    const base = rows.filter((row) => {
      if (statusFilter !== "All" && (row.status || "") !== statusFilter) return false;

      if (!q) return true;

      const fields = [
        row.projectName,
        row.projectNumber,
        row.customer,
        row.status,
        row.projectStageName,
        row.projectStageCategory,
        row.bidBoardStatus,
        row.procoreId,
      ]
        .map((v) => (v || "").toString().toLowerCase())
        .join(" ");

      return fields.includes(q);
    });

    const sorted = [...base].sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase();
      const bv = (b[sortKey] || "").toString().toLowerCase();
      const cmp = av.localeCompare(bv);
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [rows, query, statusFilter, sortKey, sortDirection]);

  const filteredBidBoard = useMemo(() => {
    const q = query.trim().toLowerCase();

    const base = bidBoardRows.filter((row) => {
      if (statusFilter !== "All" && (row.status || "") !== statusFilter) return false;

      if (!q) return true;

      const fields = [
        row.projectName,
        row.customer,
        row.status,
        row.procoreId,
        row.bidBoardId,
      ]
        .map((v) => (v || "").toString().toLowerCase())
        .join(" ");

      return fields.includes(q);
    });

    return [...base].sort((a, b) => {
      const av = (a.projectName || "").toString().toLowerCase();
      const bv = (b.projectName || "").toString().toLowerCase();
      return av.localeCompare(bv);
    });
  }, [bidBoardRows, query, statusFilter]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500">
            Live Procore endpoint snapshots (V1 + Bid Board).
            {lastRefreshedAt ? ` Last refreshed: ${lastRefreshedAt}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void syncAndReload()}
            disabled={syncing || loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {syncing ? "Syncing Procore..." : "Sync Procore Now"}
          </button>

          <button
            onClick={() => void loadProjects()}
            disabled={loading || syncing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh Live Data"}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <input
          type="text"
          placeholder="Search name, number, customer, status, IDs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold text-gray-900">Projects V1 (Live)</h2>
      <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <HeaderCell label="Project Name" onClick={() => toggleSort("projectName")} />
              <HeaderCell label="Project #" onClick={() => toggleSort("projectNumber")} />
              <HeaderCell label="Customer" onClick={() => toggleSort("customer")} />
              <HeaderCell label="Status" onClick={() => toggleSort("status")} />
              <HeaderCell label="Project Stage" onClick={() => toggleSort("projectStageName")} />
              <HeaderCell label="Bid Board Status" onClick={() => toggleSort("bidBoardStatus")} />
              <th className="px-3 py-2 text-left">Procore ID</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredProjects.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                  No V1 projects found.
                </td>
              </tr>
            )}

            {filteredProjects.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">{row.projectName || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.projectNumber || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.customer || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.status || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.projectStageName || row.projectStageCategory || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.bidBoardStatus || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.procoreId || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500">Showing {filteredProjects.length.toLocaleString()} V1 project(s).</p>

      <h2 className="mb-2 text-lg font-semibold text-gray-900">Bid Board (Live)</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Project Name</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Procore Project ID</th>
              <th className="px-3 py-2 text-left">Bid Board ID</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredBidBoard.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                  No bid board items found.
                </td>
              </tr>
            )}

            {filteredBidBoard.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">{row.projectName || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.customer || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.status || "Unknown"}</td>
                <td className="px-3 py-2 text-gray-700">{row.procoreId || ""}</td>
                <td className="px-3 py-2 text-gray-700">{row.bidBoardId || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">Showing {filteredBidBoard.length.toLocaleString()} bid board item(s).</p>
    </div>
  );
}

function HeaderCell({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th className="px-3 py-2 text-left">
      <button onClick={onClick} className="font-semibold text-gray-500 hover:text-gray-700">
        {label}
      </button>
    </th>
  );
}
