import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { ProtocolBundle } from '../shared/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'protocoliq-test-'));
process.env.PROTOCOLIQ_DB = join(dir, 'test.db');
process.env.PROTOCOLIQ_NO_LISTEN = '1';

let base = '';
let close: () => void = () => {};

before(async () => {
  const { app } = await import('../server/index.ts');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});

after(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...init });
  assert.ok(res.ok, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const sub = (b: ProtocolBundle, n: string) => b.sections.flatMap((s) => s.subsections).find((s) => s.subsectionNumber === n)!;

test('new protocol gets all 16 ICH sections with empty placeholders', async () => {
  const { id } = await call<{ id: string }>('/protocols', { method: 'POST', body: JSON.stringify({ title: 'Test protocol' }) });
  const b = await call<ProtocolBundle>(`/protocols/${id}`);
  assert.equal(b.sections.length, 16);
  assert.equal(b.sections[15].sectionNumber, 16);
  assert.ok(sub(b, '16.3'));
  assert.equal(b.protocol.status, 'Draft');
  assert.equal(b.objectives.length, 0, 'nothing is pre-filled');
  assert.equal(b.soa.activities.length, 0, 'no assessments are generated');
});

test('save persists content, entities and links; validation reacts', async () => {
  const { id } = await call<{ id: string }>('/protocols', { method: 'POST', body: JSON.stringify({ title: 'Validation protocol' }) });
  let b = await call<ProtocolBundle>(`/protocols/${id}`);
  let report = await call<{ errors: { rule: string }[] }>(`/protocols/${id}/validation`);
  const rules = new Set(report.errors.map((e) => e.rule));
  for (const r of ['missing-protocol-number', 'missing-sponsor', 'missing-primary-objective', 'missing-primary-endpoint', 'missing-inclusion', 'missing-exclusion']) {
    assert.ok(rules.has(r), `expected rule ${r}`);
  }
  assert.ok(!rules.has('missing-title'));

  const objId = randomUUID();
  await call(`/protocols/${id}/save`, {
    method: 'POST',
    body: JSON.stringify({
      meta: { protocolNumber: 'T-001', sponsorName: 'Sponsor Ltd' },
      subsections: [{ id: sub(b, '1.2').id, content: { sponsorAddress: '1 Street' } }],
      objectives: [{ id: objId, code: 'PO1', category: 'Primary', description: 'Primary objective', order: 0 }],
      endpoints: [{ id: randomUUID(), code: 'EP1', category: 'Primary', name: 'Endpoint', definition: '', measurementMethod: '', timepoint: 'Week 12', objectiveIds: [objId], order: 0 }],
    }),
  });
  b = await call<ProtocolBundle>(`/protocols/${id}`);
  assert.equal(b.study.protocolNumber, 'T-001');
  assert.equal(sub(b, '1.2').completionStatus, 'complete');
  assert.deepEqual(b.endpoints[0].objectiveIds, [objId]);

  report = await call(`/protocols/${id}/validation`);
  const after = new Set(report.errors.map((e) => e.rule));
  for (const r of ['missing-protocol-number', 'missing-sponsor', 'missing-primary-objective', 'missing-primary-endpoint']) {
    assert.ok(!after.has(r), `rule ${r} should be resolved`);
  }

  const res = await fetch(`${base}/protocols/${id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'Final' }) });
  assert.equal(res.status, 422, 'cannot finalise with validation errors');
});

test('mandatory subsections cannot be deleted; optional ones can', async () => {
  const { id } = await call<{ id: string }>('/protocols', { method: 'POST', body: JSON.stringify({ title: 'Structure protocol' }) });
  const b = await call<ProtocolBundle>(`/protocols/${id}`);
  const mandatory = await fetch(`${base}/subsections/${sub(b, '5.1').id}`, { method: 'DELETE' });
  assert.equal(mandatory.status, 400);
  await call(`/subsections/${sub(b, '16.1').id}`, { method: 'DELETE' });
  const after = await call<ProtocolBundle>(`/protocols/${id}`);
  assert.equal(after.sections[15].subsections.length, b.sections[15].subsections.length - 1);
});

test('exports DOCX, PDF and JSON', async () => {
  const { id } = await call<{ id: string }>('/protocols', { method: 'POST', body: JSON.stringify({ title: 'Export protocol' }) });
  const pdf = Buffer.from(await (await fetch(`${base}/protocols/${id}/export/pdf`)).arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const docx = Buffer.from(await (await fetch(`${base}/protocols/${id}/export/docx`)).arrayBuffer());
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  const json = await call<{ sections: unknown[] }>(`/protocols/${id}/export/json`);
  assert.equal(json.sections.length, 16);
});
