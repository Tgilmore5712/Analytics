import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local');
const envLines = readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const CLIENT_ID = env.PROCORE_CLIENT_ID;
const CLIENT_SECRET = env.PROCORE_CLIENT_SECRET;
const COMPANY_ID = env.PROCORE_COMPANY_ID;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing PROCORE_CLIENT_ID or PROCORE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

// 1. Get access token via client_credentials
console.log('Getting access token...');
const tokenRes = await fetch('https://api.procore.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }),
});

if (!tokenRes.ok) {
  const text = await tokenRes.text();
  console.error('Token request failed:', tokenRes.status, text);
  process.exit(1);
}

const tokenData = await tokenRes.json();
const accessToken = tokenData.access_token;
console.log('Got token:', accessToken ? 'YES' : 'NO');

// 2. Get all custom field definitions for the company
console.log(`\nFetching custom field definitions for company ${COMPANY_ID}...`);
const defsRes = await fetch(
  `https://api.procore.com/rest/v1.0/custom_field_definitions?company_id=${COMPANY_ID}&filters[subject_type]=Project`,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Procore-Company-Id': COMPANY_ID,
    },
  }
);

if (!defsRes.ok) {
  const text = await defsRes.text();
  console.error('Custom field defs request failed:', defsRes.status, text);
  process.exit(1);
}

const defs = await defsRes.json();
console.log(`\nFound ${Array.isArray(defs) ? defs.length : '?'} custom field definitions:\n`);

if (Array.isArray(defs)) {
  for (const d of defs) {
    console.log(`  id: ${d.id}`);
    console.log(`  label: ${d.label}`);
    console.log(`  data_type: ${d.data_type}`);
    console.log(`  field_name: custom_field_${d.id}`);
    console.log('');
  }
} else {
  console.log(JSON.stringify(defs, null, 2));
}
