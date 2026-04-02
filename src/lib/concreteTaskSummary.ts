export type ProjectScopeTaskRow = {
  jobKey: string;
  tasks: unknown;
};

export type ConcreteConfirmationTotals = {
  total: number;
  confirmed: number;
  totalYards: number;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function getTaskConcreteSnapshot(
  task: unknown
): { date: string; confirmed: boolean; yards: number } | null {
  if (!task) return null;

  if (typeof task === "string") {
    const trimmed = task.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!match) return null;

    const parts = String(match[1] || "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);

    const date = parts.find((part) => DATE_KEY_REGEX.test(part));
    if (!date) return null;

    let yardsValue: number | null = null;
    for (const part of parts) {
      if (DATE_KEY_REGEX.test(part)) continue;
      if (/\d+\s*d$/i.test(part)) continue;
      const numericMatch = part.match(/(\d+(?:\.\d+)?)/);
      if (!numericMatch) continue;
      const parsed = Number.parseFloat(numericMatch[1]);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      yardsValue = parsed;
      break;
    }

    if (!Number.isFinite(yardsValue || 0) || (yardsValue || 0) <= 0) return null;
    return { date, confirmed: false, yards: Number(yardsValue) };
  }

  if (typeof task !== "object" || Array.isArray(task)) return null;

  const row = task as Record<string, unknown>;
  const date = String(row.startDate || "").trim();
  if (!DATE_KEY_REGEX.test(date)) return null;

  const yards = Number(row.yards);
  if (!Number.isFinite(yards) || yards <= 0) return null;

  return {
    date,
    confirmed: row.concreteConfirmed === true,
    yards,
  };
}

export function buildConcreteConfirmationByJobDate(
  rows: ProjectScopeTaskRow[]
): Map<string, ConcreteConfirmationTotals> {
  const totals = new Map<string, ConcreteConfirmationTotals>();

  for (const row of rows) {
    const jobKey = String(row.jobKey || "").trim();
    if (!jobKey) continue;
    if (!Array.isArray(row.tasks)) continue;

    for (const task of row.tasks) {
      const snapshot = getTaskConcreteSnapshot(task);
      if (!snapshot) continue;

      const key = `${jobKey}__${snapshot.date}`;
      const current = totals.get(key) || { total: 0, confirmed: 0, totalYards: 0 };
      current.total += 1;
      current.totalYards += Number(snapshot.yards || 0);
      if (snapshot.confirmed) current.confirmed += 1;
      totals.set(key, current);
    }
  }

  return totals;
}
