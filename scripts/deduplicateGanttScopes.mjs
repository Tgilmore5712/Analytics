/**
 * Cleanup script: remove duplicate gantt_v2_scopes rows for the same project+title.
 *
 * Strategy per duplicate group:
 *  1. If there's a scope with NO dates (the original/unscheduled version), use its total_hours
 *     as the canonical hours. Then prefer the scope WITH dates as the keeper.
 *  2. Fix the keeper's total_hours to the canonical value.
 *  3. Delete all non-keeper scopes AND their gantt_v2_schedule_entries.
 *  4. Wipe activeSchedule entries for this scope (stale/doubled data).
 *     → User must re-open the scope in the modal and save to re-sync activeSchedule.
 *  5. Fix ProjectScope.hours to match the keeper's total_hours.
 *
 * Run (dry run):  node scripts/deduplicateGanttScopes.mjs
 * Run (live):     node scripts/deduplicateGanttScopes.mjs --live
 */

import { PrismaClient } from '@prisma/client';

const isLive = process.argv.includes('--live');
const prisma = new PrismaClient();

async function main() {
  console.log(isLive ? '=== LIVE MODE — changes will be written ===' : '=== DRY RUN — no changes (pass --live to apply) ===');

  // Find all duplicate groups
  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT project_id, title, COUNT(*) AS cnt
    FROM gantt_v2_scopes
    GROUP BY project_id, title
    HAVING COUNT(*) > 1
    ORDER BY project_id, title
  `);

  if (!duplicates || duplicates.length === 0) {
    console.log('No duplicate scopes found. Nothing to do.');
    return;
  }

  console.log(`Found ${duplicates.length} duplicate group(s).\n`);

  for (const dup of duplicates) {
    const { project_id, title, cnt } = dup;

    // Load all scope rows for this group
    const rows = await prisma.$queryRawUnsafe(`
      SELECT s.id, s.start_date, s.end_date, s.total_hours, s.crew_size, s.updated_at,
             p.customer, p.project_number, p.project_name
      FROM gantt_v2_scopes s
      JOIN gantt_v2_projects p ON p.id = s.project_id
      WHERE s.project_id = $1 AND s.title = $2
      ORDER BY
        CASE WHEN s.start_date IS NOT NULL AND s.end_date IS NOT NULL THEN 0 ELSE 1 END ASC,
        s.updated_at DESC NULLS LAST
    `, project_id, title);

    const derivedJobKey = `${rows[0].customer || ''}~${rows[0].project_number || ''}~${rows[0].project_name || ''}`;

    // Find the unscheduled (original) scope to get the canonical hours
    const originalScope = rows.find(r => !r.start_date && !r.end_date);
    // Only use the original's hours as canonical if there IS an unscheduled original.
    // If all scopes have dates, keep the keeper's existing hours (user must correct manually).
    const canonicalHours = originalScope ? Number(originalScope.total_hours) : null;

    // Keeper: first scope with dates (or first if none have dates)
    const keeper = rows[0];
    const toDelete = rows.slice(1);
    const shouldFixHours = canonicalHours !== null && Number(keeper.total_hours) !== canonicalHours;

    console.log(`[${derivedJobKey}] "${title}" — ${cnt} copies`);
    if (canonicalHours !== null) {
      console.log(`  Canonical hours (from original unscheduled scope): ${canonicalHours}`);
    }
    console.log(`  KEEP: ${keeper.id} (total_hours=${keeper.total_hours}, start=${keeper.start_date?.toISOString?.()?.slice(0,10) ?? null})`);
    if (shouldFixHours) {
      console.log(`    → will fix total_hours from ${keeper.total_hours} to ${canonicalHours}`);
    } else if (canonicalHours === null) {
      console.log(`    → no unscheduled original found; keeping current hours=${keeper.total_hours} (verify manually)`);
    }
    toDelete.forEach(r => console.log(`  DELETE: ${r.id} (total_hours=${r.total_hours}, start=${r.start_date?.toISOString?.()?.slice(0,10) ?? null})`));

    if (isLive) {
      // Fix keeper's total_hours if it was doubled and we have a canonical value
      if (shouldFixHours) {
        await prisma.$executeRawUnsafe(
          `UPDATE gantt_v2_scopes SET total_hours = $1, updated_at = NOW() WHERE id = $2`,
          canonicalHours,
          keeper.id
        );
        console.log(`  ✓ Fixed keeper total_hours → ${canonicalHours}`);
      }

      // Delete duplicate scopes and their schedule entries
      for (const row of toDelete) {
        await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`, row.id);
        await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_scopes WHERE id = $1`, row.id);
        console.log(`  ✓ Deleted duplicate scope ${row.id}`);
      }

      // Also delete stale gantt_v2_schedule_entries for the keeper (will be re-created on next save)
      await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_schedule_entries WHERE scope_id = $1`, keeper.id);

      // Wipe activeSchedule entries for this scope so stale/doubled data is cleared
      const deletedAS = await prisma.activeSchedule.deleteMany({
        where: { jobKey: derivedJobKey, scopeOfWork: title },
      });
      console.log(`  ✓ Cleared ${deletedAS.count} activeSchedule entries (re-sync by opening scope in modal)`);

      // Fix ProjectScope.hours to canonical value (only if we have an unscheduled original)
      if (canonicalHours !== null) {
        const updatedPS = await prisma.$executeRawUnsafe(`
          UPDATE "ProjectScope"
          SET hours = $1
          WHERE "jobKey" = $2 AND title = $3 AND (hours IS DISTINCT FROM $1)
        `, canonicalHours, derivedJobKey, title);
        if (Number(updatedPS) > 0) {
          console.log(`  ✓ Fixed ProjectScope.hours → ${canonicalHours}`);
        }
      }
    }

    console.log('');
  }

  if (isLive) {
    console.log('Cleanup complete.');
    console.log('ACTION REQUIRED: Open each affected scope in the Gantt modal and Save to re-sync activeSchedule.');
  } else {
    console.log('Dry run complete. Run with --live to apply changes.');
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

