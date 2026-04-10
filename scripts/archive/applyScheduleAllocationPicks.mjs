import { readFileSync, writeFileSync } from 'fs';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((v) => String(v || '').trim().length > 0))
    .map((r) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = r[idx] ?? '';
      });
      return obj;
    });
}

function parseProjectIdFromJobKey(jobKey) {
  const parts = String(jobKey || '').split('~');
  return (parts[1] || '').trim();
}

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function allocationTotals(schedule) {
  const allocations = Array.isArray(schedule?.allocations) ? schedule.allocations : [];
  const totalPct = allocations.reduce((sum, a) => sum + asNumber(a.percent, 0), 0);
  const totalHours = allocations.reduce((sum, a) => sum + asNumber(a.hours, 0), 0);
  return { totalPct, totalHours };
}

async function fetchAllSchedules() {
  const schedules = [];
  let page = 1;

  while (true) {
    const res = await fetch(`http://localhost:3000/api/scheduling?page=${page}&pageSize=500`);
    if (!res.ok) throw new Error(`Failed /api/scheduling page ${page}: ${res.status}`);
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
  const csvPath = 'c:/Users/ToddGilmore/Analytics/scheduling-allocation-picks.csv';
  const csvText = readFileSync(csvPath, 'utf8');
  const picks = parseCsv(csvText)
    .map((r) => ({
      projectId: String(r.projectId || '').trim(),
      projectName: String(r.projectName || '').trim(),
      customer: String(r.customer || '').trim(),
      budgetHours: asNumber(String(r.budgetHours || '').trim(), 0),
      suggestedScheduleId: String(r.suggestedScheduleId || '').trim(),
      suggestedJobKey: String(r.suggestedJobKey || '').trim(),
      pickScheduleId: String(r.pickScheduleId || '').trim(),
      notes: String(r.notes || '').trim(),
    }))
    .filter((r) => r.pickScheduleId.length > 0);

  if (!picks.length) {
    console.log(JSON.stringify({ success: false, message: 'No pickScheduleId values found in CSV.' }, null, 2));
    return;
  }

  const schedules = await fetchAllSchedules();
  const schedulesById = new Map(schedules.map((s) => [String(s.id), s]));

  const report = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const pick of picks) {
    report.processed += 1;

    try {
      const source = schedulesById.get(pick.pickScheduleId);
      if (!source) {
        report.skipped += 1;
        report.details.push({
          projectName: pick.projectName,
          customer: pick.customer,
          pickScheduleId: pick.pickScheduleId,
          status: 'skipped',
          reason: 'Source schedule ID not found',
        });
        continue;
      }

      let sourceToUse = source;
      const chosenTotals = allocationTotals(source);
      if (chosenTotals.totalPct <= 0 && chosenTotals.totalHours <= 0) {
        const candidates = schedules
          .filter((s) => {
            const sameName = norm(s.projectName) === norm(pick.projectName);
            const sameCustomer = norm(s.customer) === norm(pick.customer);
            if (!sameName || !sameCustomer) return false;
            const totals = allocationTotals(s);
            return totals.totalPct > 0 || totals.totalHours > 0;
          })
          .sort((a, b) => {
            const aTotals = allocationTotals(a);
            const bTotals = allocationTotals(b);
            if (bTotals.totalPct !== aTotals.totalPct) return bTotals.totalPct - aTotals.totalPct;
            return bTotals.totalHours - aTotals.totalHours;
          });

        if (candidates.length > 0) {
          sourceToUse = candidates[0];
        }
      }

      const sourceAllocations = Array.isArray(sourceToUse.allocations) ? sourceToUse.allocations : [];
      const projectIdFromKey = parseProjectIdFromJobKey(pick.suggestedJobKey);
      const targetProjectId = projectIdFromKey || parseProjectIdFromJobKey(sourceToUse.jobKey);

      if (!targetProjectId) {
        report.skipped += 1;
        report.details.push({
          projectName: pick.projectName,
          customer: pick.customer,
          pickScheduleId: pick.pickScheduleId,
          status: 'skipped',
          reason: 'Could not derive target project ID',
        });
        continue;
      }

      const targetJobKey = `${pick.customer}~${targetProjectId}~${pick.projectName}`;

      const payload = {
        jobKey: targetJobKey,
        customer: pick.customer,
        projectName: pick.projectName,
        projectNumber: targetProjectId,
        status: source.status || 'IN_PROGRESS',
        totalHours: pick.budgetHours,
        allocations: sourceAllocations.map((a) => ({
          month: String(a.month || '').trim(),
          percent: asNumber(a.percent, 0),
          hours: asNumber(a.hours, 0),
        })),
      };

      const res = await fetch('http://localhost:3000/api/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`POST /api/scheduling failed ${res.status}: ${errBody}`);
      }

      report.updated += 1;
      report.details.push({
        projectName: pick.projectName,
        customer: pick.customer,
        pickScheduleId: pick.pickScheduleId,
        sourceJobKey: sourceToUse.jobKey,
        targetJobKey,
        allocationCount: payload.allocations.length,
        sourceWasOverridden: sourceToUse.id !== source.id,
        status: 'updated',
      });
    } catch (error) {
      report.errors += 1;
      report.details.push({
        projectName: pick.projectName,
        customer: pick.customer,
        pickScheduleId: pick.pickScheduleId,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `c:/Users/ToddGilmore/Analytics/snapshots/scheduling-allocation-apply-${timestamp}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        success: true,
        processed: report.processed,
        updated: report.updated,
        skipped: report.skipped,
        errors: report.errors,
        reportPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
