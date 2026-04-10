#!/usr/bin/env node

/**
 * Quick Procore Bid Form PATCH tester.
 *
 * Defaults to DRY_RUN=true so it only discovers IDs and prints the target URL/body.
 * Set DRY_RUN=false to execute the PATCH.
 */

const PROJECT_ID = process.env.PROCORE_PROJECT_ID || '598134326241241';
const API_BASE = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');
const ACCESS_TOKEN = process.env.PROCORE_ACCESS_TOKEN || '';
const COMPANY_ID = process.env.PROCORE_COMPANY_ID || '';

const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const BID_PACKAGE_ID = process.env.BID_PACKAGE_ID || '';
const BID_FORM_ID = process.env.BID_FORM_ID || '';
const PROPOSAL_ID = Number(process.env.PROPOSAL_ID || '2989879');

function assertEnv() {
  if (!ACCESS_TOKEN) {
    throw new Error('Missing PROCORE_ACCESS_TOKEN env var.');
  }
}

function headers() {
  const base = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (COMPANY_ID) {
    base['Procore-Company-Id'] = COMPANY_ID;
  }

  return base;
}

async function apiGet(url) {
  const response = await fetch(url, { method: 'GET', headers: headers() });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!response.ok) {
    throw new Error(`GET ${url} failed (${response.status}): ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }

  return json;
}

async function discoverBidPackageId(projectId) {
  if (BID_PACKAGE_ID) return BID_PACKAGE_ID;

  const url = `${API_BASE}/rest/v1.0/bid_packages?project_id=${encodeURIComponent(projectId)}&page=1&per_page=25`;
  const data = await apiGet(url);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  if (!rows.length) {
    throw new Error(`No bid packages found for project ${projectId}`);
  }

  const first = rows[0];
  const id = String(first?.id || '').trim();
  if (!id) {
    throw new Error('Could not determine bid_package_id from API response');
  }

  console.log(`Using bid_package_id=${id} (${first?.name || first?.title || 'untitled'})`);
  return id;
}

async function discoverBidFormId(projectId, bidPackageId) {
  if (BID_FORM_ID) return BID_FORM_ID;

  const url = `${API_BASE}/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?page=1&per_page=25`;
  const data = await apiGet(url);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  if (!rows.length) {
    throw new Error(`No bid forms found for project ${projectId}, bid package ${bidPackageId}`);
  }

  const first = rows[0];
  const id = String(first?.id || '').trim();
  if (!id) {
    throw new Error('Could not determine bid_form_id from API response');
  }

  console.log(`Using bid_form_id=${id} (${first?.name || first?.title || 'untitled'})`);
  return id;
}

function buildPatchBody() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Keep payload minimal for safer test updates.
  return {
    title: `Concrete API Test ${now}`,
    proposal_id: Number.isFinite(PROPOSAL_ID) ? PROPOSAL_ID : 2989879,
    lock_unit_fields_base_bid: false,
    lock_quantity_fields_base_bid: false,
    lock_unit_fields_alternates: false,
    lock_quantity_fields_alternates: false,
  };
}

async function patchBidForm(projectId, bidPackageId, bidFormId, body) {
  const url = `${API_BASE}/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}`;

  if (DRY_RUN) {
    console.log('DRY_RUN=true, PATCH not sent.');
    console.log('Target URL:', url);
    console.log('Body:', JSON.stringify(body, null, 2));
    return;
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!response.ok) {
    throw new Error(`PATCH failed (${response.status}): ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }

  console.log('PATCH succeeded. Response:');
  console.log(JSON.stringify(json, null, 2));
}

async function main() {
  assertEnv();

  console.log(`Project ID: ${PROJECT_ID}`);
  const bidPackageId = await discoverBidPackageId(PROJECT_ID);
  const bidFormId = await discoverBidFormId(PROJECT_ID, bidPackageId);

  const body = buildPatchBody();
  await patchBidForm(PROJECT_ID, bidPackageId, bidFormId, body);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
