import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function parseJobKey(jobKey) {
  const [customer = '', projectNumber = '', projectName = ''] = String(jobKey || '').split('~');
  return { customer, projectNumber, projectName };
}

function allocSummary(allocs) {
  const totalPct = allocs.reduce((sum, a) => sum + Number(a.percent || 0), 0);
  const totalHours = allocs.reduce((sum, a) => sum + Number(a.hours || 0), 0);
  const months = allocs.filter((a) => Number(a.percent || 0) > 0 || Number(a.hours || 0) > 0).length;
  return { totalPct, totalHours, months };
}

function scoreCandidate(project, schedule, parsed, alloc) {
  const projectCustomer = norm(project.customer);
  const projectName = norm(project.projectName);
  const projectId = norm(project.projectId);

  const schedCustomer = norm(schedule.customer) || norm(parsed.customer);
  const schedName = norm(schedule.projectName) || norm(parsed.projectName);
  const schedNumber = norm(schedule.projectNumber) || norm(parsed.projectNumber);

  let score = 0;

  if (schedCustomer && projectCustomer && schedCustomer === projectCustomer) score += 40;
  if (schedName && projectName && schedName === projectName) score += 40;
  if (schedNumber && projectId && schedNumber === projectId) score += 35;

  const exactNewKey = `${project.customer || ''}~${project.projectId || ''}~${project.projectName || ''}`;
  if (String(schedule.jobKey) === exactNewKey) score += 20;

  if (alloc.totalPct > 0) score += 20;
  if (alloc.totalHours > 0) score += 10;

  return score;
}

async function fetchAllBudgetProjects() {
  const base = 'http://localhost:3000/api/scheduling/projects-with-budget?bidBoardStatus=IN_PROGRESS';
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Budget API failed: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchAllSchedules() {
  const schedules = [];
  let page = 1;
  while (true) {
    const res = await fetch(`http://localhost:3000/api/scheduling?page=${page}&pageSize=500`);
    if (!res.ok) throw new Error(`Scheduling API failed on page ${page}: ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    schedules.push(...rows);
    if (!json.hasNextPage || rows.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return schedules;
}

async function main() {
  const [projectsRaw, schedulesRaw] = await Promise.all([fetchAllBudgetProjects(), fetchAllSchedules()]);

  const projects = projectsRaw
    .filter((p) => p && p.projectId && p.projectName)
    .map((p) => ({
      projectId: String(p.projectId),
      projectName: String(p.projectName),
      customer: String(p.customer || ''),
      totalQuantity: Number(p.totalQuantity || 0),
    }));

  const schedules = schedulesRaw.map((s) => {
    const parsed = parseJobKey(s.jobKey);
    const allocs = Array.isArray(s.allocations) ? s.allocations : [];
    const alloc = allocSummary(allocs);
    return {
      id: s.id,
      jobKey: String(s.jobKey || ''),
      customer: String(s.customer || ''),
      projectName: String(s.projectName || ''),
      projectNumber: String(s.projectNumber || ''),
      status: String(s.status || ''),
      totalHours: Number(s.totalHours || 0),
      parsed,
      alloc,
    };
  });

  const recommendations = [];

  for (const p of projects) {
    const projectNameNorm = norm(p.projectName);
    const customerNorm = norm(p.customer);
    const projectIdNorm = norm(p.projectId);

    const candidates = schedules
      .filter((s) => {
        const schedName = norm(s.projectName) || norm(s.parsed.projectName);
        const schedCustomer = norm(s.customer) || norm(s.parsed.customer);
        const schedNumber = norm(s.projectNumber) || norm(s.parsed.projectNumber);

        return (
          schedName === projectNameNorm ||
          (customerNorm && schedCustomer === customerNorm && schedName === projectNameNorm) ||
          (projectIdNorm && schedNumber === projectIdNorm)
        );
      })
      .map((s) => ({
        scheduleId: s.id,
        jobKey: s.jobKey,
        customer: s.customer || s.parsed.customer,
        projectName: s.projectName || s.parsed.projectName,
        projectNumber: s.projectNumber || s.parsed.projectNumber,
        status: s.status,
        totalHours: s.totalHours,
        allocTotalPct: s.alloc.totalPct,
        allocTotalHours: s.alloc.totalHours,
        allocMonths: s.alloc.months,
        score: scoreCandidate(p, s, s.parsed, s.alloc),
      }))
      .sort((a, b) => b.score - a.score || b.allocTotalPct - a.allocTotalPct || b.allocTotalHours - a.allocTotalHours)
      .slice(0, 5);

    recommendations.push({
      projectId: p.projectId,
      projectName: p.projectName,
      customer: p.customer,
      budgetHours: p.totalQuantity,
      suggestedScheduleId: candidates[0]?.scheduleId || '',
      suggestedJobKey: candidates[0]?.jobKey || '',
      candidates,
    });
  }

  const jsonPath = 'c:/Users/ToddGilmore/Analytics/scheduling-allocation-recommendations.json';
  writeFileSync(jsonPath, JSON.stringify(recommendations, null, 2), 'utf8');

  const csvHeader = [
    'projectId',
    'projectName',
    'customer',
    'budgetHours',
    'suggestedScheduleId',
    'suggestedJobKey',
    'pickScheduleId',
    'notes',
  ];

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const csvRows = recommendations.map((r) => [
    r.projectId,
    r.projectName,
    r.customer,
    r.budgetHours,
    r.suggestedScheduleId,
    r.suggestedJobKey,
    '',
    '',
  ]);

  const csvContent = [csvHeader, ...csvRows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  const csvPath = 'c:/Users/ToddGilmore/Analytics/scheduling-allocation-picks.csv';
  writeFileSync(csvPath, csvContent, 'utf8');

  console.log(JSON.stringify({
    projectsAnalyzed: recommendations.length,
    jsonPath,
    csvPath,
    sampleTopRecommendations: recommendations.slice(0, 5).map((r) => ({
      projectName: r.projectName,
      customer: r.customer,
      budgetHours: r.budgetHours,
      suggestedScheduleId: r.suggestedScheduleId,
      suggestedJobKey: r.suggestedJobKey,
      topCandidateCount: r.candidates.length,
    })),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
