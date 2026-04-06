import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;
    const refreshToken = cookieStore.get("procore_refresh_token")?.value;
    const scope = String(cookieStore.get("procore_scope")?.value || "").trim();
    const scopes = scope ? scope.split(/\s+/).filter(Boolean) : [];
    const normalizedScopes = scopes.map((entry) => entry.toLowerCase());

    return NextResponse.json({
      success: true,
      connected: Boolean(accessToken),
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      scope: scope || null,
      scopes,
      hasReadScope: normalizedScopes.includes("read"),
      hasWriteScope: normalizedScopes.includes("write"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: "Failed to check Procore auth status",
        details: message,
      },
      { status: 500 }
    );
  }
}
