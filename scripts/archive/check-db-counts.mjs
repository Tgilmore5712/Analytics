import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r1 = await p.$queryRawUnsafe("SELECT COUNT(*)::int AS cnt FROM procore_projects_v1_live");
const r2 = await p.$queryRawUnsafe("SELECT COUNT(DISTINCT COALESCE(NULLIF(BTRIM(project_id),''), NULLIF(BTRIM(project_procore_id),'')))::int AS cnt FROM procore_prime_contracts_live");
const r3 = await p.$queryRawUnsafe(`SELECT COUNT(DISTINCT "procoreId")::int AS cnt FROM "Project" WHERE "procoreId" IS NOT NULL AND "procoreId" != ''`);
const r4 = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS cnt FROM "Project"`);
const r5 = await p.$queryRawUnsafe(`SELECT COUNT(DISTINCT procore_project_id)::int AS cnt FROM procore_project_staging WHERE procore_project_id IS NOT NULL`).catch(() => [{cnt:'N/A'}]);
// All distinct procore IDs across all tables
const r6 = await p.$queryRawUnsafe(`
  SELECT COUNT(DISTINCT pid)::int AS cnt FROM (
    SELECT procore_project_id AS pid FROM procore_projects_v1_live WHERE procore_project_id IS NOT NULL
    UNION
    SELECT COALESCE(NULLIF(BTRIM(project_id),''), NULLIF(BTRIM(project_procore_id),'')) AS pid FROM procore_prime_contracts_live WHERE COALESCE(NULLIF(BTRIM(project_id),''), NULLIF(BTRIM(project_procore_id),'')) IS NOT NULL
    UNION
    SELECT "procoreId" AS pid FROM "Project" WHERE "procoreId" IS NOT NULL AND "procoreId" != ''
  ) sub
`);
console.log('procore_projects_v1_live rows:', r1[0].cnt);
console.log('prime_contracts distinct project IDs:', r2[0].cnt);
console.log('Project model total rows:', r4[0].cnt);
console.log('Project rows with distinct procoreId:', r3[0].cnt);
console.log('procore_project_staging distinct procore IDs:', r5[0].cnt);
console.log('ALL DISTINCT Procore IDs (union of all tables):', r6[0].cnt);
process.exit(0);
