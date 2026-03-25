import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;
type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

let unpackedFieldsTableReady: Promise<void> | null = null;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureBudgetLineItemsTable() {
  return;
}

function readNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function walkPayload(value: JsonLike, path: string, output: Array<{ fieldPath: string; value: JsonLike }>) {
  output.push({ fieldPath: path, value });

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkPayload(item, `${path}[${index}]`, output);
    });
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkPayload(child as JsonLike, `${path}.${key}`, output);
    }
  }
}

function classifyValue(value: JsonLike) {
  if (value === null) {
    return {
      valueType: 'null',
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: null,
    };
  }
  if (typeof value === 'string') {
    return {
      valueType: 'string',
      valueText: value,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }
  if (typeof value === 'number') {
    return {
      valueType: 'number',
      valueText: String(value),
      valueNumber: Number.isFinite(value) ? value : null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }
  if (typeof value === 'boolean') {
    return {
      valueType: 'boolean',
      valueText: value ? 'true' : 'false',
      valueNumber: null as number | null,
      valueBoolean: value,
      valueJson: value,
    };
  }

  return {
    valueType: Array.isArray(value) ? 'array' : 'object',
    valueText: JSON.stringify(value),
    valueNumber: null as number | null,
    valueBoolean: null as boolean | null,
    valueJson: value,
  };
}

async function ensureBudgetLineItemUnpackedFieldsTable() {
  if (unpackedFieldsTableReady) return unpackedFieldsTableReady;

  unpackedFieldsTableReady = (async () => {
    return;
  })();

  return unpackedFieldsTableReady;
}

async function syncUnpackedFieldsForBudgetLineItem(
  companyId: string,
  projectId: string,
  budgetLineItemId: string,
  payload: JsonObject
) {
  await ensureBudgetLineItemUnpackedFieldsTable();

  const flattened: Array<{ fieldPath: string; value: JsonLike }> = [];
  walkPayload(payload as JsonLike, '$', flattened);

  const rows = flattened.map(({ fieldPath, value }) => {
    const classified = classifyValue(value);
    return {
      field_path: fieldPath,
      value_type: classified.valueType,
      value_text: classified.valueText,
      value_number: classified.valueNumber,
      value_boolean: classified.valueBoolean,
      value_json: classified.valueJson,
    };
  });

  await prisma.$executeRawUnsafe(
    `
      DELETE FROM budgetlineitem_unpacked_fields
      WHERE company_id = $1
        AND project_id = $2
        AND budget_line_item_id = $3
    `,
    companyId,
    projectId,
    budgetLineItemId
  );

  if (!rows.length) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO budgetlineitem_unpacked_fields (
        company_id,
        project_id,
        budget_line_item_id,
        field_path,
        value_type,
        value_text,
        value_number,
        value_boolean,
        value_json,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        row_data.field_path,
        row_data.value_type,
        row_data.value_text,
        row_data.value_number,
        row_data.value_boolean,
        COALESCE(row_data.value_json, 'null'::jsonb),
        NOW()
      FROM jsonb_to_recordset($4::jsonb) AS row_data(
        field_path TEXT,
        value_type TEXT,
        value_text TEXT,
        value_number DOUBLE PRECISION,
        value_boolean BOOLEAN,
        value_json JSONB
      )
      ON CONFLICT (company_id, project_id, budget_line_item_id, field_path)
      DO UPDATE SET
        value_type = EXCLUDED.value_type,
        value_text = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_boolean = EXCLUDED.value_boolean,
        value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    budgetLineItemId,
    JSON.stringify(rows)
  );
}

export async function upsertBudgetLineItem(params: {
  companyId: string;
  projectId: string;
  budgetLineItemId: string;
  name?: string | null;
  costCode?: string | null;
  costCodeDescription?: string | null;
  wbsCodeId?: string | null;
  lineItemType?: string | null;
  uom?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  originalBudgetAmount?: number | null;
  amount?: number | null;
  calculationStrategy?: string | null;
  currencyIsoCode?: string | null;
  sourceCreatedAt?: string | Date | null;
  sourceUpdatedAt?: string | Date | null;
  payload: JsonObject;
}) {
  const {
    companyId,
    projectId,
    budgetLineItemId,
    name,
    costCode,
    costCodeDescription,
    wbsCodeId,
    lineItemType,
    uom,
    quantity,
    unitCost,
    originalBudgetAmount,
    amount,
    calculationStrategy,
    currencyIsoCode,
    sourceCreatedAt,
    sourceUpdatedAt,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO budgetlineitems (
        company_id,
        project_id,
        budget_line_item_id,
        name,
        cost_code,
        cost_code_description,
        wbs_code_id,
        line_item_type,
        uom,
        quantity,
        unit_cost,
        original_budget_amount,
        amount,
        calculation_strategy,
        currency_iso_code,
        source_created_at,
        source_updated_at,
        payload,
        synced_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::timestamptz,$18::jsonb,NOW(),NOW())
      ON CONFLICT (company_id, project_id, budget_line_item_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        cost_code = EXCLUDED.cost_code,
        cost_code_description = EXCLUDED.cost_code_description,
        wbs_code_id = EXCLUDED.wbs_code_id,
        line_item_type = EXCLUDED.line_item_type,
        uom = EXCLUDED.uom,
        quantity = EXCLUDED.quantity,
        unit_cost = EXCLUDED.unit_cost,
        original_budget_amount = EXCLUDED.original_budget_amount,
        amount = EXCLUDED.amount,
        calculation_strategy = EXCLUDED.calculation_strategy,
        currency_iso_code = EXCLUDED.currency_iso_code,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    budgetLineItemId,
    name ?? null,
    costCode ?? null,
    costCodeDescription ?? null,
    wbsCodeId ?? null,
    lineItemType ?? null,
    uom ?? null,
    typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : readNum(quantity),
    typeof unitCost === 'number' && Number.isFinite(unitCost) ? unitCost : readNum(unitCost),
    typeof originalBudgetAmount === 'number' && Number.isFinite(originalBudgetAmount) ? originalBudgetAmount : readNum(originalBudgetAmount),
    typeof amount === 'number' && Number.isFinite(amount) ? amount : readNum(amount),
    calculationStrategy ?? null,
    currencyIsoCode ?? null,
    normalizeTimestamp(sourceCreatedAt),
    normalizeTimestamp(sourceUpdatedAt),
    JSON.stringify(payload)
  );

  await syncUnpackedFieldsForBudgetLineItem(companyId, projectId, budgetLineItemId, payload);
}
