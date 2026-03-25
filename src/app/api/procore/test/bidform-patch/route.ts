import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest } from "@/lib/procore";
import { denyDiagnosticsInProduction } from "@/lib/diagnosticsGate.ts";

type JsonMap = Record<string, unknown>;
type QuantityUpdate = {
  id: string;
  locked_quantity?: number;
  estimated_quantity?: number;
  locked_unit_of_measure?: string;
  estimated_unit_of_measure?: string;
};

function asArray(value: unknown): JsonMap[] {
  if (Array.isArray(value)) return value as JsonMap[];
  if (value && typeof value === "object") {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data as JsonMap[];
  }
  return [];
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function parseQuantityUpdates(value: unknown): QuantityUpdate[] {
  if (!Array.isArray(value)) return [];

  const updates: QuantityUpdate[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const obj = row as JsonMap;
    const id = firstText(obj.id, obj.lineItemId, obj.bidFormItemId);
    if (!id) continue;

    const lockedQuantity = firstNumber(obj.locked_quantity, obj.lockedQuantity, obj.quantity);
    const estimatedQuantity = firstNumber(obj.estimated_quantity, obj.estimatedQuantity);
    const lockedUom = firstText(obj.locked_unit_of_measure, obj.lockedUnitOfMeasure);
    const estimatedUom = firstText(obj.estimated_unit_of_measure, obj.estimatedUnitOfMeasure);

    updates.push({
      id,
      locked_quantity: lockedQuantity ?? undefined,
      estimated_quantity: estimatedQuantity ?? undefined,
      locked_unit_of_measure: lockedUom || undefined,
      estimated_unit_of_measure: estimatedUom || undefined,
    });
  }

  return updates;
}

function mapById(updates: QuantityUpdate[]) {
  const map = new Map<string, QuantityUpdate>();
  for (const update of updates) {
    map.set(update.id, update);
  }
  return map;
}

function collectLineItemsFromSections(sections: unknown, container: Array<{ id: string; description: string; sectionTitle: string }>, sectionLabel: string) {
  if (!Array.isArray(sections)) return;

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const sectionObj = section as JsonMap;
    const sectionTitle = firstText(sectionObj.title) || sectionLabel;

    const items = Array.isArray(sectionObj.bid_form_items) ? (sectionObj.bid_form_items as JsonMap[]) : [];
    for (const item of items) {
      const id = firstText(item.id);
      if (!id) continue;
      container.push({
        id,
        description: firstText(item.description, item.subject) || "(no description)",
        sectionTitle,
      });
    }

    const subSections = Array.isArray(sectionObj.sub_sections) ? (sectionObj.sub_sections as JsonMap[]) : [];
    for (const sub of subSections) {
      if (!sub || typeof sub !== "object") continue;
      const subObj = sub as JsonMap;
      const subTitle = firstText(subObj.title) || sectionTitle;
      const subItems = Array.isArray(subObj.bid_form_items) ? (subObj.bid_form_items as JsonMap[]) : [];
      for (const subItem of subItems) {
        const id = firstText(subItem.id);
        if (!id) continue;
        container.push({
          id,
          description: firstText(subItem.description, subItem.subject) || "(no description)",
          sectionTitle: subTitle,
        });
      }
    }
  }
}

function applyUpdatesToItems(items: unknown, updatesById: Map<string, QuantityUpdate>, matched: Set<string>): JsonMap[] {
  if (!Array.isArray(items)) return [];
  return (items as JsonMap[]).map((item) => {
    const id = firstText(item.id);
    if (!id) return { ...item };

    const update = updatesById.get(id);
    if (!update) return { ...item };

    matched.add(id);
    const next = { ...item } as JsonMap;
    if (typeof update.locked_quantity === "number") next.locked_quantity = update.locked_quantity;
    if (typeof update.estimated_quantity === "number") next.estimated_quantity = update.estimated_quantity;
    if (update.locked_unit_of_measure) next.locked_unit_of_measure = update.locked_unit_of_measure;
    if (update.estimated_unit_of_measure) next.estimated_unit_of_measure = update.estimated_unit_of_measure;
    return next;
  });
}

function applyUpdatesToSections(sections: unknown, updatesById: Map<string, QuantityUpdate>, matched: Set<string>): JsonMap[] {
  if (!Array.isArray(sections)) return [];

  return (sections as JsonMap[]).map((section) => {
    const nextSection = { ...section } as JsonMap;
    nextSection.bid_form_items = applyUpdatesToItems(section.bid_form_items, updatesById, matched);

    if (Array.isArray(section.sub_sections)) {
      nextSection.sub_sections = (section.sub_sections as JsonMap[]).map((sub) => {
        const nextSub = { ...sub } as JsonMap;
        nextSub.bid_form_items = applyUpdatesToItems(sub.bid_form_items, updatesById, matched);
        return nextSub;
      });
    }

    return nextSection;
  });
}

async function tryGet(accessToken: string, endpoints: string[]): Promise<{ endpoint: string; data: unknown }> {
  const attemptedEndpoints: Array<{ endpoint: string; error: string }> = [];
  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(endpoint, accessToken, { method: "GET" }, undefined, [404]);
      return { endpoint, data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      attemptedEndpoints.push({ endpoint, error: errorMsg });
    }
  }
  const errorDetails = attemptedEndpoints.map((a) => `${a.endpoint}: ${a.error}`).join(" | ");
  throw new Error(`All GET endpoints failed: ${errorDetails}`);
}

async function tryPatch(accessToken: string, endpoints: string[], body: JsonMap): Promise<{ endpoint: string; data: unknown }> {
  const attemptedEndpoints: Array<{ endpoint: string; error: string }> = [];
  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(
        endpoint,
        accessToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        undefined,
        [404]
      );
      return { endpoint, data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      attemptedEndpoints.push({ endpoint, error: errorMsg });
    }
  }
  const errorDetails = attemptedEndpoints.map((a) => `${a.endpoint}: ${a.error}`).join(" | ");
  throw new Error(`All PATCH endpoints failed: ${errorDetails}`);
}

export async function POST(request: Request) {
  const blocked = denyDiagnosticsInProduction();
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => ({}))) as JsonMap;
    const cookieStore = await cookies();

    const accessToken = firstText(body.accessToken, cookieStore.get("procore_access_token")?.value);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Procore access token. Authenticate first or provide accessToken in request body." },
        { status: 401 }
      );
    }

    const projectId = firstText(body.projectId) || "598134326377772";
    const companyId = firstText(body.companyId, cookieStore.get("procore_company_id")?.value);
    const proposalIdRaw = Number(body.proposalId ?? 3169188);
    const proposalId = Number.isFinite(proposalIdRaw) ? proposalIdRaw : 3169188;
    const dryRun = String(body.dryRun ?? "true").toLowerCase() !== "false";
    const quantityUpdates = parseQuantityUpdates(body.quantityUpdates);

    if (!dryRun && quantityUpdates.length === 0) {
      return NextResponse.json(
        {
          error: "No quantityUpdates provided. Pass an array like [{ id: 1235, locked_quantity: 10.5 }].",
        },
        { status: 400 }
      );
    }

    let bidPackageId = firstText(body.bidPackageId);
    let bidFormId = firstText(body.bidFormId);

    if (!bidPackageId) {
      const pkg = await tryGet(accessToken, [
        `/rest/v1.0/bid_packages?project_id=${encodeURIComponent(projectId)}&page=1&per_page=50`,
      ]);
      const pkgRows = asArray(pkg.data);
      if (pkgRows.length === 0) {
        return NextResponse.json(
          {
            error: "No bid packages found for the project.",
            projectId,
            attemptedEndpoint: pkg.endpoint,
          },
          { status: 404 }
        );
      }
      bidPackageId = firstText(pkgRows[0].id);
      if (!bidPackageId) {
        return NextResponse.json({ error: "Could not resolve bidPackageId from Procore response." }, { status: 500 });
      }
    }

    if (!bidFormId) {
      const forms = await tryGet(accessToken, [
        `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?page=1&per_page=50`,
        `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?page=1&per_page=50`,
      ]);
      const formRows = asArray(forms.data);
      if (formRows.length === 0) {
        return NextResponse.json(
          {
            error: "No bid forms found for the bid package.",
            projectId,
            bidPackageId,
            attemptedEndpoint: forms.endpoint,
          },
          { status: 404 }
        );
      }
      bidFormId = firstText(formRows[0].id);
      if (!bidFormId) {
        return NextResponse.json({ error: "Could not resolve bidFormId from Procore response." }, { status: 500 });
      }
    }

    const detailWithCompany = companyId
      ? `company_id=${encodeURIComponent(companyId)}`
      : "";
    const detailCandidates = [
      `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}${detailWithCompany ? `?${detailWithCompany}` : ""}`,
      `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}`,
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}${detailWithCompany ? `?${detailWithCompany}` : ""}`,
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}`,
    ];

    const current = await tryGet(accessToken, detailCandidates);
    const currentForm = (current.data && typeof current.data === "object" ? (current.data as JsonMap) : null);
    if (!currentForm) {
      return NextResponse.json(
        {
          error: "Could not read current bid form payload before patch.",
          attemptedEndpoint: current.endpoint,
        },
        { status: 500 }
      );
    }

    const availableItems: Array<{ id: string; description: string; sectionTitle: string }> = [];
    collectLineItemsFromSections(currentForm.base_bid, availableItems, "base_bid");
    collectLineItemsFromSections(currentForm.alternates, availableItems, "alternates");

    const updatesById = mapById(quantityUpdates);
    const matched = new Set<string>();
    const nextBaseBid = applyUpdatesToSections(currentForm.base_bid, updatesById, matched);
    const nextAlternates = applyUpdatesToSections(currentForm.alternates, updatesById, matched);
    const unmatchedIds = quantityUpdates.map((u) => u.id).filter((id) => !matched.has(id));

    const patchPayload: JsonMap = {
      title: firstText(body.title, currentForm.title) || `Concrete API Test ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      proposal_id: proposalId,
      lock_unit_fields_base_bid: Boolean(currentForm.lock_unit_fields_base_bid ?? false),
      lock_quantity_fields_base_bid: Boolean(currentForm.lock_quantity_fields_base_bid ?? false),
      lock_unit_fields_alternates: Boolean(currentForm.lock_unit_fields_alternates ?? false),
      lock_quantity_fields_alternates: Boolean(currentForm.lock_quantity_fields_alternates ?? false),
      base_bid: nextBaseBid,
      alternates: nextAlternates,
    };

    const patchCandidates = [
      `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}`,
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}`,
    ];

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        projectId,
        bidPackageId,
        bidFormId,
        proposalId,
        requestedUpdateCount: quantityUpdates.length,
        matchedUpdateCount: matched.size,
        unmatchedIds,
        availableLineItemCount: availableItems.length,
        availableLineItemsSample: availableItems.slice(0, 50),
        sourceEndpoint: current.endpoint,
        patchEndpoint: patchCandidates[0],
        patchPayload,
      });
    }

    if (matched.size === 0) {
      return NextResponse.json(
        {
          error: "None of the provided line item IDs matched this bid form.",
          requestedUpdateCount: quantityUpdates.length,
          unmatchedIds,
          availableLineItemsSample: availableItems.slice(0, 50),
        },
        { status: 400 }
      );
    }

    const patched = await tryPatch(accessToken, patchCandidates, patchPayload);

    return NextResponse.json({
      success: true,
      dryRun: false,
      projectId,
      bidPackageId,
      bidFormId,
      proposalId,
      requestedUpdateCount: quantityUpdates.length,
      matchedUpdateCount: matched.size,
      unmatchedIds,
      patchedEndpoint: patched.endpoint,
      data: patched.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Bid form PATCH test failed",
        details: message,
      },
      { status: 500 }
    );
  }
}
