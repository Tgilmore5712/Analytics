const ROLLUP_CANONICAL_CODES = new Set([
  "03-300-00-10",
  "03-300-10-10",
  "03-300-20-10",
  "03-300-30-10",
]);

const COST_CODE_TO_CANONICAL: Record<string, string> = {
  "03-300-00-10": "03-300-00-10",
  "03-100-10-10": "03-300-00-10",
  "03-200-10-10": "03-300-00-10",
  "03-300-00-12": "03-300-00-10",
  "03-300-00-16": "03-300-00-10",
  "03-300-00-14": "03-300-00-10",
  "31-100-10-20": "03-300-00-10",

  "03-300-10-10": "03-300-10-10",
  "03-100-20-10": "03-300-10-10",
  "03-200-20-10": "03-300-10-10",

  "03-300-20-10": "03-300-20-10",
  "03-200-30-10": "03-300-20-10",
  "03-300-40-70": "03-300-20-10",

  "03-300-30-10": "03-300-30-10",
  "05-100-10-30": "03-300-30-10",
  "03-200-40-10": "03-300-30-10",
  "03-150-10-10": "03-300-30-10",
  "31-100-10-10": "03-300-30-10",
};

export function normalizeCostCodeForRollup(value: string | null | undefined): string {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";

  // Many imported Procore codes include suffixes like `.O`.
  // Extract the base code shape used by the rollup map.
  const baseMatch = raw.match(/\d{2}-\d{3}-\d{2}-\d{2}/);
  if (baseMatch?.[0]) {
    return baseMatch[0];
  }

  return raw;
}

export function getRolledUpCostCode(costCode: string | null | undefined): string | null {
  const normalized = normalizeCostCodeForRollup(costCode);
  if (!normalized) return null;

  const mapped = COST_CODE_TO_CANONICAL[normalized];
  if (mapped) return mapped;
  if (ROLLUP_CANONICAL_CODES.has(normalized)) return normalized;
  return null;
}
