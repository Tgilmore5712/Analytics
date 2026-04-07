import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(path) {
  const out = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = {
  ...loadEnvFile(resolve(process.cwd(), '.env')),
  ...loadEnvFile(resolve(process.cwd(), '.env.local')),
};

const clientId = env.PROCORE_CLIENT_ID;
const clientSecret = env.PROCORE_CLIENT_SECRET;
const companyId = env.PROCORE_COMPANY_ID;
const burkholderProjectId = '598134326278124';

if (!clientId || !clientSecret || !companyId) {
  console.error('Missing required Procore env vars.');
  process.exit(1);
}

const tokenRes = await fetch('https://api.procore.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }),
});

if (!tokenRes.ok) {
  console.error('Token request failed:', tokenRes.status, await tokenRes.text());
  process.exit(1);
}

const tokenBody = await tokenRes.json();
const accessToken = tokenBody.access_token;

const base = `https://api.procore.com/rest/v1.0/companies/${companyId}/project_stages`;

async function call(url) {
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
  return { status: res.status, body: json };
}

console.log('\n=== Calling without project_id ===');
const allStages = await call(`${base}?page=1&per_page=100`);
console.log('HTTP:', allStages.status);
if (Array.isArray(allStages.body)) {
  console.log('count:', allStages.body.length);
  for (const s of allStages.body.slice(0, 10)) {
    console.log(`  id=${s.id} name=${s.name} category=${s.category ?? ''}`);
  }
} else {
  console.log(JSON.stringify(allStages.body, null, 2));
}

console.log('\n=== Calling with Burkholder project_id ===');
const projectStages = await call(`${base}?page=1&per_page=100&project_id=${burkholderProjectId}`);
console.log('HTTP:', projectStages.status);
if (Array.isArray(projectStages.body)) {
  console.log('count:', projectStages.body.length);
  for (const s of projectStages.body) {
    console.log(`  id=${s.id} name=${s.name} category=${s.category ?? ''}`);
  }
} else {
  console.log(JSON.stringify(projectStages.body, null, 2));
}
