"use client";

import { useMemo, useState } from "react";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function Auth0TestPage() {
  const [authResult, setAuthResult] = useState<string>("");
  const [procoreConfigResult, setProcoreConfigResult] = useState<string>("");
  const [procoreMeResult, setProcoreMeResult] = useState<string>("");
  const [bidPatchResult, setBidPatchResult] = useState<string>("");
  const [loadingKey, setLoadingKey] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>("/rest/v1.0/me");
  const [accessToken, setAccessToken] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("598134326241241");
  const [proposalId, setProposalId] = useState<string>("2989879");
  const [bidPackageId, setBidPackageId] = useState<string>("");
  const [bidFormId, setBidFormId] = useState<string>("");
  const [patchTitle, setPatchTitle] = useState<string>("Concrete API Test");

  const loginHref = useMemo(() => "/api/auth/login?returnTo=/auth0-test", []);
  const logoutHref = useMemo(() => "/api/auth/logout?returnTo=/auth0-test", []);

  async function runRequest(key: string, fn: () => Promise<void>) {
    setLoadingKey(key);
    try {
      await fn();
    } finally {
      setLoadingKey("");
    }
  }

  async function testAuth0Session() {
    await runRequest("auth", async () => {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      setAuthResult(pretty({ status: res.status, ok: res.ok, body }));
    });
  }

  async function testProcoreConfig() {
    await runRequest("config", async () => {
      const res = await fetch("/api/procore/test", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      setProcoreConfigResult(pretty({ status: res.status, ok: res.ok, body }));
    });
  }

  async function testProcoreEndpoint() {
    await runRequest("me", async () => {
      const payload: { endpoint: string; accessToken?: string } = { endpoint: endpoint.trim() || "/rest/v1.0/me" };
      if (accessToken.trim()) payload.accessToken = accessToken.trim();

      const res = await fetch("/api/procore/test", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload as JsonValue),
      });

      const body = await res.json().catch(() => ({}));
      setProcoreMeResult(pretty({ status: res.status, ok: res.ok, payload, body }));
    });
  }

  async function testBidFormPatch(dryRun: boolean) {
    await runRequest(dryRun ? "patch-dry" : "patch-live", async () => {
      const payload: {
        projectId: string;
        proposalId: number;
        bidPackageId?: string;
        bidFormId?: string;
        title?: string;
        accessToken?: string;
        dryRun: boolean;
      } = {
        projectId: projectId.trim() || "598134326241241",
        proposalId: Number(proposalId || "2989879"),
        dryRun,
      };

      if (bidPackageId.trim()) payload.bidPackageId = bidPackageId.trim();
      if (bidFormId.trim()) payload.bidFormId = bidFormId.trim();
      if (patchTitle.trim()) payload.title = patchTitle.trim();
      if (accessToken.trim()) payload.accessToken = accessToken.trim();

      const res = await fetch("/api/procore/test/bidform-patch", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      setBidPatchResult(pretty({ status: res.status, ok: res.ok, payload, body }));
    });
  }

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <h1 className="text-2xl md:text-3xl font-bold">Auth0 + Procore Test</h1>
          <p className="mt-2 text-slate-300">
            Quick page to log in via Auth0 and verify Procore token/calls for this app.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={loginHref}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500"
            >
              Login (Auth0)
            </a>
            <a
              href={logoutHref}
              className="inline-flex items-center rounded-md bg-slate-600 px-4 py-2 font-semibold hover:bg-slate-500"
            >
              Logout
            </a>
            <button
              type="button"
              onClick={testAuth0Session}
              disabled={loadingKey === "auth"}
              className="rounded-md border border-slate-500 px-4 py-2 font-semibold hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingKey === "auth" ? "Checking..." : "Test /api/auth/me"}
            </button>
          </div>
        </header>

        <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-xl font-semibold">Procore Checks</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={testProcoreConfig}
              disabled={loadingKey === "config"}
              className="rounded-md border border-slate-500 px-4 py-2 font-semibold hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingKey === "config" ? "Checking..." : "Test /api/procore/test (GET)"}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Endpoint</span>
              <input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="/rest/v1.0/me"
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Access Token (optional)</span>
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Uses procore_access_token cookie if empty"
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={testProcoreEndpoint}
              disabled={loadingKey === "me"}
              className="rounded-md bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              {loadingKey === "me" ? "Calling..." : "Test /api/procore/test (POST)"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-xl font-semibold">Bid Form PATCH Test</h2>
          <p className="mt-2 text-sm text-slate-300">
            Uses cookie token by default. Leave Bid Package ID and Bid Form ID blank to auto-discover the first ones.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Project ID</span>
              <input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Proposal ID</span>
              <input
                value={proposalId}
                onChange={(e) => setProposalId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Bid Package ID (optional)</span>
              <input
                value={bidPackageId}
                onChange={(e) => setBidPackageId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-300">Bid Form ID (optional)</span>
              <input
                value={bidFormId}
                onChange={(e) => setBidFormId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-slate-300">Patch Title (optional)</span>
              <input
                value={patchTitle}
                onChange={(e) => setPatchTitle(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => testBidFormPatch(true)}
              disabled={loadingKey === "patch-dry" || loadingKey === "patch-live"}
              className="rounded-md border border-amber-500 px-4 py-2 font-semibold text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
            >
              {loadingKey === "patch-dry" ? "Running Dry Run..." : "Dry Run Bid Form PATCH"}
            </button>

            <button
              type="button"
              onClick={() => testBidFormPatch(false)}
              disabled={loadingKey === "patch-dry" || loadingKey === "patch-live"}
              className="rounded-md bg-rose-600 px-4 py-2 font-semibold hover:bg-rose-500 disabled:opacity-50"
            >
              {loadingKey === "patch-live" ? "Patching..." : "Run Live Bid Form PATCH"}
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h3 className="font-semibold">Auth0 Result</h3>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-slate-300">{authResult || "No result yet."}</pre>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h3 className="font-semibold">Procore Config Result</h3>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-slate-300">{procoreConfigResult || "No result yet."}</pre>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h3 className="font-semibold">Procore Endpoint Result</h3>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-slate-300">{procoreMeResult || "No result yet."}</pre>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h3 className="font-semibold">Bid Form PATCH Result</h3>
            <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-slate-300">{bidPatchResult || "No result yet."}</pre>
          </div>
        </section>
      </div>
    </main>
  );
}
