CREATE TABLE IF NOT EXISTS procore_project_staging (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  company_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  procore_project_id TEXT NULL,
  name TEXT NULL,
  status TEXT NULL,
  customer TEXT NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS project_id TEXT NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS display_name TEXT NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS project_number TEXT NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS project_owner_type TEXT NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS project_owner_type_id TEXT NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS procore_created_at TIMESTAMPTZ NULL;
ALTER TABLE procore_project_staging ADD COLUMN IF NOT EXISTS procore_updated_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS procore_project_staging_source_company_external_key
  ON procore_project_staging(source, company_id, external_id);

CREATE INDEX IF NOT EXISTS "ProcoreProjectStaging_companyId_idx" ON procore_project_staging(company_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectStaging_projectId_idx" ON procore_project_staging(project_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectStaging_projectNumber_idx" ON procore_project_staging(project_number);

CREATE TABLE IF NOT EXISTS procore_project_feed (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  sync_source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  procore_id TEXT NULL,
  project_number TEXT NULL,
  project_name TEXT NOT NULL,
  status TEXT NULL,
  customer TEXT NULL,
  customer_source TEXT NULL,
  office_name TEXT NULL,
  city TEXT NULL,
  state_code TEXT NULL,
  country_code TEXT NULL,
  stage_name TEXT NULL,
  due_date TIMESTAMPTZ NULL,
  created_on TIMESTAMPTZ NULL,
  source_id TEXT NULL,
  source_name TEXT NULL,
  source_created_by TEXT NULL,
  source_created_at TIMESTAMPTZ NULL,
  last_modified_at TIMESTAMPTZ NULL,
  estimated_value DOUBLE PRECISION NULL,
  linked_project_id TEXT NULL,
  match_confidence TEXT NULL,
  matched_at TIMESTAMPTZ NULL,
  soft_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  CONSTRAINT procore_project_feed_company_source_external_key UNIQUE(company_id, sync_source, external_id)
);

CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_companyId_idx" ON procore_project_feed(company_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_projectName_idx" ON procore_project_feed(project_name);
CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_customer_idx" ON procore_project_feed(customer);
CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_syncedAt_idx" ON procore_project_feed(synced_at);
CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_linkedProjectId_idx" ON procore_project_feed(linked_project_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectFeed_softDeleted_idx" ON procore_project_feed(soft_deleted);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_office_name ON procore_project_feed(office_name);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_city ON procore_project_feed(city);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_state_code ON procore_project_feed(state_code);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_due_date ON procore_project_feed(due_date);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_created_on ON procore_project_feed(created_on);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_id ON procore_project_feed(source_id);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_created_by ON procore_project_feed(source_created_by);
CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_created_at ON procore_project_feed(source_created_at);

CREATE TABLE IF NOT EXISTS gantt_v2_projects (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  customer TEXT NULL,
  project_number TEXT NULL,
  status TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gantt_v2_scopes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  crew_size DOUBLE PRECISION NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_gantt_v2_project FOREIGN KEY(project_id) REFERENCES gantt_v2_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gantt_v2_schedule_entries (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  work_date DATE NOT NULL,
  scheduled_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_gantt_v2_scope FOREIGN KEY(scope_id) REFERENCES gantt_v2_scopes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_project_id ON gantt_v2_scopes(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_scope_id ON gantt_v2_schedule_entries(scope_id);

CREATE TABLE IF NOT EXISTS procore_project_vendors (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  procore_vendor_id TEXT NOT NULL,
  name TEXT NULL,
  abbreviated_name TEXT NULL,
  is_active BOOLEAN NULL,
  business_phone TEXT NULL,
  address_city TEXT NULL,
  address_state_code TEXT NULL,
  address_country_code TEXT NULL,
  email_address TEXT NULL,
  vendor_type TEXT NULL,
  is_employee BOOLEAN NULL,
  soft_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  CONSTRAINT procore_project_vendors_company_project_vendor_key UNIQUE(company_id, project_id, procore_vendor_id)
);

CREATE INDEX IF NOT EXISTS "ProcoreProjectVendor_companyId_projectId_idx" ON procore_project_vendors(company_id, project_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectVendor_procoreVendorId_idx" ON procore_project_vendors(procore_vendor_id);
CREATE INDEX IF NOT EXISTS "ProcoreProjectVendor_name_idx" ON procore_project_vendors(name);
CREATE INDEX IF NOT EXISTS "ProcoreProjectVendor_softDeleted_idx" ON procore_project_vendors(soft_deleted);
CREATE INDEX IF NOT EXISTS "ProcoreProjectVendor_syncedAt_idx" ON procore_project_vendors(synced_at);

CREATE TABLE IF NOT EXISTS bidforms (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  bid_package_id TEXT NOT NULL,
  bid_form_id TEXT NOT NULL,
  name TEXT NULL,
  status TEXT NULL,
  created_by TEXT NULL,
  source_created_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bidforms_company_project_package_form_key UNIQUE(company_id, project_id, bid_package_id, bid_form_id)
);

CREATE INDEX IF NOT EXISTS idx_bidforms_company ON bidforms(company_id);
CREATE INDEX IF NOT EXISTS idx_bidforms_project ON bidforms(project_id);
CREATE INDEX IF NOT EXISTS idx_bidforms_bid_package ON bidforms(bid_package_id);
CREATE INDEX IF NOT EXISTS idx_bidforms_bid_form_id ON bidforms(bid_form_id);
CREATE INDEX IF NOT EXISTS idx_bidforms_name ON bidforms(name);
CREATE INDEX IF NOT EXISTS idx_bidforms_synced_at ON bidforms(synced_at DESC);

CREATE TABLE IF NOT EXISTS bidpackages (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  bid_package_id TEXT NOT NULL,
  name TEXT NULL,
  status TEXT NULL,
  source_created_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bidpackages_company_project_package_key UNIQUE(company_id, project_id, bid_package_id)
);

CREATE INDEX IF NOT EXISTS idx_bidpackages_company ON bidpackages(company_id);
CREATE INDEX IF NOT EXISTS idx_bidpackages_project ON bidpackages(project_id);
CREATE INDEX IF NOT EXISTS idx_bidpackages_bid_package_id ON bidpackages(bid_package_id);
CREATE INDEX IF NOT EXISTS idx_bidpackages_synced_at ON bidpackages(synced_at DESC);

CREATE TABLE IF NOT EXISTS bids (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  bid_id TEXT NOT NULL,
  name TEXT NULL,
  status TEXT NULL,
  created_by TEXT NULL,
  source_created_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bids_company_project_bid_key UNIQUE(company_id, project_id, bid_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_company ON bids(company_id);
CREATE INDEX IF NOT EXISTS idx_bids_project ON bids(project_id);
CREATE INDEX IF NOT EXISTS idx_bids_bid_id ON bids(bid_id);
CREATE INDEX IF NOT EXISTS idx_bids_name ON bids(name);
CREATE INDEX IF NOT EXISTS idx_bids_synced_at ON bids(synced_at DESC);

CREATE TABLE IF NOT EXISTS job_titles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_titles_title_lower_key ON job_titles (LOWER(title));