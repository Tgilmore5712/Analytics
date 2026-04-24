const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const jobKey = 'CH+N Site~MAPS - 25 - 001~Middletown Area Primary School';

  const entries = await prisma.activeSchedule.findMany({
    where: { jobKey },
    orderBy: [{ date: 'asc' }, { scopeOfWork: 'asc' }],
    select: {
      scopeOfWork: true,
      date: true,
      hours: true,
      source: true,
      manpower: true,
    },
  });

  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  console.log('entryCount:', entries.length);
  console.log('totalHours:', totalHours);

  const byScope = new Map();
  const byDate = new Map();

  for (const entry of entries) {
    const scopeKey = entry.scopeOfWork || '(blank)';
    byScope.set(scopeKey, (byScope.get(scopeKey) || 0) + Number(entry.hours || 0));

    const dateKey = String(entry.date || '').slice(0, 10);
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + Number(entry.hours || 0));
  }

  console.log('byScope:');
  for (const [scope, hours] of Array.from(byScope.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    console.log(`  ${scope}: ${hours}`);
  }

  console.log('datesOver210:');
  for (const [date, hours] of Array.from(byDate.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    if (hours > 210) {
      console.log(`  ${date}: ${hours}`);
    }
  }

  console.log('sampleEntries:');
  entries.slice(0, 80).forEach((entry) => console.log(entry));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
