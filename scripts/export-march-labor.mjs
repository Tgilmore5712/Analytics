import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();

const start = new Date("2026-03-01T00:00:00.000Z");
const end   = new Date("2026-03-31T23:59:59.999Z");

const rows = await prisma.timecardEntry.groupBy({
  by: ["jobKey", "date", "partyName", "costCodeFullCode", "costCodeName"],
  where: { date: { gte: start, lte: end } },
  _sum: { hours: true },
  orderBy: [
    { jobKey: "asc" },
    { date: "asc" },
    { partyName: "asc" },
    { costCodeFullCode: "asc" },
  ],
});

const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const lines = ["Project,Date,Name,Cost Code,Cost Name,Hours"];
for (const r of rows) {
  lines.push(
    [
      esc(r.jobKey),
      esc(r.date.toISOString().split("T")[0]),
      esc(r.partyName ?? ""),
      esc(r.costCodeFullCode ?? ""),
      esc(r.costCodeName ?? ""),
      r._sum.hours ?? 0,
    ].join(",")
  );
}

writeFileSync("march-2026-labor.csv", lines.join("\r\n"), "utf8");
console.log(`Rows written: ${rows.length}`);
await prisma.$disconnect();
