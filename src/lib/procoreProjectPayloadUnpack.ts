import { prisma } from '@/lib/prisma';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface UnpackedField {
  fieldPath: string;
  raw_value: JsonValue;
}

export type ValueClassification = {
  value_type: 'string' | 'number' | 'boolean' | 'null' | 'json';
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_json: JsonValue;
};

/**
 * Walk through a JSON object recursively and collect all leaf values with their paths
 */
export function walkPayload(obj: unknown, root: string, collected: UnpackedField[]): void {
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
export function classifyValue(value: JsonValue): ValueClassification {
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

  // Should not reach here with walkPayload, but handle array/object for safety
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
export async function unpackProjectPayload(
  companyId: string,
  projectId: string,
  procoreProjectId: string,
  payload: unknown
): Promise<void> {
  const payloadObj = payload && typeof payload === 'object' ? payload : {};

  const flattened: UnpackedField[] = [];
  walkPayload(payloadObj, '$', flattened);

  // Delete existing unpacked fields for this record
  await prisma.$executeRawUnsafe(
    `
      DELETE FROM procore_project_staging_unpacked_fields
      WHERE company_id = $1
        AND project_id = $2
        AND procore_project_id = $3
    `,
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
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_project_staging_unpacked_fields (
          company_id,
          project_id,
          procore_project_id,
          field_path,
          value_type,
          value_text,
          value_number,
          value_boolean,
          value_json,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      `,
      companyId,
      projectId,
      procoreProjectId,
      row.fieldPath,
      row.valueType,
      row.valueText,
      row.valueNumber,
      row.valueBoolean,
      JSON.stringify(row.valueJson)
    );
  }
}
