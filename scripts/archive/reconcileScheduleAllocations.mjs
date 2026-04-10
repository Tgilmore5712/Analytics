/**
 * Reconciliation punch list: compares budget projects (IN_PROGRESS) against
 * their best-matching Schedule records and reports gaps.
 *
 * Output columns:
 *   projectName | customer | budgetHours | scheduledHours | allocPct | allocationMonths | bestMatchKey | issue
 */

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function parseJobKey(jk) {
  const [customer = '', projectNumber = '', ...rest] = String(jk || '').split('~');
  return { customer, projectNumber, projectName: rest.join('~') };
}

function allocScore(schedule) {
  const allocs = Array.isArray(schedule.allocations) ? schedule.allocations : [];
  return allocs.reduce((s, a) => s + Number(a.percent || 0), 0);
}

function allocSummary(schedule) {
  const allocs = Array.isArray(schedule.allocations) ? schedule.allocations : [];
  const totalPct = allocs.reduce((s, a) => s + Number(a.percent || 0), 0);
  const totalHours = allocs.reduce((s, a) => s + Number(a.hours || 0), 0);
  const months = allocs.filter((a) => Number(a.percent || 0) > 0).length;
  return { totalPct, totalHours, months };
}

function pickBest(candidates) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => allocScore(b) - allocScore(a))[0];
}

async function fetchBudgetProjects() {
  const res = await fetch('http://localhost:3000/api/scheduling/projects-with-budget?bidBoardStatus=IN_PROGRESS');
  if (!res.ok) throw new Error(`Budget API: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchAllSchedules() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(`http://localhost:3000/api/scheduling?page=${page}&pageSize=500`);
    if (!res.ok) throw new Error(`Scheduling API page ${page}: ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    if (!json.hasNextPage || rows.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return all;
}

async function main() {
  console.log('Fetching data...');
  const [budgetRaw, schedules] = await Promise.all([fetchBudgetProjects(), fetchAllSchedules()]);

  const projects = budgetRaw
    .filter((p) => p && p.projectId && p.projectName)
    .map((p) => ({
      projectId: String(p.projectId),
      projectName: String(p.projectName),
      customer: String(p.customer || ''),
      budgetHours: Number(p.totalQuantity || 0),
    }));

  console.log(`Budget projects: ${projects.length}, Schedule records: ${schedules.length}`);

  // Build lookup maps
  const byExactKey = new Map();
  const byProjectNumberName = new Map();
  const byCustomerName = new Map();
  const byNameOnly = new Map();

  for (const s of schedules) {
    const parsed = parseJobKey(s.jobKey);
    const key = norm(s.jobKey);
    if (!byExactKey.has(key)) byExactKey.set(key, []);
    byExactKey.get(key).push(s);

    const numNameKey = norm(parsed.projectNumber) + '~' + norm(parsed.projectName);
    if (!byProjectNumberName.has(numNameKey)) byProjectNumberName.set(numNameKey, []);
    byProjectNumberName.get(numNameKey).push(s);

    const custNameKey = norm(parsed.customer) + '~' + norm(parsed.projectName);
    if (!byCustomerName.has(custNameKey)) byCustomerName.set(custNameKey, []);
    byCustomerName.get(custNameKey).push(s);

    const nameKey = norm(parsed.projectName);
    if (!byNameOnly.has(nameKey)) byNameOnly.set(nameKey, []);
    byNameOnly.get(nameKey).push(s);
  }

  const rows = [];

  for (const p of projects) {
    const exactKey = norm(`${p.customer}~${p.projectId}~${p.projectName}`);

    // Try match tiers
    let candidates =
      byExactKey.get(exactKey) ||
      byProjectNumberName.get(norm(p.projectId) + '~' + norm(p.projectName)) ||
      (p.customer
        ? byCustomerName.get(norm(p.customer) + '~' + norm(p.projectName))
        : null) ||
      byNameOnly.get(norm(p.projectName)) ||
      null;

    const best = candidates ? pickBest(candidates) : null;
    const summary = best ? allocSummary(best) : { totalPct: 0, totalHours: 0, months: 0 };

    const issues = [];
    if (!best) issues.push('NO_SCHEDULE_MATCH');
    else if (summary.totalPct === 0) issues.push('ZERO_ALLOC_PCT');
    if (p.budgetHours === 0) issues.push('NO_BUDGET_HOURS');

    const scheduledHours = best ? Number(best.totalHours || 0) : 0;
    const hoursDiff = Math.abs(p.budgetHours - scheduledHours);
    if (best && hoursDiff > 1) issues.push(`HOURS_MISMATCH(budget=${p.budgetHours.toFixed(0)},sched=${scheduledHours.toFixed(0)})`);

    rows.push({
      projectName: p.projectName,
      customer: p.customer || '(none)',
      budgetHours: p.budgetHours,
      scheduledHours,
      allocPct: summary.totalPct,
      allocationMonths: summary.months,
      bestMatchKey: best ? best.jobKey : '(none)',
      issues: issues.join('; ') || 'OK',
    });
  }

  // Sort: issues first, then by project name
  rows.sort((a, b) => {
    const aOk = a.issues === 'OK';
    const bOk = b.issues === 'OK';
    if (aOk !== bOk) return aOk ? 1 : -1;
    return a.projectName.localeCompare(b.projectName);
  });

  // Print table
  const problemRows = rows.filter((r) => r.issues !== 'OK');
  const okRows = rows.filter((r) => r.issues === 'OK');

  console.log(`\n========== PUNCH LIST: ${problemRows.length} issues, ${okRows.length} OK ==========\n`);

  console.log('PROJECT NAME                              | CUSTOMER                         | BUDGET HRS | SCHED HRS | ALLOC % | MONTHS | ISSUES');
  console.log('------------------------------------------+----------------------------------+------------+-----------+---------+--------+--------------------------------------------------');

  for (const r of rows) {
    const pn = r.projectName.padEnd(40).slice(0, 40);
    const cu = r.customer.padEnd(32).slice(0, 32);
    const bh = String(r.budgetHours.toFixed(0)).padStart(10);
    const sh = String(r.scheduledHours.toFixed(0)).padStart(9);
    const ap = String(r.allocPct.toFixed(0)).padStart(7) + '%';
    const mo = String(r.allocationMonths).padStart(6);
    const flag = r.issues === 'OK' ? ' OK' : ' *** ' + r.issues;
    console.log(`${pn} | ${cu} | ${bh} | ${sh} | ${ap} | ${mo} | ${flag}`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total IN_PROGRESS budget projects: ${rows.length}`);
  console.log(`  Clean (OK):              ${okRows.length}`);
  console.log(`  Zero allocation %:       ${problemRows.filter((r) => r.issues.includes('ZERO_ALLOC_PCT')).length}`);
  console.log(`  No schedule match:       ${problemRows.filter((r) => r.issues.includes('NO_SCHEDULE_MATCH')).length}`);
  console.log(`  Hours mismatch:          ${problemRows.filter((r) => r.issues.includes('HOURS_MISMATCH')).length}`);

  // Recommended fixes
  const zeroAlloc = problemRows.filter((r) => r.issues.includes('ZERO_ALLOC_PCT'));
  if (zeroAlloc.length > 0) {
    console.log('\n=== JOBS NEEDING ALLOCATION DATA ===');
    console.log('(These have budget hours but schedule shows 0% allocated by month)\n');
    for (const r of zeroAlloc) {
      console.log(`  ${r.projectName} (${r.customer})`);
      console.log(`    Budget hours: ${r.budgetHours.toFixed(0)} | Scheduled hours: ${r.scheduledHours.toFixed(0)}`);
      console.log(`    Best match key: ${r.bestMatchKey}`);
      console.log(`    FIX: Open scheduling page, find this project, set monthly allocations`);
      console.log('');
    }
  }

  const noMatch = problemRows.filter((r) => r.issues.includes('NO_SCHEDULE_MATCH'));
  if (noMatch.length > 0) {
    console.log('\n=== JOBS WITH NO SCHEDULE ENTRY ===');
    for (const r of noMatch) {
      console.log(`  ${r.projectName} (${r.customer}) — budget hrs: ${r.budgetHours.toFixed(0)}`);
    }
  }
}

main().catch(console.error);
