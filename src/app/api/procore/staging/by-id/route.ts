import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = String(searchParams.get("id") || "").trim();
    const source = String(searchParams.get("source") || "").trim();

    if (!id) {
      return NextResponse.json({ error: "Missing id query param" }, { status: 400 });
    }

    const rows = await prisma.procoreProjectStaging.findMany({
      where: {
        AND: [
          {
            OR: [
              { externalId: id },
              { procoreProjectId: id },
            ],
          },
          ...(source ? [{ source }] : []),
        ],
      },
      orderBy: { syncedAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      id,
      count: Array.isArray(rows) ? rows.length : 0,
      rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
