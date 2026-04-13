import { prisma } from '@/lib/prisma';
import { shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import { getClientCredentialsToken, makeRequest, procoreConfig } from '@/lib/procore';

export type GanttV2ProjectRow = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
};

export type GanttV2ScopeRow = {
  id: string;
  projectId: string;
  predecessorScopeId: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  tasks?: Array<string | { [key: string]: unknown }>;
  color?: string; // Hex color code for scope
  taskColors?: Record<string, string>; // Map of task names to color codes
  scheduledHours: number;
  remainingHours: number;
};

export type GanttV2LongTermProjectRow = {
  projectId: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  totalScopeHours: number;
  totalScheduledHours: number;
  totalRemainingHours: number;
  unscheduledHours: number;
  byMonth: Record<string, number>;
};

export type GanttV2LongTermSummary = {
  months: string[];
  projects: GanttV2LongTermProjectRow[];
};

export type GanttV2ProjectWithScopes = {
  id: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
  scopes: GanttV2ScopeRow[];
  scheduleAllocations: Array<{
    period: string; // "2026-03" for months
    hours: number;
  }>;
};

type ProjectRecord = {
  id: string;
  customer: string | null;
  projectNumber: string | null;
  projectName: string;
};

type ContractRecord = {
  id: string;
  title: string | null;
  number: string | null;
  status: string | null;
  projectId: string | null;
  procoreProjectId: string | null;
};

type ProcoreProjectFeedRecord = {
  externalId: string;
  procoreId: string | null;
  customer: string | null;
  projectName: string;
  projectNumber: string | null;
  linkedProjectId: string | null;
};

type CommercialSource = {
  id: string;
  title: string;
  number: string | null;
};

type EstimateLineItemRecord = {
  bid_board_project_id: string;
  proposal_id: string;
  project_name: string | null;
  customer_name: string | null;
  proposal_name: string | null;
  payload: Record<string, unknown> | null;
  synced_at: Date | string | null;
};

type EstimateGroupRecord = {
  id: string;
  title: string;
};

type EstimateGroupHours = {
  groupId: string;
  title: string;
  hours: number;
};

type GanttProjectsOptions = {
  procoreAccessToken?: string | null;
  procoreCompanyId?: string | null;
};

const formatMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const parseDate = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const isWeekday = (date: Date) => {
  const day = date.getDay();
  return day >= 1 && day <= 5;
};

const getWorkdayCountPerMonth = (start: Date, end: Date): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (!isWeekday(cursor)) continue;
    const key = formatMonthKey(cursor);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

export async function ensureGanttV2Schema(): Promise<void> {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS gantt_v2_projects (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        customer TEXT,
        project_number TEXT,
        status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS gantt_v2_scopes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES gantt_v2_projects(id) ON DELETE CASCADE,
        predecessor_scope_id TEXT REFERENCES gantt_v2_scopes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        start_date DATE,
        end_date DATE,
        total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
        crew_size DOUBLE PRECISION,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS gantt_v2_schedule_entries (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL REFERENCES gantt_v2_scopes(id) ON DELETE CASCADE,
        work_date DATE NOT NULL,
        scheduled_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(scope_id, work_date)
      );
    `,
    `ALTER TABLE gantt_v2_scopes ADD COLUMN IF NOT EXISTS predecessor_scope_id TEXT REFERENCES gantt_v2_scopes(id) ON DELETE SET NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_created_at ON gantt_v2_projects(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_status ON gantt_v2_projects(status);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_project_id ON gantt_v2_scopes(project_id);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_predecessor_scope_id ON gantt_v2_scopes(predecessor_scope_id);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_created_at ON gantt_v2_scopes(created_at ASC);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_entries_scope_id ON gantt_v2_schedule_entries(scope_id);`,
    `CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_entries_work_date ON gantt_v2_schedule_entries(work_date);`,
  ];

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      if (!shouldFallbackToEmptyRead(error)) {
        throw error;
      }
    }
  }
}

export async function getGanttV2Projects(): Promise<GanttV2ProjectRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      project_name: string;
      customer: string | null;
      project_number: string | null;
      status: string | null;
      scope_count: number;
      scoped_hours: number;
      start_date: Date | null;
      end_date: Date | null;
    }>>(`
      SELECT
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        COUNT(s.id)::int AS scope_count,
        COALESCE(SUM(s.total_hours), 0)::float8 AS scoped_hours,
        MIN(s.start_date) AS start_date,
        MAX(s.end_date) AS end_date
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      WHERE p.status = 'In Progress'
      GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status
      ORDER BY p.created_at DESC;
    `);

    return rows.map((row) => ({
      id: row.id,
      projectName: row.project_name,
      customer: row.customer,
      projectNumber: row.project_number,
      status: row.status,
      scopeCount: Number(row.scope_count || 0),
      scopedHours: Number(row.scoped_hours || 0),
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
    }));
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return [];
    }
    throw error;
  }
}

export async function getGanttV2ProjectsWithScopes(options: GanttProjectsOptions = {}): Promise<GanttV2ProjectWithScopes[]> {
  const normalizeIdentity = (value: string | null | undefined) =>
    (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const makeIdentity = (customer: string | null | undefined, projectName: string | null | undefined) =>
    `${normalizeIdentity(customer)}||${normalizeIdentity(projectName)}`;

  const alphaCore = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
      .replace(/\b(?:sq|sf|lf|ln|ft|inch|in|x|co|no|billing|file|budgeted|non|help|and|with)\b/g, ' ')
      .replace(/[^a-z]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeToken = (value: string) => {
    let token = value.trim().toLowerCase();
    if (!token) return '';

    if (token === 'sog') {
      return 'slab';
    }

    if (token.endsWith('ies') && token.length > 4) {
      token = `${token.slice(0, -3)}y`;
    } else if (token.endsWith('ed') && token.length > 5) {
      token = token.slice(0, -2);
    } else if (token.endsWith('s') && token.length > 4) {
      token = token.slice(0, -1);
    }
    return token;
  };

  const tokenize = (value: unknown) =>
    new Set(
      alphaCore(value)
        .split(' ')
        .map((token) => normalizeToken(token))
        .filter((token) => token.length >= 3)
    );

  const anchorTokens = new Set([
    'sidewalk',
    'footer',
    'footing',
    'foundation',
    'slab',
    'paver',
    'porch',
    'curb',
    'wall',
    'pier',
    'bollard',
    'stair',
    'step',
    'deck',
    'ramp',
    'pit',
    'apron',
  ]);

  const extractNumericTokens = (value: unknown) =>
    new Set(
      Array.from(String(value || '').matchAll(/\d+(?:[.,]\d+)?/g)).map((match) =>
        String(match[0] || '').replace(/[.,]/g, '')
      )
    );

  const compareTitles = (scopeTitle: string, candidateTitle: string): number => {
    const scopeNorm = normalizeIdentity(scopeTitle);
    const candidateNorm = normalizeIdentity(candidateTitle);
    if (!scopeNorm || !candidateNorm) return 0;
    if (scopeNorm === candidateNorm) return 100;

    const scopeCore = alphaCore(scopeTitle);
    const candidateCore = alphaCore(candidateTitle);
    if (scopeCore && candidateCore && scopeCore === candidateCore) return 90;
    if (scopeCore && candidateCore && (scopeCore.includes(candidateCore) || candidateCore.includes(scopeCore))) {
      return 75;
    }

    const scopeTokens = tokenize(scopeTitle);
    const candidateTokens = tokenize(candidateTitle);
    if (scopeTokens.size === 0 || candidateTokens.size === 0) return 0;
    const scopeNumbers = extractNumericTokens(scopeTitle);
    const candidateNumbers = extractNumericTokens(candidateTitle);

    let overlap = 0;
    const sharedTokens: string[] = [];
    for (const token of scopeTokens) {
      if (candidateTokens.has(token)) {
        overlap += 1;
        sharedTokens.push(token);
      }
    }
    if (overlap === 0) return 0;

    const sharedNumberCount = Array.from(scopeNumbers).filter((token) => candidateNumbers.has(token)).length;
    const hasSharedAnchor = sharedTokens.some((token) => anchorTokens.has(token));

    if (scopeNumbers.size > 0 && candidateNumbers.size > 0 && sharedNumberCount === 0 && hasSharedAnchor && overlap <= 1) {
      return 0;
    }

    const jaccard = overlap / new Set([...scopeTokens, ...candidateTokens]).size;
    if (overlap >= 2 || jaccard >= 0.5) {
      const boosted = Math.round(55 + jaccard * 20 + sharedNumberCount * 10);
      return Math.min(boosted, 98);
    }

    if (sharedTokens.some((token) => anchorTokens.has(token))) {
      return Math.min(50 + sharedNumberCount * 10, 70);
    }

    return 0;
  };

  const resolveContractIdentity = (
    row: ContractRecord,
    projectById: Map<string, ProjectRecord>,
    feedByExternalId: Map<string, ProcoreProjectFeedRecord>,
    feedByProcoreId: Map<string, ProcoreProjectFeedRecord>
  ) => {
    const directProject = row.projectId ? projectById.get(row.projectId) : null;
    const externalFeed = row.procoreProjectId ? feedByExternalId.get(row.procoreProjectId) : null;
    const procoreFeed = row.procoreProjectId ? feedByProcoreId.get(row.procoreProjectId) : null;
    const feed = externalFeed || procoreFeed || null;
    const linkedProject = feed?.linkedProjectId ? projectById.get(feed.linkedProjectId) : null;

    return makeIdentity(
      directProject?.customer || linkedProject?.customer || feed?.customer,
      directProject?.projectName || linkedProject?.projectName || feed?.projectName
    );
  };

  const isIgnorableCommercialTitle = (value: string) => {
    const normalized = normalizeIdentity(value);
    if (!normalized) return true;
    return normalized.includes('billing file');
  };

  const normalizeLegacyTasks = (value: unknown): Array<string | { [key: string]: unknown }> => {
    if (!Array.isArray(value)) return [];

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : null;
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const name = String(row.name || '').trim();
        if (!name) return null;

        return row;
      })
      .filter((entry): entry is string | { [key: string]: unknown } => Boolean(entry));
  };

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  const asArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const candidates = [record.data, record.line_item_groups, record.groups];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  };

  const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getEstimateUomFromPayload = (payload: Record<string, unknown> | null | undefined) => {
    const record = payload || {};
    const costItem = asObject(record.cost_item);
    return String(costItem?.unit || record.type || '')
      .trim()
      .toUpperCase();
  };

  const getLaborHoursFromPayload = (payload: Record<string, unknown> | null | undefined) => {
    const record = payload || {};
    const count = toNumber(record.count);
    const uom = getEstimateUomFromPayload(record);

    if (count <= 0) return 0;
    if (!['HOUR', 'HOURS', 'HR', 'HRS'].includes(uom)) return 0;

    return count;
  };

  const normalizeGroupRecord = (value: unknown): EstimateGroupRecord | null => {
    const record = asObject(value);
    if (!record) return null;
    const id = String(record.id || record.group_id || '').trim();
    const title = String(record.name || record.title || record.description || '').trim();
    if (!id || !title) return null;
    return { id, title };
  };

  const getEstimateAccessToken = async () => {
    const directToken = String(options.procoreAccessToken || '').trim();
    if (directToken) return directToken;

    if (procoreConfig.clientId && procoreConfig.clientSecret) {
      try {
        return await getClientCredentialsToken();
      } catch (error) {
        console.warn('Unable to get client-credentials token for estimate group fetch:', error);
      }
    }

    return '';
  };

  const fetchEstimateGroups = async (params: {
    accessToken: string;
    companyId: string;
    bidBoardProjectId: string;
    proposalId: string;
  }): Promise<EstimateGroupRecord[]> => {
    const { accessToken, companyId, bidBoardProjectId, proposalId } = params;
    const groups: EstimateGroupRecord[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const payload = await makeRequest(
        `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
          bidBoardProjectId
        )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`,
        accessToken,
        { method: 'GET' },
        companyId,
        [404]
      );

      const pageItems = asArray(payload).map(normalizeGroupRecord).filter((row): row is EstimateGroupRecord => Boolean(row));
      if (pageItems.length === 0) break;
      groups.push(...pageItems);
      if (pageItems.length < perPage) break;
      page += 1;
    }

    return groups;
  };

  const toSqlDate = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10);
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value.toISOString().slice(0, 10);
    }
    return null;
  };

  // First get all projects with summary info
  const projects = await getGanttV2Projects();
  const [projectRecords, purchaseOrderContracts, commitmentContracts, procoreProjectFeed] = await Promise.all([
    prisma.project.findMany({
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
      },
    }) as Promise<ProjectRecord[]>,
    prisma.purchaseOrderContract.findMany({
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        projectId: true,
        procoreProjectId: true,
      },
    }) as Promise<ContractRecord[]>,
    prisma.commitmentContract.findMany({
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        projectId: true,
        procoreProjectId: true,
      },
    }) as Promise<ContractRecord[]>,
    prisma.procoreProjectFeed.findMany({
      where: {
        syncSource: 'procore_v1_projects',
        softDeleted: false,
      },
      select: {
        externalId: true,
        procoreId: true,
        customer: true,
        projectName: true,
        projectNumber: true,
        linkedProjectId: true,
      },
    }) as Promise<ProcoreProjectFeedRecord[]>,
  ]);

  const projectById = new Map(projectRecords.map((project) => [project.id, project]));
  const feedByExternalId = new Map(
    procoreProjectFeed.filter((row) => row.externalId).map((row) => [row.externalId, row])
  );
  const feedByProcoreId = new Map(
    procoreProjectFeed.filter((row) => row.procoreId).map((row) => [row.procoreId as string, row])
  );

  const poTitlesByIdentity = new Map<string, CommercialSource[]>();
  for (const row of purchaseOrderContracts) {
    const title = String(row.title || '').trim();
    if (!title || isIgnorableCommercialTitle(title)) continue;
    const identity = resolveContractIdentity(row, projectById, feedByExternalId, feedByProcoreId);
    if (!identity || identity === '||') continue;
    const bucket = poTitlesByIdentity.get(identity) || [];
    bucket.push({
      id: row.id,
      title,
      number: row.number,
    });
    poTitlesByIdentity.set(identity, bucket);
  }
  for (const [identity, rows] of poTitlesByIdentity.entries()) {
    rows.sort((a, b) => String(a.number || '').localeCompare(String(b.number || '')) || a.title.localeCompare(b.title));
    poTitlesByIdentity.set(identity, rows);
  }

  const commitmentTitlesByIdentity = new Map<string, CommercialSource[]>();
  for (const row of commitmentContracts) {
    const title = String(row.title || '').trim();
    if (!title || isIgnorableCommercialTitle(title)) continue;
    const identity = resolveContractIdentity(row, projectById, feedByExternalId, feedByProcoreId);
    if (!identity || identity === '||') continue;
    const bucket = commitmentTitlesByIdentity.get(identity) || [];
    bucket.push({
      id: row.id,
      title,
      number: row.number,
    });
    commitmentTitlesByIdentity.set(identity, bucket);
  }
  for (const [identity, rows] of commitmentTitlesByIdentity.entries()) {
    rows.sort((a, b) => String(a.number || '').localeCompare(String(b.number || '')) || a.title.localeCompare(b.title));
    commitmentTitlesByIdentity.set(identity, rows);
  }

  // Legacy source of scopes used by short-term and prior schedule flows.
  let legacyScopes: Array<{
    id: string;
    jobKey: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    manpower: number | null;
    hours: number | null;
    description: string | null;
    tasks?: unknown;
  }> = [];
  try {
    legacyScopes = await prisma.projectScope.findMany({
      select: {
        id: true,
        jobKey: true,
        title: true,
        startDate: true,
        endDate: true,
        manpower: true,
        hours: true,
        description: true,
        tasks: true,
      },
    });
  } catch (projectScopeError) {
    console.warn('Unable to load legacy project scopes with tasks, retrying minimal scope fields:', projectScopeError);
    try {
      legacyScopes = await prisma.projectScope.findMany({
        select: {
          id: true,
          jobKey: true,
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
          description: true,
        },
      });
    } catch (fallbackProjectScopeError) {
      console.warn('Skipping legacy project scope hydration:', fallbackProjectScopeError);
      legacyScopes = [];
    }
  }

  const legacyScopesByIdentity = new Map<string, typeof legacyScopes>();
  const protectedIdentityKeys = new Set<string>();
  for (const scope of legacyScopes) {
    const [customer = '', , projectName = ''] = String(scope.jobKey || '').split('~');
    const key = `${normalizeIdentity(customer)}||${normalizeIdentity(projectName)}`;
    if (!key || key === '||') continue;
    const rows = legacyScopesByIdentity.get(key) || [];
    rows.push(scope);
    legacyScopesByIdentity.set(key, rows);

    if (normalizeLegacyTasks(scope.tasks).length > 0) {
      protectedIdentityKeys.add(key);
    }
  }

  const nonProtectedIdentityKeys = new Set(
    projects
      .map((project) => makeIdentity(project.customer, project.projectName))
      .filter((identity) => identity && identity !== '||' && !protectedIdentityKeys.has(identity))
  );

  const estimateRows = await prisma.$queryRawUnsafe<EstimateLineItemRecord[]>(`
    SELECT
      bid_board_project_id,
      proposal_id,
      project_name,
      customer_name,
      proposal_name,
      payload,
      synced_at
    FROM procore_proposal_line_items_live
  `);

  const estimateRowsByIdentity = new Map<string, EstimateLineItemRecord[]>();
  for (const row of estimateRows) {
    const identity = makeIdentity(row.customer_name, row.project_name);
    if (!identity || identity === '||' || !nonProtectedIdentityKeys.has(identity)) continue;
    const bucket = estimateRowsByIdentity.get(identity) || [];
    bucket.push(row);
    estimateRowsByIdentity.set(identity, bucket);
  }

  const estimateHoursByIdentity = new Map<string, EstimateGroupHours[]>();
  const estimateAccessToken = await getEstimateAccessToken();
  const estimateCompanyId = String(options.procoreCompanyId || procoreConfig.companyId || '').trim();

  if (estimateAccessToken && estimateCompanyId) {
    const proposalSelections = Array.from(estimateRowsByIdentity.entries())
      .map(([identity, rows]) => {
        const proposalGroups = new Map<
          string,
          {
            bidBoardProjectId: string;
            proposalId: string;
            proposalName: string;
            lineItemCount: number;
            latestSyncedAt: number;
            rows: EstimateLineItemRecord[];
          }
        >();

        for (const row of rows) {
          const key = `${row.bid_board_project_id}||${row.proposal_id}`;
          const existing = proposalGroups.get(key) || {
            bidBoardProjectId: row.bid_board_project_id,
            proposalId: row.proposal_id,
            proposalName: String(row.proposal_name || '').trim(),
            lineItemCount: 0,
            latestSyncedAt: 0,
            rows: [],
          };
          existing.lineItemCount += 1;
          existing.latestSyncedAt = Math.max(
            existing.latestSyncedAt,
            row.synced_at ? new Date(row.synced_at).getTime() : 0
          );
          existing.rows.push(row);
          proposalGroups.set(key, existing);
        }

        const selected = Array.from(proposalGroups.values()).sort((a, b) => {
          const aOriginal = normalizeIdentity(a.proposalName) === 'original estimate' ? 1 : 0;
          const bOriginal = normalizeIdentity(b.proposalName) === 'original estimate' ? 1 : 0;
          return bOriginal - aOriginal || b.lineItemCount - a.lineItemCount || b.latestSyncedAt - a.latestSyncedAt;
        })[0];

        if (!selected) return null;
        return { identity, selected };
      })
      .filter((row): row is { identity: string; selected: { bidBoardProjectId: string; proposalId: string; proposalName: string; lineItemCount: number; latestSyncedAt: number; rows: EstimateLineItemRecord[] } } => Boolean(row));

    await Promise.all(
      proposalSelections.map(async ({ identity, selected }) => {
        try {
          const groups = await fetchEstimateGroups({
            accessToken: estimateAccessToken,
            companyId: estimateCompanyId,
            bidBoardProjectId: selected.bidBoardProjectId,
            proposalId: selected.proposalId,
          });
          const titleByGroupId = new Map(groups.map((group) => [group.id, group.title]));
          const hoursByGroupId = new Map<string, number>();

          for (const row of selected.rows) {
            const payload = asObject(row.payload);
            const groupId = String(payload?.group_id || '').trim();
            if (!groupId) continue;
            const laborHours = getLaborHoursFromPayload(payload);
            if (laborHours <= 0) continue;
            hoursByGroupId.set(groupId, (hoursByGroupId.get(groupId) || 0) + laborHours);
          }

          const normalized = Array.from(hoursByGroupId.entries())
            .map(([groupId, hours]) => ({
              groupId,
              title: String(titleByGroupId.get(groupId) || '').trim(),
              hours,
            }))
            .filter((row) => row.title && row.hours > 0);

          estimateHoursByIdentity.set(identity, normalized);
        } catch (error) {
          console.warn('Unable to fetch estimate group titles for project identity:', identity, error);
        }
      })
    );
  }
  
  // For each project, fetch its scopes and schedule allocations
  const projectsWithScopes: GanttV2ProjectWithScopes[] = await Promise.all(
    projects.map(async (project) => {
      let scopes = await getGanttV2Scopes(project.id);

      const projectIdentityKey = `${normalizeIdentity(project.customer)}||${normalizeIdentity(project.projectName)}`;
      const legacyForProject = legacyScopesByIdentity.get(projectIdentityKey) || [];
      const isProtectedLegacyProject = protectedIdentityKeys.has(projectIdentityKey);
      const canonicalCommercialTitles = (() => {
        const poTitles = poTitlesByIdentity.get(projectIdentityKey) || [];
        if (poTitles.length > 0) return poTitles;
        return commitmentTitlesByIdentity.get(projectIdentityKey) || [];
      })();
      const estimateGroupHours = estimateHoursByIdentity.get(projectIdentityKey) || [];

      if (isProtectedLegacyProject && legacyForProject.length > 0) {
        const existingTitles = new Set(scopes.map((scope) => normalizeIdentity(scope.title)));
        let insertedLegacyScope = false;

        for (const legacyScope of legacyForProject) {
          const legacyTitle = (legacyScope.title || '').toString().trim();
          if (!legacyTitle) continue;
          if (existingTitles.has(normalizeIdentity(legacyTitle))) continue;

          await prisma.$executeRawUnsafe(
            `
              INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
              VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8)
            `,
            crypto.randomUUID(),
            project.id,
            legacyTitle,
            toSqlDate(legacyScope.startDate),
            toSqlDate(legacyScope.endDate),
            Number(legacyScope.hours || 0),
            legacyScope.manpower === null || legacyScope.manpower === undefined ? null : Number(legacyScope.manpower),
            (legacyScope.description || '').toString().trim() || 'Migrated from legacy projectScope'
          );

          existingTitles.add(normalizeIdentity(legacyTitle));
          insertedLegacyScope = true;
        }

        if (insertedLegacyScope) {
          scopes = await getGanttV2Scopes(project.id);
        }
      }

      const scheduleOrFilters: Array<{
        projectId?: string;
        projectNumber?: string;
        projectName?: string;
      }> = [{ projectId: project.id }];

      if (project.projectNumber) {
        scheduleOrFilters.push({ projectNumber: project.projectNumber });
      }
      if (project.projectName) {
        scheduleOrFilters.push({ projectName: project.projectName });
      }

      type ScheduleWithAllocations = {
        totalHours: number | null;
        allocationsList: Array<{ period: string; hours: number | null }>;
      };

      let schedules: ScheduleWithAllocations[] = [];
      try {
        schedules = await prisma.schedule.findMany({
          where: { OR: scheduleOrFilters },
          include: {
            allocationsList: {
              where: { periodType: 'month' },
              select: { period: true, hours: true },
            },
          },
        });
      } catch (scheduleError) {
        console.warn('Unable to load schedule allocations for Gantt V2 project, retrying without allocations:', {
          projectId: project.id,
          projectName: project.projectName,
          error: scheduleError,
        });

        try {
          const fallbackSchedules = await prisma.schedule.findMany({
            where: { OR: scheduleOrFilters },
            select: {
              totalHours: true,
            },
          });

          schedules = fallbackSchedules.map((schedule) => ({
            totalHours: schedule.totalHours,
            allocationsList: [],
          }));
        } catch (fallbackScheduleError) {
          console.warn('Skipping schedule hydration for Gantt V2 project:', {
            projectId: project.id,
            projectName: project.projectName,
            error: fallbackScheduleError,
          });
          schedules = [];
        }
      }

      const allocationsByPeriod = new Map<string, number>();
      for (const schedule of schedules) {
        for (const allocation of schedule.allocationsList) {
          allocationsByPeriod.set(
            allocation.period,
            (allocationsByPeriod.get(allocation.period) || 0) + Number(allocation.hours || 0)
          );
        }
      }

      const scheduleAllocations = Array.from(allocationsByPeriod.entries())
        .map(([period, hours]) => ({ period, hours }))
        .sort((a, b) => a.period.localeCompare(b.period));

      const scheduleTotalHours = schedules.reduce(
        (sum, schedule) => sum + Number(schedule.totalHours || 0),
        0
      );

      const allocationTotalHours = scheduleAllocations.reduce(
        (sum, allocation) => sum + Number(allocation.hours || 0),
        0
      );

      const effectiveScopedHours =
        project.scopedHours > 0
          ? project.scopedHours
          : scheduleTotalHours > 0
            ? scheduleTotalHours
            : allocationTotalHours;

      // If there is exactly one existing scope with no budgeted hours,
      // hydrate it from schedule totals so cards/modals don't show 0.0h.
      if (
        scopes.length === 1 &&
        Number(scopes[0]?.totalHours || 0) <= 0 &&
        effectiveScopedHours > 0
      ) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_scopes
            SET total_hours = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          effectiveScopedHours,
          scopes[0].id
        );

        scopes = await getGanttV2Scopes(project.id);
      }

      // Enforce invariant: if a project has planned hours, it must have at least one scope.
      if (scopes.length === 0 && effectiveScopedHours > 0) {
        const defaultScopeId = crypto.randomUUID();
        await prisma.$executeRawUnsafe(
          `
            INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
            VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5)
          `,
          defaultScopeId,
          project.id,
          'Primary Scope',
          effectiveScopedHours,
          'Auto-created from schedule allocations'
        );

        scopes = await getGanttV2Scopes(project.id);
      }

      const normalizeTitle = (value: string | null | undefined) =>
        normalizeIdentity(value || '');

      const scopesWithTasks = scopes.map((scope) => {
        if (!isProtectedLegacyProject) {
          return {
            ...scope,
            tasks: [],
          };
        }

        const scopeStart = toSqlDate(scope.startDate);
        const scopeEnd = toSqlDate(scope.endDate);

        const exactMatch = legacyForProject.find((legacyScope) =>
          normalizeTitle(legacyScope.title) === normalizeTitle(scope.title) &&
          toSqlDate(legacyScope.startDate) === scopeStart &&
          toSqlDate(legacyScope.endDate) === scopeEnd
        );

        const titleOnlyMatch = !exactMatch
          ? legacyForProject.find(
              (legacyScope) => normalizeTitle(legacyScope.title) === normalizeTitle(scope.title)
            )
          : null;

        const matchedLegacy = exactMatch || titleOnlyMatch;
        const tasks = matchedLegacy ? normalizeLegacyTasks(matchedLegacy.tasks) : [];

        return {
          ...scope,
          tasks,
        };
      });

      const canonicalScopes =
        !isProtectedLegacyProject && canonicalCommercialTitles.length > 0
          ? (() => {
              const groups = new Map<
                string,
                {
                  source: CommercialSource;
                  members: typeof scopesWithTasks;
                }
              >();
              const unmatchedScopes: typeof scopesWithTasks = [];

              for (const scope of scopesWithTasks) {
                let bestSource: CommercialSource | null = null;
                let bestScore = 0;

                for (const source of canonicalCommercialTitles) {
                  const score = compareTitles(scope.title, source.title);
                  if (score > bestScore) {
                    bestScore = score;
                    bestSource = source;
                  }
                }

                if (!bestSource || bestScore <= 0) {
                  unmatchedScopes.push(scope);
                  continue;
                }

                const bucket = groups.get(bestSource.id) || { source: bestSource, members: [] };
                bucket.members.push(scope);
                groups.set(bestSource.id, bucket);
              }

              const merged = canonicalCommercialTitles
                .map((source) => {
                  const group = groups.get(source.id);
                  const members = group?.members || [];
                  const datedMembers = members.filter((scope) => scope.startDate || scope.endDate);
                  const startDates = datedMembers
                    .map((scope) => scope.startDate)
                    .filter((value): value is string => Boolean(value))
                    .sort();
                  const endDates = datedMembers
                    .map((scope) => scope.endDate)
                    .filter((value): value is string => Boolean(value))
                    .sort();

                  const totalHours = members.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0);
                  const scheduledHours = members.reduce((sum, scope) => sum + Number(scope.scheduledHours || 0), 0);
                  const remainingHours = members.reduce((sum, scope) => sum + Number(scope.remainingHours || 0), 0);
                  const crewSizes = members
                    .map((scope) => scope.crewSize)
                    .filter((value): value is number => value !== null && value !== undefined);
                  const sourceNotes = members
                    .map((scope) => String(scope.title || '').trim())
                    .filter(Boolean);

                  return {
                    id: source.id,
                    projectId: project.id,
                    predecessorScopeId: null,
                    title: source.title,
                    startDate: startDates[0] || null,
                    endDate: endDates[endDates.length - 1] || null,
                    totalHours,
                    crewSize: crewSizes.length > 0 ? Math.max(...crewSizes) : null,
                    notes:
                      sourceNotes.length > 0
                        ? sourceNotes.some((title) => normalizeIdentity(title) !== normalizeIdentity(source.title))
                          ? `Mapped from: ${sourceNotes.join(' | ')}`
                          : null
                        : 'No matched scope hours yet',
                    scheduledHours,
                    remainingHours,
                    tasks: [],
                  } satisfies GanttV2ScopeRow;
                })
                .filter((scope): scope is GanttV2ScopeRow => Boolean(scope));

              return merged.length > 0 ? merged : unmatchedScopes;
            })()
          : scopesWithTasks;

      const displayScopes = isProtectedLegacyProject
        ? canonicalScopes
        : canonicalScopes.map((scope) => {
            const bestEstimate = estimateGroupHours
              .map((group) => ({
                ...group,
                score: compareTitles(scope.title, group.title),
              }))
              .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))[0];

            const estimateHours = bestEstimate && bestEstimate.score > 0 ? Number(bestEstimate.hours || 0) : 0;

            return {
              ...scope,
              totalHours: estimateHours,
              scheduledHours: 0,
              remainingHours: estimateHours,
              notes:
                estimateHours > 0
                  ? `Estimate hours from: ${bestEstimate.title}`
                  : scope.notes,
            };
          });
      
      return {
        ...project,
        scopeCount: displayScopes.length,
        scopedHours: isProtectedLegacyProject ? effectiveScopedHours : displayScopes.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0),
        scopes: displayScopes,
        scheduleAllocations,
      };
    })
  );

  return projectsWithScopes;
}

export async function getGanttV2Scopes(projectId: string): Promise<GanttV2ScopeRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    project_id: string;
    predecessor_scope_id: string | null;
    title: string;
    start_date: Date | null;
    end_date: Date | null;
    total_hours: number;
    crew_size: number | null;
    notes: string | null;
    scheduled_hours: number;
  }>>(
    `
      SELECT
        s.id,
        s.project_id,
        s.predecessor_scope_id,
        s.title,
        s.start_date,
        s.end_date,
        s.total_hours,
        s.crew_size,
        s.notes,
        CASE
          WHEN s.start_date IS NULL OR s.end_date IS NULL OR COALESCE(s.total_hours, 0) <= 0
            THEN 0
          ELSE COALESCE(SUM(e.scheduled_hours), 0)
        END::float8 AS scheduled_hours
      FROM gantt_v2_scopes s
      LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC;
    `,
    projectId
  );

  return rows.map((row) => {
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    return {
      id: row.id,
      projectId: row.project_id,
      predecessorScopeId: row.predecessor_scope_id,
      title: row.title,
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
      totalHours,
      crewSize: row.crew_size === null ? null : Number(row.crew_size),
      notes: row.notes,
      scheduledHours,
      remainingHours: Math.max(totalHours - scheduledHours, 0),
    };
  });
}

export async function getGanttV2LongTermSummary(startMonth?: string, months = 15): Promise<GanttV2LongTermSummary> {
  const base = startMonth && /^\d{4}-\d{2}$/.test(startMonth)
    ? new Date(`${startMonth}-01T00:00:00`)
    : new Date();
  base.setDate(1);
  base.setHours(0, 0, 0, 0);

  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    monthKeys.push(formatMonthKey(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    project_id: string;
    project_name: string;
    customer: string | null;
    project_number: string | null;
    status: string | null;
    scope_id: string;
    total_hours: number;
    start_date: Date | null;
    end_date: Date | null;
    scheduled_hours: number;
  }>>(`
    SELECT
      p.id AS project_id,
      p.project_name,
      p.customer,
      p.project_number,
      p.status,
      s.id AS scope_id,
      s.total_hours,
      s.start_date,
      s.end_date,
      COALESCE(SUM(e.scheduled_hours), 0)::float8 AS scheduled_hours
    FROM gantt_v2_projects p
    JOIN gantt_v2_scopes s ON s.project_id = p.id
    LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = s.id
    WHERE p.status = 'In Progress'
    GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status, s.id
    ORDER BY p.project_name ASC;
  `);

  const projectMap = new Map<string, GanttV2LongTermProjectRow>();

  for (const row of rows) {
    if (!projectMap.has(row.project_id)) {
      projectMap.set(row.project_id, {
        projectId: row.project_id,
        projectName: row.project_name,
        customer: row.customer,
        projectNumber: row.project_number,
        status: row.status,
        totalScopeHours: 0,
        totalScheduledHours: 0,
        totalRemainingHours: 0,
        unscheduledHours: 0,
        byMonth: Object.fromEntries(monthKeys.map((key) => [key, 0])),
      });
    }

    const project = projectMap.get(row.project_id)!;
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    const remainingHours = Math.max(totalHours - scheduledHours, 0);

    project.totalScopeHours += totalHours;
    project.totalScheduledHours += scheduledHours;
    project.totalRemainingHours += remainingHours;

    const start = parseDate(row.start_date);
    const end = parseDate(row.end_date);

    if (!start || !end || end < start || totalHours <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    const workdaysByMonth = getWorkdayCountPerMonth(start, end);
    const totalWorkdays = Array.from(workdaysByMonth.values()).reduce((sum, count) => sum + count, 0);
    if (totalWorkdays <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    let distributed = 0;
    const keysInRange = Array.from(workdaysByMonth.keys()).filter((key) => monthKeys.includes(key));
    keysInRange.forEach((key, index) => {
      const share = (totalHours * (workdaysByMonth.get(key) || 0)) / totalWorkdays;
      const value = index === keysInRange.length - 1 ? totalHours - distributed : share;
      distributed += value;
      project.byMonth[key] = (project.byMonth[key] || 0) + value;
    });
  }

  return {
    months: monthKeys,
    projects: Array.from(projectMap.values()),
  };
}

/**
 * Sync activeSchedule hours to gantt_v2_schedule_entries for a given scope
 * This aggregates daily hours from activeSchedule and populates gantt_v2_schedule_entries
 */
export async function syncActiveScheduleToScope(
  scopeId: string,
  jobKey: string,
  scopeTitle?: string
): Promise<number> {
  // Find activeSchedule entries for this jobKey and aggregate by date
  // Only sync entries from Gantt (source: 'gantt'), exclude custom scopes (source: 'wip-page')
  const activeScheduleHours = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      ...(scopeTitle ? { scopeOfWork: scopeTitle.trim() } : {}),
      source: 'gantt',
    },
  });

  if (!activeScheduleHours || activeScheduleHours.length === 0) {
    // No active schedule entries, clear any existing entries for this scope
    await prisma.$executeRawUnsafe(`
      DELETE FROM gantt_v2_schedule_entries
      WHERE scope_id = $1
    `, scopeId);
    return 0;
  }

  // Aggregate by date
  const hoursByDate = new Map<string, number>();
  for (const entry of activeScheduleHours) {
    const date = entry.date; // Already in YYYY-MM-DD format
    const hours = Number(entry.hours || 0);
    hoursByDate.set(date, (hoursByDate.get(date) || 0) + hours);
  }

  // Clear existing entries for this scope
  await prisma.$executeRawUnsafe(`
    DELETE FROM gantt_v2_schedule_entries
    WHERE scope_id = $1
  `, scopeId);

  // Insert new entries from activeSchedule data
  let totalHours = 0;
  for (const [workDate, hours] of hoursByDate.entries()) {
    totalHours += hours;
    const id = crypto.randomUUID();
    
    await prisma.$executeRawUnsafe(`
      INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
      VALUES ($1, $2, $3::date, $4)
    `, id, scopeId, workDate, hours);
  }

  return totalHours;
}
