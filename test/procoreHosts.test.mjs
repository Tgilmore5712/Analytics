import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAllowedProcoreHostCandidates,
  getAllowedProcoreOrigins,
  getPrimaryAllowedProcoreOrigin,
} from '../src/lib/procoreHosts.ts';

test('getAllowedProcoreOrigins normalizes and de-duplicates configured origins', () => {
  const origins = getAllowedProcoreOrigins([
    'HTTPS://API.PROCORE.COM/some/path?x=1',
    'https://qa.procore.com',
    'not-a-url',
    undefined,
  ]);

  assert.equal(origins[0], 'https://api.procore.com');
  assert.ok(origins.includes('https://qa.procore.com'));
  assert.equal(
    origins.filter((origin) => origin === 'https://api.procore.com').length,
    1
  );
});

test('buildAllowedProcoreHostCandidates prefers a valid requested origin first', () => {
  const result = buildAllowedProcoreHostCandidates({
    requestedOrigin: 'https://qa.procore.com/bid_board',
  });

  assert.equal(result.error, null);
  assert.equal(result.candidates[0], 'https://qa.procore.com');
  assert.ok(result.candidates.includes('https://api.procore.com'));
});

test('buildAllowedProcoreHostCandidates rejects unsupported requested origins', () => {
  const result = buildAllowedProcoreHostCandidates({
    requestedOrigin: 'https://evil.example.com',
  });

  assert.equal(result.error, 'Unsupported baseUrl host.');
  assert.deepEqual(result.candidates, []);
});

test('getPrimaryAllowedProcoreOrigin returns normalized fallback origin when provided', () => {
  const origin = getPrimaryAllowedProcoreOrigin(
    'HTTPS://QA.PROCORE.COM/bid_board?company_id=123'
  );

  assert.equal(origin, 'https://qa.procore.com');
});

test('getPrimaryAllowedProcoreOrigin falls back to the first allowed origin', () => {
  const origin = getPrimaryAllowedProcoreOrigin(null, ['https://custom.procore.example']);

  assert.equal(origin, 'https://api.procore.com');
});
