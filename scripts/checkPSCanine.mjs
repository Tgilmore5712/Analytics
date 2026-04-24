import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.$queryRawUnsafe(`SELECT id, "jobKey", title, hours, manpower, "schedulingMode", "startDate", "endDate" FROM "ProjectScope" WHERE "jobKey" LIKE '%2508%' OR "jobKey" LIKE '%canine%' ORDER BY title, id`);
rows.forEach(r => console.log(JSON.stringify(r)));
await p.$disconnect();
