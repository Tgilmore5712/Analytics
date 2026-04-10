import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Walk through a JSON object recursively and collect all leaf values with their paths
 */
function walkPayload(obj, root, collected) {
  if (obj === null || obj === undefined) {
    return;
  }

  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    collected.push({ fieldPath: root, raw_value: obj });
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkPayload(obj[i], `${root}[${i}]`, collected);
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const nextPath = root === '$' ? `$.${key}` : `${root}.${key}`;
      walkPayload(value, nextPath, collected);
    }
    return;
  }
}

/**
 * Classify a value into its appropriate storage columns
 */
function classifyValue(value) {
  if (value === null) {
    return {
      value_type: 'null',
      value_text: null,
      value_number: null,
      value_boolean: null,
      value_json: null,
    };
  }

  if (typeof value === 'string') {
    return {
      value_type: 'string',
      value_text: value,
      value_number: null,
      value_boolean: null,
      value_json: value,
    };
  }

  if (typeof value === 'number') {
    return {
      value_type: 'number',
      value_text: String(value),
      value_number: value,
      value_boolean: null,
      value_json: value,
    };
  }

  if (typeof value === 'boolean') {
    return {
      value_type: 'boolean',
      value_text: String(value),
      value_number: null,
      value_boolean: value,
      value_json: value,
    };
  }

  // array/object for safety
  return {
    value_type: 'json',
    value_text: null,
    value_number: null,
    value_boolean: null,
    value_json: value,
  };
}

/**
 * Unpack a project payload and store/update unpacked fields in database
 */
async function unpackProjectPayload(companyId, projectId, procoreProjectId, payload) {
  const payloadObj = payload && typeof payload === 'object' ? payload : {};

  const flattened = [];
  walkPayload(payloadObj, '$', flattened);

  // Delete existing unpacked fields for this record
  await prisma.$executeRawUnsafe(
    `DELETE FROM procore_project_staging_unpacked_fields
     WHERE company_id = $1 AND project_id = $2 AND procore_project_id = $3`,
    companyId,
    projectId,
    procoreProjectId
  );

  if (flattened.length === 0) {
    return;
  }

  // Insert new unpacked fields
  const unpackedRows = flattened.map((item) => {
    const c = classifyValue(item.raw_value);
    return {
      fieldPath: item.fieldPath,
      valueType: c.value_type,
      valueText: c.value_text,
      valueNumber: c.value_number,
      valueBoolean: c.value_boolean,
      valueJson: c.value_json,
    };
  });

  for (const row of unpackedRows) {
    // Convert value_json to proper JSON string for Postgres JSONB
    const jsonValue = row.valueJson === null ? 'null' : JSON.stringify(row.valueJson);
    
    await prisma.$executeRawUnsafe(
      `INSERT INTO procore_project_staging_unpacked_fields (
        company_id, project_id, procore_project_id, field_path,
        value_type, value_text, value_number, value_boolean, value_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      companyId,
      projectId,
      procoreProjectId,
      row.fieldPath,
      row.valueType,
      row.valueText,
      row.valueNumber,
      row.valueBoolean,
      jsonValue
    );
  }
}

async function main() {
  console.log('[UNPACK] Starting project payload unpacking...');

  try {
    // Ensure the unpacked fields table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS procore_project_staging_unpacked_fields (
        id BIGSERIAL PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        procore_project_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT NULL,
        value_number DOUBLE PRECISION NULL,
        value_boolean BOOLEAN NULL,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, project_id, procore_project_id, field_path)
      )
    `);
    console.log('[UNPACK] Table verified/created');

    // Create indexes
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_ppsu_company ON procore_project_staging_unpacked_fields(company_id)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_ppsu_project ON procore_project_staging_unpacked_fields(project_id)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_ppsu_procore_project ON procore_project_staging_unpacked_fields(procore_project_id)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_ppsu_field_path ON procore_project_staging_unpacked_fields(field_path)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_ppsu_value_text ON procore_project_staging_unpacked_fields(value_text)'
    );
    console.log('[UNPACK] Indexes verified');

    // Fetch all staging records
    const records = await prisma.procoreProjectStaging.findMany({
      select: {
        companyId: true,
        externalId: true,
        procoreProjectId: true,
        payload: true,
      },
    });

    console.log(`[UNPACK] Processing ${records.length} records`);

    let processed = 0;
    let failed = 0;

    for (const record of records) {
      try {
        // Skip records with missing procore_project_id
        if (!record.procoreProjectId) {
          console.warn(`[UNPACK] Skipping record with null procoreProjectId`);
          failed++;
          continue;
        }

        // Use externalId as project_id, or fall back to using procore_project_id
        const projectId = record.externalId || record.procoreProjectId;

        await unpackProjectPayload(
          record.companyId,
          projectId,
          record.procoreProjectId,
          record.payload
        );
        processed++;
        if (processed % 10 === 0) {
          console.log(`[UNPACK] Processed ${processed}/${records.length}`);
        }
      } catch (err) {
        failed++;
        console.error(
          `[UNPACK] Failed to unpack ${record.procoreProjectId}:`,
          err.message.split('\n')[0]
        );
      }
    }

    console.log(`[UNPACK] Complete: ${processed} processed, ${failed} failed`);
  } catch (err) {
    console.error('[UNPACK] Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
