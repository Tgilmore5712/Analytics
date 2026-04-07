"use client";

import React, { useEffect, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type ReportType = "timecards" | "productivity";

interface ReportRow {
  project_name: string;
  customer: string;
  procore_project_id: string;
  work_date: string;
  cost_code: string;
  display_name: string;
  budgeted_qty: number;
  // timecards
  labor_qty?: number;
  labor_qty_to_date?: number;
  // productivity
  production_qty?: number;
  production_qty_to_date?: number;
  delta: number;
  pct_complete: number | null;
}

interface ProjectOption {
  procoreId: string;
  projectName: string;
}

// ── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: keyof ReportRow;
  label: string;
  types: ReportType[]; // which report types show this column
  align?: "left" | "right";
  format?: (v: unknown) => string;
}

const ALL_COLUMNS: ColDef[] = [
  { key: "project_name",           label: "Project",             types: ["timecards", "productivity"], align: "left"  },
  { key: "customer",               label: "Customer",            types: ["timecards", "productivity"], align: "left"  },
  { key: "procore_project_id",     label: "Procore ID",          types: ["timecards", "productivity"], align: "left"  },
  { key: "work_date",              label: "Date",                types: ["timecards", "productivity"], align: "left"  },
  { key: "cost_code",              label: "Cost Code",           types: ["timecards", "productivity"], align: "left"  },
  { key: "display_name",           label: "Description",         types: ["timecards", "productivity"], align: "left"  },
  { key: "budgeted_qty",           label: "Budgeted Qty",        types: ["timecards", "productivity"], align: "right", format: fmtNum },
  { key: "labor_qty",              label: "Labor Qty",           types: ["timecards"],                 align: "right", format: fmtNum },
  { key: "labor_qty_to_date",      label: "Labor To Date",       types: ["timecards"],                 align: "right", format: fmtNum },
  { key: "production_qty",         label: "Production Qty",      types: ["productivity"],              align: "right", format: fmtNum },
  { key: "production_qty_to_date", label: "Production To Date",  types: ["productivity"],              align: "right", format: fmtNum },
  { key: "delta",                  label: "Delta",               types: ["timecards", "productivity"], align: "right", format: fmtNum },
  { key: "pct_complete",           label: "% Complete",          types: ["timecards", "productivity"], align: "right", format: (v) => v == null ? "—" : `${v}%` },
];

function fmtNum(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LaborReportPage() {
  const [reportType, setReportType] = useState<ReportType>("timecards");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [visibleCols, setVisibleCols] = useState<Set<keyof ReportRow>>(() => {
    const defaults = new Set<keyof ReportRow>(
      ALL_COLUMNS.filter((c) => c.types.includes("timecards")).map((c) => c.key)
    );
    return defaults;
  });

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ran, setRan] = useState(false);

  // Load project list for dropdown
  useEffect(() => {
    fetch("/api/projects?pageSize=500&includeArchived=false")
      .then((r) => r.json())
      .then((data) => {
        const list: ProjectOption[] = (data.projects ?? data ?? [])
          .filter((p: Record<string, unknown>) => p.procoreId)
          .map((p: Record<string, unknown>) => ({
            procoreId: String(p.procoreId),
            projectName: String(p.projectName ?? p.procoreId),
          }))
          .sort((a: ProjectOption, b: ProjectOption) => a.projectName.localeCompare(b.projectName));
        setProjects(list);
      })
      .catch(() => {});
  }, []);

  // When report type changes, reset visible columns to defaults for that type
  const handleTypeChange = (t: ReportType) => {
    setReportType(t);
    setVisibleCols(new Set(ALL_COLUMNS.filter((c) => c.types.includes(t)).map((c) => c.key)));
    setRows([]);
    setRan(false);
  };

  const toggleCol = (key: keyof ReportRow) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const runReport = useCallback(async () => {
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const url = new URL("/api/labor-report", window.location.origin);
      url.searchParams.set("type", reportType);
      if (projectId) url.searchParams.set("projectId", projectId);
      if (dateFrom)  url.searchParams.set("dateFrom", dateFrom);
      if (dateTo)    url.searchParams.set("dateTo", dateTo);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setRan(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [reportType, projectId, dateFrom, dateTo]);

  // Columns applicable to the current report type
  const availableCols = ALL_COLUMNS.filter((c) => c.types.includes(reportType));
  const activeCols    = availableCols.filter((c) => visibleCols.has(c.key));

  return (
    <div className="p-6 max-w-full">
      <h1 className="text-2xl font-bold mb-6">Labor Report Builder</h1>

      {/* ── Filters ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Report type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Report Type
            </label>
            <select
              value={reportType}
              onChange={(e) => handleTypeChange(e.target.value as ReportType)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="timecards">Timecards</option>
              <option value="productivity">Productivity Log</option>
            </select>
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.procoreId} value={p.procoreId}>
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Date From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              Date To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Column toggles */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Columns</p>
          <div className="flex flex-wrap gap-2">
            {availableCols.map((col) => (
              <button
                key={col.key}
                onClick={() => toggleCol(col.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  visibleCols.has(col.key)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={runReport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
          >
            {loading ? "Running…" : "Run Report"}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Results ── */}
      {ran && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-gray-400">
              {reportType === "timecards" ? "Timecards" : "Productivity Log"}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No data for the selected filters.</div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {activeCols.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${
                          col.align === "right" ? "text-right" : "text-left"
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        i % 2 === 0 ? "" : "bg-gray-50/50"
                      }`}
                    >
                      {activeCols.map((col) => {
                        const raw = row[col.key];
                        const display = col.format ? col.format(raw) : (raw ?? "—");
                        const isNegative = col.key === "delta" && Number(raw) < 0;
                        return (
                          <td
                            key={col.key}
                            className={`px-4 py-2 whitespace-nowrap ${
                              col.align === "right" ? "text-right tabular-nums" : ""
                            } ${isNegative ? "text-red-600 font-medium" : "text-gray-800"}`}
                          >
                            {String(display)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!ran && !loading && (
        <div className="text-center text-gray-400 text-sm mt-12">
          Select your filters and click <strong>Run Report</strong> to get started.
        </div>
      )}
    </div>
  );
}
