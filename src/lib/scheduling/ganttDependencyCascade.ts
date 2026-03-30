import { prisma } from "@/lib/prisma";
import { syncGanttScopeToActiveSchedule } from "@/lib/scheduling/ganttScopeSync";

type ScopeRow = {
  id: string;
  project_id: string;
  title: string;
  start_date: Date | string | null;
  end_date: Date | string | null;
  total_hours: number;
  crew_size: number | null;
  predecessor_scope_id: string | null;
};

type CascadeUpdate = {
  scopeId: string;
  oldStartDate: string | null;
  oldEndDate: string | null;
  newStartDate: string;
  newEndDate: string;
};

const MAX_SEARCH_DAYS = 1460;

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseDateInput(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBusinessDay(date: Date, paidHolidaySet: Set<string>): boolean {
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) return false;
  return !paidHolidaySet.has(formatDateOnly(date));
}

function countBusinessDaysInclusive(start: Date, end: Date, paidHolidaySet: Set<string>): number {
  if (end < start) return 0;

  let count = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (isBusinessDay(cursor, paidHolidaySet)) {
      count += 1;
    }
  }
  return count;
}

function nextBusinessDayAfter(date: Date, paidHolidaySet: Set<string>): Date {
  const cursor = new Date(date);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < MAX_SEARCH_DAYS; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor, paidHolidaySet)) {
      return new Date(cursor);
    }
  }

  throw new Error("Unable to find next business day within search limit");
}

function addBusinessDays(start: Date, daysToAdd: number, paidHolidaySet: Set<string>): Date {
  if (daysToAdd <= 0) return new Date(start);

  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  let added = 0;

  for (let i = 0; i < MAX_SEARCH_DAYS; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
    if (!isBusinessDay(cursor, paidHolidaySet)) {
      continue;
    }

    added += 1;
    if (added >= daysToAdd) {
      return new Date(cursor);
    }
  }

  throw new Error("Unable to add business days within search limit");
}

async function loadPaidHolidaySet(): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({
    where: { isPaid: true },
    select: { date: true },
  });

  return new Set(rows.map((row) => String(row.date).slice(0, 10)));
}

export async function cascadeDependentScopesFromLead(params: {
  projectId: string;
  leadScopeId: string;
  maxDepth?: number;
}): Promise<CascadeUpdate[]> {
  const { projectId, leadScopeId, maxDepth = 64 } = params;

  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `
      SELECT
        id,
        project_id,
        title,
        start_date,
        end_date,
        total_hours,
        crew_size,
        predecessor_scope_id
      FROM gantt_v2_scopes
      WHERE project_id = $1
      ORDER BY created_at ASC
    `,
    projectId
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const successorsByPredecessor = new Map<string, ScopeRow[]>();

  for (const row of rows) {
    const predecessorId = row.predecessor_scope_id || null;
    if (!predecessorId) continue;
    const bucket = successorsByPredecessor.get(predecessorId) || [];
    bucket.push(row);
    successorsByPredecessor.set(predecessorId, bucket);
  }

  const paidHolidaySet = await loadPaidHolidaySet();
  const visited = new Set<string>([leadScopeId]);
  const queue: Array<{ scopeId: string; depth: number }> = [{ scopeId: leadScopeId, depth: 0 }];
  const updates: CascadeUpdate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    if (current.depth > maxDepth) {
      throw new Error("Dependency chain exceeded max depth; possible circular dependency");
    }

    const predecessor = byId.get(current.scopeId);
    if (!predecessor) continue;

    const predecessorEnd = parseDateInput(predecessor.end_date);
    if (!predecessorEnd) continue;

    const directSuccessors = successorsByPredecessor.get(predecessor.id) || [];

    for (const successor of directSuccessors) {
      if (visited.has(successor.id)) {
        throw new Error(`Circular dependency detected near scope ${successor.id}`);
      }
      visited.add(successor.id);

      const oldStart = parseDateInput(successor.start_date);
      const oldEnd = parseDateInput(successor.end_date);
      const oldStartDate = oldStart ? formatDateOnly(oldStart) : null;
      const oldEndDate = oldEnd ? formatDateOnly(oldEnd) : null;

      const baselineStart = oldStart || nextBusinessDayAfter(predecessorEnd, paidHolidaySet);
      const baselineEnd = oldEnd || baselineStart;
      const durationBusinessDays = Math.max(
        1,
        countBusinessDaysInclusive(baselineStart, baselineEnd, paidHolidaySet)
      );

      const newStart = nextBusinessDayAfter(predecessorEnd, paidHolidaySet);
      const newEnd = addBusinessDays(newStart, durationBusinessDays - 1, paidHolidaySet);
      const newStartDate = formatDateOnly(newStart);
      const newEndDate = formatDateOnly(newEnd);

      if (oldStartDate !== newStartDate || oldEndDate !== newEndDate) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_scopes
            SET start_date = CAST($2 AS date),
                end_date = CAST($3 AS date),
                updated_at = NOW()
            WHERE id = $1
          `,
          successor.id,
          newStartDate,
          newEndDate
        );

        successor.start_date = parseDateOnly(newStartDate);
        successor.end_date = parseDateOnly(newEndDate);

        await syncGanttScopeToActiveSchedule({
          scopeId: successor.id,
          projectId: successor.project_id,
          title: successor.title,
          startDate: newStartDate,
          endDate: newEndDate,
          totalHours: Number(successor.total_hours || 0),
          crewSize: successor.crew_size === null ? null : Number(successor.crew_size),
        });

        updates.push({
          scopeId: successor.id,
          oldStartDate,
          oldEndDate,
          newStartDate,
          newEndDate,
        });
      }

      queue.push({ scopeId: successor.id, depth: current.depth + 1 });
    }
  }

  return updates;
}
