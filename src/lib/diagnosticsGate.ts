import { NextResponse } from "next/server";

/**
 * Blocks diagnostics/test endpoints in production by default.
 * Set ENABLE_PROD_DIAGNOSTICS=true only for controlled emergency debugging.
 */
export function denyDiagnosticsInProduction(): NextResponse | null {
  const isProduction = process.env.NODE_ENV === "production";
  const allowInProduction = String(process.env.ENABLE_PROD_DIAGNOSTICS || "").toLowerCase() === "true";

  if (isProduction && !allowInProduction) {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 }
    );
  }

  return null;
}