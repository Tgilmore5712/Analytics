-- Promote frequently-used project identity/source attributes out of customFields JSON.
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "procoreId" TEXT,
  ADD COLUMN IF NOT EXISTS "bidBoardId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerSource" TEXT,
  ADD COLUMN IF NOT EXISTS "statusSource" TEXT;

CREATE INDEX IF NOT EXISTS "Project_procoreId_idx" ON "Project"("procoreId");
CREATE INDEX IF NOT EXISTS "Project_bidBoardId_idx" ON "Project"("bidBoardId");

-- Backfill from legacy customFields sidecar where promoted columns are still empty.
UPDATE "Project"
SET
  "procoreId" = COALESCE(
    NULLIF(BTRIM("procoreId"), ''),
    NULLIF(BTRIM("customFields"->>'procoreId'), '')
  ),
  "bidBoardId" = COALESCE(
    NULLIF(BTRIM("bidBoardId"), ''),
    NULLIF(BTRIM("customFields"->>'bidBoardId'), '')
  ),
  "customerSource" = COALESCE(
    NULLIF(BTRIM("customerSource"), ''),
    NULLIF(BTRIM("customFields"->>'customerSource'), ''),
    NULLIF(BTRIM("customFields"->>'syncedFrom'), ''),
    NULLIF(BTRIM("customFields"->>'source'), '')
  ),
  "statusSource" = COALESCE(
    NULLIF(BTRIM("statusSource"), ''),
    NULLIF(BTRIM("customFields"->>'statusSource'), '')
  )
WHERE
  "customFields" IS NOT NULL
  AND (
    NULLIF(BTRIM("procoreId"), '') IS NULL
    OR NULLIF(BTRIM("bidBoardId"), '') IS NULL
    OR NULLIF(BTRIM("customerSource"), '') IS NULL
    OR NULLIF(BTRIM("statusSource"), '') IS NULL
  );
