import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv(filePath) {
  const out = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = {
  ...loadEnv(resolve(process.cwd(), '.env')),
  ...loadEnv(resolve(process.cwd(), '.env.local')),
};

const clientId = env.PROCORE_CLIENT_ID;
const clientSecret = env.PROCORE_CLIENT_SECRET;
const companyId = env.PROCORE_COMPANY_ID;

if (!clientId || !clientSecret || !companyId) {
  console.error('Missing PROCORE_CLIENT_ID / PROCORE_CLIENT_SECRET / PROCORE_COMPANY_ID in env');
  process.exit(1);
}

const ids = process.argv.slice(2);
const targetIds = ids.length > 0 ? ids : ['598134326375662', '598134326375719', '598134326376806'];

async function getToken() {
  const res = await fetch('https://api.procore.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${text}`);
  }

  return JSON.parse(text).access_token;
}

async function checkProject(id, accessToken) {
  const url = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(id)}?company_id=${encodeURIComponent(companyId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Procore-Company-Id': String(companyId),
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return {
    id,
    httpStatus: res.status,
    ok: res.ok,
    body: json,
  };
}

const token = await getToken();
console.log('Token acquired:', token ? 'yes' : 'no');

for (const id of targetIds) {
  const result = await checkProject(id, token);
  console.log(`\n=== Project ID ${id} ===`);
  console.log('HTTP:', result.httpStatus);

  if (result.ok && result.body && typeof result.body === 'object') {
    console.log('name:', result.body.name || result.body.display_name || '(no name)');
    console.log('project_number:', result.body.project_number || '(none)');
    console.log('stage:', result.body.stage || result.body.project_stage?.name || '(none)');
    console.log('updated_at:', result.body.updated_at || '(none)');
  } else {
    console.log(JSON.stringify(result.body, null, 2));
  }
}
