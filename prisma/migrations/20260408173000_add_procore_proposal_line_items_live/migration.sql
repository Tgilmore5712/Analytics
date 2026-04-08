CREATE TABLE IF NOT EXISTS public.procore_proposal_line_items_live (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  bid_board_project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  cost_code TEXT,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_name TEXT,
  customer_name TEXT,
  proposal_name TEXT,
  CONSTRAINT procore_proposal_line_items_l_company_id_bid_board_project__key
    UNIQUE (company_id, bid_board_project_id, proposal_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS procore_proposal_line_items_live_company_idx
  ON public.procore_proposal_line_items_live (company_id);

CREATE INDEX IF NOT EXISTS procore_proposal_line_items_live_project_idx
  ON public.procore_proposal_line_items_live (bid_board_project_id);

CREATE INDEX IF NOT EXISTS procore_proposal_line_items_live_proposal_idx
  ON public.procore_proposal_line_items_live (proposal_id);

CREATE INDEX IF NOT EXISTS procore_proposal_line_items_live_synced_at_idx
  ON public.procore_proposal_line_items_live (synced_at DESC);