// User permissions configuration
// Define groups for easier management
export const PERMISSION_GROUPS: Record<string, string[]> = {
  "OWNER": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
    "procore", "endpoints", "field", "estimating-tools", "constants", "equipment", 
    "certifications", "kpi-cards-management", "holidays", "handbook", "diagnostics", "admin", "reporting"
  ],
  "ADMIN": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
     "estimating-tools", "constants", "equipment", 
    "certifications", "kpi-cards-management", "holidays", "handbook", "reporting"
  ],
  "HR": [
    "home", "certifications", "crew-dispatch", "holidays", "handbook"
  ],
  "ESTIMATOR": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "project-schedule", "estimating-tools",
    "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "constants", "handbook"
  ],
  "OPERATIONS": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "wip", "projects", "field", "equipment", "certifications", "dashboard", "kpi", "handbook"
  ],
  "PMs": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "project", "wip", "projects", "equipment", "handbook"
  ],
  "FIELD": [
    "home", "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "project-schedule", "handbook"
  ],
 
};

function parseUserPermissionsFromEnv(): Record<string, string[]> {
  const sources = [
    process.env.USER_PERMISSIONS_JSON,
    process.env.NEXT_PUBLIC_USER_PERMISSIONS_JSON,
  ];

  for (const raw of sources) {
    if (!raw || !raw.trim()) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      const normalized: Record<string, string[]> = {};
      for (const [email, permissions] of Object.entries(parsed)) {
        if (typeof email !== "string" || !Array.isArray(permissions)) continue;
        const normalizedPermissions = permissions.filter((perm): perm is string => typeof perm === "string");
        if (normalizedPermissions.length > 0) {
          normalized[email.toLowerCase()] = normalizedPermissions;
        }
      }

      return normalized;
    } catch {
      // Ignore malformed JSON and continue to fallback.
    }
  }

  return {};
}

// Fallback hardcoded permissions if env var is not set
const FALLBACK_PERMISSIONS: Record<string, string[]> = {
  "todd@pmcdecor.com": ["OWNER", "employees", "onboarding"],
  "todd.gilmore@hotmail.com": ["OWNER", "employees", "onboarding"],
  "levi@paradise-concrete.com": ["ADMIN"],
  "rick@pmcdecor.com": ["ADMIN"],
  "shelly@pmcdecor.com": ["ADMIN"],
  "dave@pmcdecor.com": ["ADMIN"],
  "david@pmcdecor.com": ["ADMIN", "employees", "onboarding"],
  "jane@pmcdecor.com": ["HR", "employees", "onboarding"],
  "mervin@pmcdecor.com": ["PMs", "OPERATIONS"],
  "abner@pmcdecor.com": ["PMs", "OPERATIONS"],
  "john@pmcdecor.com": ["OPERATIONS"],
  "isaac@pmcdecor.com": ["ESTIMATOR"],
  "matt@pmcdecor.com": ["FIELD"],
  "matthew@pmcdecor.com": ["FIELD"],
  "jason@pmcdecor.com": ["FIELD"]
};

// Map user emails to permission groups/pages from environment variables, with fallback.
export const USER_PERMISSIONS: Record<string, string[]> = parseUserPermissionsFromEnv() || FALLBACK_PERMISSIONS;

export function hasPageAccess(userEmail: string | null, page: string): boolean {
  if (!userEmail) return false;
  const permissions = getUserPermissions(userEmail);
  return permissions.some(p => p.toLowerCase() === page.toLowerCase());
}

export function getUserPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  
  const userPerms = USER_PERMISSIONS[userEmail.toLowerCase()];
  if (!userPerms) return [];

  const allPages = new Set<string>();
  
  userPerms.forEach(perm => {
    if (PERMISSION_GROUPS[perm]) {
      // It's a group, add all pages from it
      PERMISSION_GROUPS[perm].forEach(page => allPages.add(page));
    } else {
      // It's a specific page
      allPages.add(perm);
    }
  });

  return Array.from(allPages);
}

export function getUserAssignedPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  return USER_PERMISSIONS[userEmail.toLowerCase()] || [];
}

const PATH_PERMISSION_RULES: Array<{ prefix: string; permission: string }> = [
  { prefix: '/auth0-test', permission: 'diagnostics' },
  { prefix: '/procore/test', permission: 'diagnostics' },
  { prefix: '/seed-kpi-cards', permission: 'admin' },
  { prefix: '/test-schedules', permission: 'diagnostics' },
  { prefix: '/debug-cookies', permission: 'diagnostics' },
  { prefix: '/dev-login', permission: 'diagnostics' },
  { prefix: '/diagnostics', permission: 'diagnostics' },
  { prefix: '/employees/handbook', permission: 'handbook' },
  { prefix: '/daily-crew-dispatch-board', permission: 'crew-dispatch' },
  { prefix: '/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/concrete-orders-schedule', permission: 'concrete-orders-schedule' },
  { prefix: '/project-schedule', permission: 'project-schedule' },
  { prefix: '/kpi-cards-management', permission: 'kpi-cards-management' },
    { prefix: '/reporting', permission: 'reporting' },
  { prefix: '/estimating-tools', permission: 'estimating-tools' },
  { prefix: '/crew-management', permission: 'crew-management' },
  { prefix: '/dashboard', permission: 'dashboard' },
  { prefix: '/projects', permission: 'projects' },
  { prefix: '/project', permission: 'project' },
  { prefix: '/procore', permission: 'procore' },
  { prefix: '/scheduling', permission: 'scheduling' },
  { prefix: '/equipment', permission: 'equipment' },
  { prefix: '/holidays', permission: 'holidays' },
  { prefix: '/employees', permission: 'employees' },
  { prefix: '/onboarding', permission: 'onboarding' },
  { prefix: '/endpoints', permission: 'endpoints' },
  { prefix: '/constants', permission: 'constants' },
  { prefix: '/certifications', permission: 'certifications' },
  { prefix: '/kpi', permission: 'kpi' },
  { prefix: '/wip', permission: 'wip' },
  { prefix: '/', permission: 'home' },
];

const API_PERMISSION_RULES: Array<{ prefix: string; permission: string }> = [
  { prefix: '/api/admin', permission: 'admin' },
  { prefix: '/api/debug', permission: 'diagnostics' },
  { prefix: '/api/explore', permission: 'diagnostics' },
  { prefix: '/api/health', permission: 'diagnostics' },
  { prefix: '/api/procore/diagnostics', permission: 'diagnostics' },
  { prefix: '/api/procore/test', permission: 'diagnostics' },
  { prefix: '/api/procore/sync', permission: 'admin' },
  { prefix: '/api/gantt-v2/debug-sync', permission: 'diagnostics' },
  { prefix: '/api/gantt-v2/setup', permission: 'admin' },
  { prefix: '/api/gantt-v2', permission: 'project-schedule' },
  { prefix: '/api/kpi-cards/seed', permission: 'admin' },
  { prefix: '/api/crew-templates', permission: 'crew-management' },
  { prefix: '/api/job-titles', permission: 'employees' },
  { prefix: '/api/status', permission: 'projects' },
  { prefix: '/api/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/api/concrete-orders', permission: 'crew-dispatch' },
  { prefix: '/api/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/api/project-schedule', permission: 'project-schedule' },
  { prefix: '/api/project-scopes', permission: 'project-schedule' },
  { prefix: '/api/schedule-allocations', permission: 'scheduling' },
  { prefix: '/api/scheduling', permission: 'scheduling' },
  { prefix: '/api/dashboard-summary', permission: 'dashboard' },
  { prefix: '/api/estimating-constants', permission: 'estimating-tools' },
  { prefix: '/api/estimates', permission: 'estimating-tools' },
  { prefix: '/api/kpi-cards', permission: 'kpi' },
  { prefix: '/api/kpi', permission: 'kpi' },
  { prefix: '/api/equipment-assignments', permission: 'equipment' },
  { prefix: '/api/equipment', permission: 'equipment' },
  { prefix: '/api/certifications', permission: 'certifications' },
  { prefix: '/api/holidays', permission: 'holidays' },
  { prefix: '/api/employees', permission: 'employees' },
  { prefix: '/api/onboarding-submissions', permission: 'onboarding' },
  { prefix: '/api/projects', permission: 'projects' },
  { prefix: '/api/procore', permission: 'procore' },
];

function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function resolvePermissionForPath(pathname: string): string | null {
  const normalizedPath = normalizePath(pathname);
  const rules = normalizedPath.startsWith('/api/') ? API_PERMISSION_RULES : PATH_PERMISSION_RULES;

  for (const rule of rules) {
    if (rule.prefix === '/') {
      if (normalizedPath === '/') {
        return rule.permission;
      }
      continue;
    }

    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      return rule.permission;
    }
  }

  return null;
}
