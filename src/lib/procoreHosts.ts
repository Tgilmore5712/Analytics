function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

const KNOWN_PROCORE_ORIGINS = [
  "https://api.procore.com",
  "https://qa.procore.com",
  "https://qa-estimating.procore.com",
  "https://estimating-esticom-ccbd079470ce2b6.na-east-01-tugboat.procoretech-qa.com",
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com",
];

export function getAllowedProcoreOrigins(
  extraOrigins: Array<string | null | undefined> = []
): string[] {
  return Array.from(
    new Set(
      [...KNOWN_PROCORE_ORIGINS, ...extraOrigins]
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function buildAllowedProcoreHostCandidates(options: {
  requestedOrigin?: unknown;
  extraOrigins?: Array<string | null | undefined>;
}): { candidates: string[]; error: string | null } {
  const allowedOrigins = getAllowedProcoreOrigins(options.extraOrigins ?? []);
  const requestedRaw =
    typeof options.requestedOrigin === "string" ? options.requestedOrigin.trim() : "";
  const requestedOrigin = normalizeOrigin(requestedRaw);

  if (requestedRaw && (!requestedOrigin || !allowedOrigins.includes(requestedOrigin))) {
    return {
      candidates: [],
      error: "Unsupported baseUrl host.",
    };
  }

  return {
    candidates: requestedOrigin
      ? [requestedOrigin, ...allowedOrigins.filter((origin) => origin !== requestedOrigin)]
      : allowedOrigins,
    error: null,
  };
}

export function getPrimaryAllowedProcoreOrigin(
  fallbackOrigin: string | null | undefined,
  extraOrigins: Array<string | null | undefined> = []
): string {
  const normalizedFallback = normalizeOrigin(fallbackOrigin);
  if (normalizedFallback) return normalizedFallback;

  const [firstAllowed] = getAllowedProcoreOrigins(extraOrigins);
  return firstAllowed ?? "https://api.procore.com";
}
