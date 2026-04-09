"use client";

import { useEffect, useMemo, useState } from "react";
import { ConcreteOrderModal, type ConcreteOrder, type ConcreteOrderProjectRef } from "@/components/ConcreteOrderModal";

type ActiveScheduleEntry = {
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  source?: string | null;
};

type ConcreteRow = ConcreteOrderProjectRef;
type ConcreteOrderCellSummary = {
  count: number;
  totalYards: number;
  knownConfirmations: number;
  confirmedCount: number;
};
type TaskConcreteSummary = {
  jobKey: string;
  date: string;
  totalYards: number;
  knownConfirmations: number;
  confirmedCount: number;
};

function getCurrentWeekMonday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  const dayOfWeek = monday.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(monday.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getRelativeDateKey(offsetDays: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return formatDateKey(date);
}

function formatHeaderDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ORDER_STORAGE_KEY = "concrete-orders-entries-v1";

export default function ConcreteOrdersSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConcreteRow[]>([]);
  const [orders, setOrders] = useState<ConcreteOrder[]>([]);
  const [taskSummaries, setTaskSummaries] = useState<TaskConcreteSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ConcreteRow | null>(null);
  const minVisibleDate = getRelativeDateKey(-1);

  useEffect(() => {
    void loadSchedule();
    void loadOrders();
  }, []);

  async function loadOrders() {
    try {
      const response = await fetch("/api/concrete-orders", { cache: "no-store" });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const errorMessage =
          typeof errorJson?.error === "string" && errorJson.error
            ? errorJson.error
            : `HTTP ${response.status}`;
        throw new Error(`Failed to fetch concrete orders: ${errorMessage}`);
      }

      const json = await response.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      const summaries = Array.isArray(json?.taskSummaries) ? json.taskSummaries : [];
      setOrders(data);
      setTaskSummaries(summaries);

      // One-time migration for historical local orders.
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (!raw) return;

      const localOrders = JSON.parse(raw);
      if (!Array.isArray(localOrders) || localOrders.length === 0) return;

      for (const order of localOrders) {
        await fetch("/api/concrete-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order),
        });
      }

      localStorage.removeItem(ORDER_STORAGE_KEY);
      const refreshed = await fetch("/api/concrete-orders", { cache: "no-store" });
      const refreshedJson = await refreshed.json();
      setOrders(Array.isArray(refreshedJson?.data) ? refreshedJson.data : []);
      setTaskSummaries(Array.isArray(refreshedJson?.taskSummaries) ? refreshedJson.taskSummaries : []);
    } catch (error) {
      console.error("Failed to load concrete orders:", error);
    }
  }

  async function loadSchedule() {
    try {
      setLoading(true);

      const start = getCurrentWeekMonday();
      const end = new Date(start);
      end.setDate(end.getDate() + 15 * 7 - 1);

      const startDate = formatDateKey(start);
      const endDate = formatDateKey(end);

      const res = await fetch(
        `/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`,
        { cache: "no-store", credentials: "include" }
      );

      if (!res.ok) {
        throw new Error("Failed to load active schedule");
      }

      const json = await res.json();
      const allEntries: ActiveScheduleEntry[] = json?.data || [];

      const entries = allEntries.filter((entry) => {
        const source = (entry.source || "").toLowerCase();
        return (
          source === "gantt" ||
          source === "wip-page" ||
          source === "short-term-schedule" ||
          source === "crew-dispatch" ||
          source === ""
        );
      });

      const rowMap = new Map<string, ConcreteRow>();

      entries.forEach((entry) => {
        if (!entry?.jobKey) return;

        if (!rowMap.has(entry.jobKey)) {
          rowMap.set(entry.jobKey, {
            jobKey: entry.jobKey,
            customer: entry.customer || "",
            projectNumber: entry.projectNumber || "",
            projectName: entry.projectName || entry.jobKey.split("~")[2] || "Project",
          });
        }
      });

      const projectRows = Array.from(rowMap.values()).sort((a, b) =>
        a.projectName.localeCompare(b.projectName)
      );

      setRows(projectRows);
    } catch (error) {
      console.error("Failed to load concrete orders schedule:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function openProjectModal(row: ConcreteRow) {
    setActiveProject(row);
  }

  function closeProjectModal() {
    setActiveProject(null);
  }

  const dateColumns = useMemo(() => {
    return Array.from(
      new Set([
        ...orders.map((order) => order.date),
        ...taskSummaries.map((summary) => summary.date),
      ])
    )
      .filter((dateKey) => dateKey >= minVisibleDate)
      .sort((a, b) => a.localeCompare(b));
  }, [minVisibleDate, orders, taskSummaries]);

  const ordersByProjectDate = useMemo(() => {
    const summary: Record<string, ConcreteOrderCellSummary> = {};

    orders.forEach((order) => {
      const key = `${order.jobKey}__${order.date}`;
      const current = summary[key] || { count: 0, totalYards: 0, knownConfirmations: 0, confirmedCount: 0 };
      summary[key] = {
        count: current.count + 1,
        totalYards: current.totalYards + Number(order.totalYards || 0),
        knownConfirmations:
          current.knownConfirmations + (typeof order.concreteConfirmed === "boolean" ? 1 : 0),
        confirmedCount:
          current.confirmedCount + (order.concreteConfirmed === true ? 1 : 0),
      };
    });

    return summary;
  }, [orders]);

  const taskSummaryByProjectDate = useMemo(() => {
    const summary: Record<string, ConcreteOrderCellSummary> = {};

    taskSummaries.forEach((taskSummary) => {
      const key = `${taskSummary.jobKey}__${taskSummary.date}`;
      summary[key] = {
        count: 0,
        totalYards: Number(taskSummary.totalYards || 0),
        knownConfirmations: Number(taskSummary.knownConfirmations || 0),
        confirmedCount: Number(taskSummary.confirmedCount || 0),
      };
    });

    return summary;
  }, [taskSummaries]);

  const orderCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((order) => {
      if (order.date < minVisibleDate) return;
      counts[order.jobKey] = (counts[order.jobKey] || 0) + 1;
    });
    return counts;
  }, [minVisibleDate, orders]);

  const visibleConcreteJobKeys = useMemo(() => {
    const jobKeys = new Set<string>();

    orders.forEach((order) => {
      if (order.date >= minVisibleDate) {
        jobKeys.add(order.jobKey);
      }
    });

    taskSummaries.forEach((summary) => {
      if (summary.date >= minVisibleDate) {
        jobKeys.add(summary.jobKey);
      }
    });

    return jobKeys;
  }, [minVisibleDate, orders, taskSummaries]);

  const displayRows = useMemo(() => {
    const rowMap = new Map<string, ConcreteRow>();

    rows.forEach((row) => {
      if (!visibleConcreteJobKeys.has(row.jobKey)) return;
      rowMap.set(row.jobKey, row);
    });

    orders.forEach((order) => {
      if (order.date < minVisibleDate) return;
      if (rowMap.has(order.jobKey)) return;
      const [customer = "", projectNumber = "", parsedProjectName = ""] = String(order.jobKey || "").split("~");
      rowMap.set(order.jobKey, {
        jobKey: order.jobKey,
        customer,
        projectNumber,
        projectName: order.projectName || parsedProjectName || "Project",
      });
    });

    taskSummaries.forEach((summary) => {
      if (summary.date < minVisibleDate) return;
      if (rowMap.has(summary.jobKey)) return;
      const [customer = "", projectNumber = "", projectName = ""] = String(summary.jobKey || "").split("~");
      rowMap.set(summary.jobKey, {
        jobKey: summary.jobKey,
        customer,
        projectNumber,
        projectName: projectName || "Project",
      });
    });

    return Array.from(rowMap.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [minVisibleDate, orders, rows, taskSummaries, visibleConcreteJobKeys]);

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-gray-100">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
            Concrete Orders <span className="text-orange-600">Schedule</span>
          </h1>
        </div>

        {loading ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">Loading Concrete Orders...</p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Scheduled Projects Found</p>
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            {dateColumns.length === 0 && (
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 text-xs font-black uppercase tracking-widest text-orange-700">
                No concrete order dates yet. Click a project and save an order to create date columns.
              </div>
            )}
            <div className="overflow-x-auto h-full lt-visible-scrollbar">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-stone-800">
                    <th className="sticky left-0 z-40 bg-stone-800 text-left py-5 px-5 text-sm font-black text-white uppercase tracking-[0.12em] italic border-r border-stone-700 min-w-[260px]">
                      Project
                    </th>
                    {dateColumns.map((dateKey) => (
                      <th
                        key={dateKey}
                        className="text-center py-4 px-3 text-sm font-black text-white border-r border-stone-700 min-w-[120px]"
                      >
                        <div className="text-xs text-orange-400 uppercase tracking-widest">Date</div>
                        <div className="text-xl italic tracking-tight text-white">{formatHeaderDate(dateKey)}</div>
                      </th>
                    ))}
                    <th className="text-center py-5 px-5 text-sm font-black text-white bg-stone-800 border-l border-stone-700 uppercase tracking-widest">
                      Orders
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, idx) => (
                    <tr
                      key={row.jobKey}
                      className={`border-b border-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                    >
                      <td className="sticky left-0 z-20 bg-inherit py-3 px-5 text-sm font-black text-gray-900 border-r border-gray-100">
                        <button
                          type="button"
                          onClick={() => openProjectModal(row)}
                          className="w-full text-left hover:text-orange-700 transition-colors"
                        >
                          <div className="truncate uppercase italic tracking-tight">{row.projectName}</div>
                          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider truncate mt-1">
                            {row.customer} {row.projectNumber ? `| ${row.projectNumber}` : ""}
                          </div>
                        </button>
                      </td>
                      {dateColumns.map((dateKey) => {
                        const orderSummary = ordersByProjectDate[`${row.jobKey}__${dateKey}`];
                        const taskSummary = taskSummaryByProjectDate[`${row.jobKey}__${dateKey}`];
                        const summary = orderSummary || taskSummary;
                        const confirmationSummary = taskSummary || orderSummary;
                        return (
                          <td
                            key={`${row.jobKey}-${dateKey}`}
                            className={`text-center py-3 px-2 text-xs border-r border-gray-100 font-black uppercase tracking-wider ${summary ? "bg-orange-50/40 text-orange-700" : "text-gray-300"}`}
                          >
                            {summary ? (
                              <div className="flex flex-col items-center gap-1">
                                <span>{`${summary.totalYards.toFixed(1)} YD`}</span>
                                {confirmationSummary && confirmationSummary.knownConfirmations > 0 ? (
                                  <span
                                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] border ${
                                      confirmationSummary.confirmedCount === confirmationSummary.knownConfirmations
                                        ? "bg-green-100 text-green-700 border-green-200"
                                        : "bg-red-100 text-red-700 border-red-200"
                                    }`}
                                  >
                                    {confirmationSummary.confirmedCount === confirmationSummary.knownConfirmations
                                      ? "Confirmed"
                                      : "Not Confirmed"}
                                  </span>
                                ) : null}
                              </div>
                            ) : "-"}
                          </td>
                        );
                      })}
                      <td className="text-center py-3 px-4 text-sm font-black bg-stone-50 border-l border-gray-200 text-gray-900">
                        {orderCountByProject[row.jobKey] || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ConcreteOrderModal
        isOpen={Boolean(activeProject)}
        project={activeProject}
        onClose={closeProjectModal}
        onSaved={(saved) => setOrders((prev) => [...prev, saved])}
      />
    </main>
  );
}
