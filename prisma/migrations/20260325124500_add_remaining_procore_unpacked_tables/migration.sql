CREATE TABLE IF NOT EXISTS budgetlineitems (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  budget_line_item_id TEXT NOT NULL,
  name TEXT NULL,
  cost_code TEXT NULL,
  cost_code_description TEXT NULL,
  wbs_code_id TEXT NULL,
  line_item_type TEXT NULL,
  uom TEXT NULL,
  quantity DOUBLE PRECISION NULL,
  unit_cost DOUBLE PRECISION NULL,
  original_budget_amount DOUBLE PRECISION NULL,
  amount DOUBLE PRECISION NULL,
  calculation_strategy TEXT NULL,
  currency_iso_code TEXT NULL,
  source_created_at TIMESTAMPTZ NULL,
  source_updated_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT budgetlineitems_company_project_item_key UNIQUE(company_id, project_id, budget_line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_budgetlineitems_company ON budgetlineitems(company_id);
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_project ON budgetlineitems(project_id);
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_budget_line_item_id ON budgetlineitems(budget_line_item_id);
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_synced_at ON budgetlineitems(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_cost_code ON budgetlineitems(cost_code);
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_wbs_code_id ON budgetlineitems(wbs_code_id);

CREATE TABLE IF NOT EXISTS budgetlineitem_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  budget_line_item_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT budgetlineitem_unpacked_fields_unique UNIQUE(company_id, project_id, budget_line_item_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_budgetlineitem_unpacked_item ON budgetlineitem_unpacked_fields(company_id, project_id, budget_line_item_id);
CREATE INDEX IF NOT EXISTS idx_budgetlineitem_unpacked_path ON budgetlineitem_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_budgetlineitem_unpacked_text ON budgetlineitem_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_budgetlineitem_unpacked_path_text ON budgetlineitem_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS productivity_log_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  log_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT productivity_log_unpacked_fields_unique UNIQUE(log_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_prod_unpacked_field_path ON productivity_log_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_text ON productivity_log_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_number ON productivity_log_unpacked_fields(value_number);
CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_boolean ON productivity_log_unpacked_fields(value_boolean);
CREATE INDEX IF NOT EXISTS idx_prod_unpacked_path_text ON productivity_log_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS commitment_contract_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commitment_contract_unpacked_fields_unique UNIQUE(contract_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_cc_unpacked_field_path ON commitment_contract_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_text ON commitment_contract_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_number ON commitment_contract_unpacked_fields(value_number);
CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_boolean ON commitment_contract_unpacked_fields(value_boolean);
CREATE INDEX IF NOT EXISTS idx_cc_unpacked_path_text ON commitment_contract_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS commitment_change_order_line_item_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  line_item_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commitment_change_order_line_item_unpacked_fields_unique UNIQUE(line_item_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_ccoli_uf_field_path ON commitment_change_order_line_item_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_ccoli_uf_value_text ON commitment_change_order_line_item_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_ccoli_uf_value_number ON commitment_change_order_line_item_unpacked_fields(value_number);
CREATE INDEX IF NOT EXISTS idx_ccoli_uf_value_boolean ON commitment_change_order_line_item_unpacked_fields(value_boolean);
CREATE INDEX IF NOT EXISTS idx_ccoli_uf_path_text ON commitment_change_order_line_item_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS purchase_order_line_item_contract_detail_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  detail_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_order_line_item_contract_detail_unpacked_fields_unique UNIQUE(detail_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_pold_uf_field_path ON purchase_order_line_item_contract_detail_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_pold_uf_value_text ON purchase_order_line_item_contract_detail_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_pold_uf_value_number ON purchase_order_line_item_contract_detail_unpacked_fields(value_number);
CREATE INDEX IF NOT EXISTS idx_pold_uf_value_boolean ON purchase_order_line_item_contract_detail_unpacked_fields(value_boolean);
CREATE INDEX IF NOT EXISTS idx_pold_uf_path_text ON purchase_order_line_item_contract_detail_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS timecard_time_type_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  type_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT timecard_time_type_unpacked_fields_unique UNIQUE(type_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_field_path ON timecard_time_type_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_value_text ON timecard_time_type_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_path_text ON timecard_time_type_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS timecard_entry_unpacked_fields (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_text TEXT NULL,
  value_number DOUBLE PRECISION NULL,
  value_boolean BOOLEAN NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT timecard_entry_unpacked_fields_unique UNIQUE(entry_id, field_path)
);

CREATE INDEX IF NOT EXISTS idx_tc_unpacked_field_path ON timecard_entry_unpacked_fields(field_path);
CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_text ON timecard_entry_unpacked_fields(value_text);
CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_number ON timecard_entry_unpacked_fields(value_number);
CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_boolean ON timecard_entry_unpacked_fields(value_boolean);
CREATE INDEX IF NOT EXISTS idx_tc_unpacked_path_text ON timecard_entry_unpacked_fields(field_path, value_text);

CREATE TABLE IF NOT EXISTS procore_cost_code_staging (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sub_job_id TEXT NULL,
  cost_code_id TEXT NOT NULL,
  parent_id TEXT NULL,
  origin_id TEXT NULL,
  code TEXT NULL,
  full_code TEXT NULL,
  name TEXT NULL,
  active BOOLEAN NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procore_cost_code_staging_unique UNIQUE(company_id, project_id, sub_job_id, cost_code_id)
);

CREATE TABLE IF NOT EXISTS procore_estimating_catalog_item_staging (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  name TEXT NULL,
  code TEXT NULL,
  cost_code_id TEXT NULL,
  payload JSONB NOT NULL,
  dynamic_fields JSONB NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procore_estimating_catalog_item_staging_unique UNIQUE(company_id, item_id, base_url)
);

ALTER TABLE procore_estimating_catalog_item_staging
  ADD COLUMN IF NOT EXISTS dynamic_fields JSONB NULL;