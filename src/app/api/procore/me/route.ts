// Get current user info from Procore (requires authentication)
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not authenticated with Procore" },
        { status: 401 }
      );
    }

    const response = await fetch(`${procoreConfig.apiUrl}/rest/v1.0/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch user info", details: `Procore API error ${response.status}: ${details}` },
        { status: response.status }
      );
    }

    const user = await response.json();

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore /me error:", message);
    
    return NextResponse.json(
      { error: "Failed to fetch user info", details: message },
      { status: 500 }
    );
  }
}
