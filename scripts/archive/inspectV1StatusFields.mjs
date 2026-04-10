import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(
  `SELECT name, status, status_raw, 
          payload->>'project_stage' as p_stage,
          payload->>'project_status' as p_proj_status,
          payload->'project_stage'->>'name' as stage_name,
          payload->'project_status'->>'name' as proj_status_name
   FROM procore_projects_v1_live 
   ORDER BY name 
   LIMIT 12`
);

console.log('\n--- V1 Live Status Fields ---');
for (const r of rows) {
  console.log(`${String(r.name).padEnd(45)} | status=${String(r.status||'').padEnd(20)} | raw=${String(r.status_raw||'').padEnd(20)} | stage=${r.p_stage||''} | proj_status=${r.p_proj_status||''}`);
}

// Also show a full raw payload sample for one row to see all keys
const sample = await prisma.$queryRawUnsafe(
  `SELECT name, payload FROM procore_projects_v1_live LIMIT 1`
);
if (sample.length > 0) {
  console.log('\n--- Full payload keys for:', sample[0].name, '---');
  const keys = Object.keys(sample[0].payload || {});
  console.log(keys.join(', '));
  
  // Print status-related fields specifically
  const p = sample[0].payload;
  console.log('\n--- Status-related values ---');
  for (const key of keys.filter(k => k.toLowerCase().includes('stat') || k.toLowerCase().includes('stage') || k.toLowerCase().includes('phase'))) {
    console.log(`  ${key}: ${JSON.stringify(p[key])}`);
  }
}

await prisma.$disconnect();
