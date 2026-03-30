export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown database error');
}

export function shouldFallbackToEmptyRead(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  // Prisma known request errors for missing table/column.
  if (message.includes('p2021') || message.includes('p2022')) return true;

  // Postgres errors surfaced through Prisma for schema drift or restricted DDL.
  if (message.includes('does not exist')) return true;
  if (message.includes('relation') && message.includes('not found')) return true;
  if (message.includes('permission denied')) return true;
  if (message.includes('must be owner of relation')) return true;
  if (message.includes('insufficient privilege')) return true;

  return false;
}
