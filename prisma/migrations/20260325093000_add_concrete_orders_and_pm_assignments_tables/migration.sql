CREATE TABLE IF NOT EXISTS concrete_orders (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL,
  project_name TEXT NOT NULL,
  concrete_company TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  total_yards DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS concrete_orders_date_time_idx
  ON concrete_orders (date, time);

CREATE INDEX IF NOT EXISTS concrete_orders_job_key_idx
  ON concrete_orders (job_key);

CREATE TABLE IF NOT EXISTS long_term_pm_assignments (
  assignment_key TEXT PRIMARY KEY,
  job_key TEXT NOT NULL,
  pm_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS long_term_pm_assignments_job_key_idx
  ON long_term_pm_assignments (job_key);

CREATE INDEX IF NOT EXISTS long_term_pm_assignments_pm_id_idx
  ON long_term_pm_assignments (pm_id);