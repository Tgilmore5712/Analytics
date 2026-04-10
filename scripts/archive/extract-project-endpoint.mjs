import { readFileSync } from "node:fs";

const oasPath = process.argv[2];
if (!oasPath) {
  console.error("Usage: node scripts/extract-project-endpoint.mjs <combined_OAS.json>");
  process.exit(1);
}

const oas = JSON.parse(readFileSync(oasPath, "utf8"));
const pathKey = "/rest/v1.0/projects/{id}";
const op = oas?.paths?.[pathKey]?.get;

function resolveRef(ref) {
  if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = oas;
  for (const p of parts) {
    node = node?.[p];
    if (node == null) return null;
  }
  return node;
}

function unwrapSchema(schema) {
  if (!schema) return null;
  if (schema.$ref) return unwrapSchema(resolveRef(schema.$ref));
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const s of schema.allOf) {
      const r = unwrapSchema(s);
      if (!r) continue;
      if (r.properties && typeof r.properties === "object") {
        Object.assign(merged.properties, r.properties);
      }
      if (Array.isArray(r.required)) {
        merged.required.push(...r.required);
      }
    }
    merged.required = [...new Set(merged.required)];
    return merged;
  }
  return schema;
}

if (!op) {
  console.log(JSON.stringify({ error: "Endpoint not found", pathKey }, null, 2));
  process.exit(0);
}

const response200 = op.responses?.["200"];
const schema = unwrapSchema(response200?.content?.["application/json"]?.schema);
const props = schema?.properties || {};
const propKeys = Object.keys(props).sort((a, b) => a.localeCompare(b));

const sample = {};
for (const k of [
  "id",
  "name",
  "display_name",
  "project_number",
  "project_owner_type",
  "project_owner_id",
  "project_owner",
  "project_owner_business_name",
  "created_at",
  "updated_at",
  "company_name",
]) {
  if (props[k]) {
    const p = props[k].$ref ? unwrapSchema(resolveRef(props[k].$ref)) : props[k];
    sample[k] = {
      type: p?.type ?? null,
      nullable: p?.nullable ?? false,
      example: p?.example ?? null,
      hasProperties: !!p?.properties,
      nestedKeys: p?.properties ? Object.keys(p.properties).slice(0, 12) : undefined,
    };
  }
}

const parameters = (op.parameters || []).map((p) => {
  const resolved = p?.$ref ? resolveRef(p.$ref) : p;
  return {
    name: resolved?.name ?? null,
    in: resolved?.in ?? null,
    required: !!resolved?.required,
    schemaType: resolved?.schema?.type ?? null,
    description: resolved?.description ?? null,
  };
});

console.log(
  JSON.stringify(
    {
      pathKey,
      summary: op.summary || null,
      operationId: op.operationId || null,
      parameters,
      response200Description: response200?.description || null,
      topLevelFieldCount: propKeys.length,
      topLevelFields: propKeys,
      selectedFieldDetails: sample,
    },
    null,
    2
  )
);
