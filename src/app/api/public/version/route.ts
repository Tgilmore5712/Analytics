import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function clean(value: string | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const commitSha = clean(process.env.VERCEL_GIT_COMMIT_SHA) || clean(process.env.GIT_COMMIT_SHA);
  const branch = clean(process.env.VERCEL_GIT_COMMIT_REF) || clean(process.env.GIT_BRANCH);
  const deployedAt = clean(process.env.VERCEL_DEPLOYMENT_CREATED_AT) || null;
  const environment = clean(process.env.VERCEL_ENV) || process.env.NODE_ENV || 'unknown';

  return NextResponse.json(
    {
      success: true,
      commitSha,
      shortCommitSha: commitSha ? commitSha.slice(0, 8) : null,
      branch,
      deployedAt,
      environment,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}
