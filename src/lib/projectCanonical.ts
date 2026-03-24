type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function asText(value: unknown): string | null {
  const text = (value ?? '').toString().trim();
  return text.length > 0 ? text : null;
}

export type CanonicalProjectIdentity = {
  procoreId: string | null;
  bidBoardId: string | null;
  customerSource: string | null;
  statusSource: string | null;
};

export function getCanonicalProjectIdentity(project: {
  procoreId?: string | null;
  bidBoardId?: string | null;
  customerSource?: string | null;
  statusSource?: string | null;
  customFields?: unknown;
}): CanonicalProjectIdentity {
  const customFields = asRecord(project.customFields);

  return {
    procoreId: project.procoreId ?? asText(customFields.procoreId),
    bidBoardId: project.bidBoardId ?? asText(customFields.bidBoardId),
    customerSource:
      project.customerSource ??
      asText(customFields.customerSource) ??
      asText(customFields.syncedFrom) ??
      asText(customFields.source),
    statusSource: project.statusSource ?? asText(customFields.statusSource),
  };
}

export function getCanonicalProjectCustomFields(customFields: unknown): AnyRecord {
  return asRecord(customFields);
}
