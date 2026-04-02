import { NextResponse } from 'next/server';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';
import { getErrorMessage, shouldFallbackToEmptyRead, withDatabaseRetry } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await withDatabaseRetry(() => ensureGanttV2Schema());
    return NextResponse.json({ success: true });
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({
        success: true,
        warning: `Gantt V2 schema bootstrap skipped: ${getErrorMessage(error)}`,
      });
    }

    return NextResponse.json(
      { success: false, error: `Failed to initialize Gantt V2 schema: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
