"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

type PersistedLineItem = {
  id: number;
  companyId: string;
  bidBoardProjectId: string;
  proposalId: string;
  lineItemId: string;
  projectName: string | null;
  customerName: string | null;
  proposalName: string | null;
  name: string | null;
  status: string | null;
  costCode: string | null;
  payload: unknown;
  syncedAt: string;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  note?: string;
  data?: PersistedLineItem[];
  total?: number;
  count?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
};

export default function ProposalLineItemsLivePage() {
  const [rows, setRows] = useState<PersistedLineItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("598134325658789");
  const [bidBoardProjectId, setBidBoardProjectId] = useState<string>("");
  const [proposalId, setProposalId] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(200);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    setNote("");

    try {
      const url = new URL("/api/procore/estimating/proposal-line-items-live", window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (companyId.trim()) url.searchParams.set("companyId", companyId.trim());
      if (bidBoardProjectId.trim()) url.searchParams.set("bidBoardProjectId", bidBoardProjectId.trim());
      if (proposalId.trim()) url.searchParams.set("proposalId", proposalId.trim());
      if (search.trim()) url.searchParams.set("search", search.trim());
      url.searchParams.set("_ts", String(Date.now()));

      const res = await fetch(url.toString(), { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `Request failed with ${res.status}`);
      }

      setRows(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total || 0));
      setTotalPages(Math.max(1, Number(payload.totalPages || 1)));
      setNote(payload.note || "");
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, companyId, bidBoardProjectId, proposalId, search]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const titleStats = useMemo(() => {
    return `${rows.length} rows on page, ${total} total`;
  }, [rows.length, total]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation />

      <div className="mx-auto max-w-[1600px] px-4 py-8 space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-gray-800">
                Persisted Proposal Line Items
              </h1>
              <p className="text-xs font-semibold text-gray-500 mt-1">{titleStats}</p>
              {!!lastRefreshedAt && (
                <p className="text-[11px] font-semibold text-gray-500 mt-1">Last refreshed: {lastRefreshedAt}</p>
              )}
            </div>

            <button
              onClick={() => void loadRows()}
              className="px-4 py-2 rounded-lg bg-indigo-700 text-white font-black text-xs uppercase tracking-wider hover:bg-indigo-800"
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mt-4">
            <input
              value={companyId}
              onChange={(e) => {
                setPage(1);
                setCompanyId(e.target.value);
              }}
              placeholder="Company ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={bidBoardProjectId}
              onChange={(e) => {
                setPage(1);
                setBidBoardProjectId(e.target.value);
              }}
              placeholder="Bid Board Project ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={proposalId}
              onChange={(e) => {
                setPage(1);
                setProposalId(e.target.value);
              }}
              placeholder="Proposal ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search line item"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              onClick={() => {
                setPage(1);
                setBidBoardProjectId("");
                setProposalId("");
                setSearch("");
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>

          {!!note && <p className="text-xs font-semibold text-amber-700 mt-3">{note}</p>}
          {!!error && <p className="text-xs font-semibold text-red-700 mt-3">{error}</p>}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">Synced</th>
                <th className="py-2 pr-3">Bid Board Project</th>
                <th className="py-2 pr-3">Project Name</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Proposal</th>
                <th className="py-2 pr-3">Proposal Name</th>
                <th className="py-2 pr-3">Line Item ID</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Cost Code</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={10}>
                    No rows found.
                  </td>
                </tr>
              )}

              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 text-gray-800 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.syncedAt).toLocaleString()}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardProjectId}</td>
                  <td className="py-2 pr-3">{row.projectName || "-"}</td>
                  <td className="py-2 pr-3">{row.customerName || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.proposalId}</td>
                  <td className="py-2 pr-3">{row.proposalName || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.lineItemId}</td>
                  <td className="py-2 pr-3">{row.name || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.status || "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.costCode || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between">
          <button
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 rounded-lg border border-gray-300 text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            Previous
          </button>

          <p className="text-xs font-semibold text-gray-600">
            Page {page} of {totalPages}
          </p>

          <button
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-2 rounded-lg border border-gray-300 text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            Next
          </button>
        </section>
      </div>
    </div>
  );
}
