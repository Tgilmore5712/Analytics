import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

type ProjectVendorRow = {
  companyId: string;
  projectId: string;
  procoreVendorId: string;
  name?: string | null;
  abbreviatedName?: string | null;
  isActive?: boolean | null;
  businessPhone?: string | null;
  addressCity?: string | null;
  addressStateCode?: string | null;
  addressCountryCode?: string | null;
  emailAddress?: string | null;
  vendorType?: string | null;
  isEmployee?: boolean | null;
  payload: unknown;
};

function readObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

export function toProjectVendorRow(companyId: string, projectId: string, vendor: unknown): ProjectVendorRow | null {
  const row = readObject(vendor);
  if (!row) return null;

  const vendorId = readString(row.id) || (typeof row.id === 'number' ? String(row.id) : null);
  if (!vendorId) return null;

  const address = readObject(row.address);

  return {
    companyId,
    projectId,
    procoreVendorId: vendorId,
    name: readString(row.name),
    abbreviatedName: readString(row.abbreviated_name),
    isActive: readBoolean(row.is_active),
    businessPhone: readString(row.business_phone),
    addressCity: readString(address?.city),
    addressStateCode: readString(address?.state_code),
    addressCountryCode: readString(address?.country_code),
    emailAddress: readString(row.email_address),
    vendorType: readString(row.vendor_type),
    isEmployee: readBoolean(row.is_employee),
    payload: vendor,
  };
}

export async function ensureProcoreProjectVendorsTable() {
  return;
}

export async function upsertProcoreProjectVendor(row: ProjectVendorRow) {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_vendors
        (
          company_id,
          project_id,
          procore_vendor_id,
          name,
          abbreviated_name,
          is_active,
          business_phone,
          address_city,
          address_state_code,
          address_country_code,
          email_address,
          vendor_type,
          is_employee,
          soft_deleted,
          payload,
          synced_at,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, FALSE, $14::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, project_id, procore_vendor_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        abbreviated_name = EXCLUDED.abbreviated_name,
        is_active = EXCLUDED.is_active,
        business_phone = EXCLUDED.business_phone,
        address_city = EXCLUDED.address_city,
        address_state_code = EXCLUDED.address_state_code,
        address_country_code = EXCLUDED.address_country_code,
        email_address = EXCLUDED.email_address,
        vendor_type = EXCLUDED.vendor_type,
        is_employee = EXCLUDED.is_employee,
        soft_deleted = FALSE,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    row.companyId,
    row.projectId,
    row.procoreVendorId,
    row.name ?? null,
    row.abbreviatedName ?? null,
    row.isActive,
    row.businessPhone ?? null,
    row.addressCity ?? null,
    row.addressStateCode ?? null,
    row.addressCountryCode ?? null,
    row.emailAddress ?? null,
    row.vendorType ?? null,
    row.isEmployee,
    JSON.stringify(row.payload)
  );
}

export async function softDeleteProjectVendorsNotInSet(companyId: string, projectId: string, vendorIds: string[]) {
  if (vendorIds.length === 0) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE procore_project_vendors
        SET soft_deleted = TRUE,
            updated_at = NOW()
        WHERE company_id = $1
          AND project_id = $2
      `,
      companyId,
      projectId
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_project_vendors
      SET soft_deleted = TRUE,
          updated_at = NOW()
      WHERE company_id = $1
        AND project_id = $2
        AND NOT (procore_vendor_id = ANY($3::text[]))
    `,
    companyId,
    projectId,
    vendorIds
  );
}
