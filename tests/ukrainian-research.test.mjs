import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supplementUkrainianRecords, ukrainianRecordPatch } from '../import-ukrainian-research.mjs';
import { validateMotifsManifest, safeMotifAsset, formatMotifParameter, MOTIFS_SCHEMA } from '../public/motifs.js';

const seed = JSON.parse(readFileSync(new URL('../seed/records.json', import.meta.url), 'utf8'));

test('Ukrainian import is idempotent, preserves personal edits and unrelated records', () => {
  const records = structuredClone(seed.records);
  records.push({ id: 'WW-L-PERSONAL', title: '个人记录', notes: '不能覆盖', revision: 9 });
  const once = supplementUkrainianRecords(records, '2026-11-02T08:00:00Z');
  const twice = supplementUkrainianRecords(once, '2026-11-02T09:00:00Z');
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.find((r) => r.id === 'WW-L-PERSONAL'), records.at(-1));
  assert.equal(twice.filter((r) => r.collection_id === 'ukrainian_photo_001').length, 8);
  const edited = structuredClone(once);
  const ensemble = edited.find((r) => r.id === 'WW-UKR-001');
  ensemble.notes += '\n我的田野笔记';
  ensemble.title = '馆藏自订题名';
  ensemble.source.author = '个人补录作者';
  ensemble.media.push({ path: '/assets/personal-note.png', role: 'source', label: '个人图', focus: { x: 50, y: 50 } });
  const updated = supplementUkrainianRecords(edited, '2026-11-02T10:00:00Z');
  const after = updated.find((r) => r.id === 'WW-UKR-001');
  assert.match(after.notes, /我的田野笔记/);
  assert.equal(after.title,'馆藏自订题名');
  assert.equal(after.source.author, '个人补录作者');
  assert.ok(after.media.some((m) => m.path === '/assets/personal-note.png'));
});

test('archive hierarchy and model catalog remain aligned', () => {
  const records = supplementUkrainianRecords(seed.records);
  const catalog = JSON.parse(readFileSync(new URL('../public/assets/catalog.json', import.meta.url), 'utf8'));
  for (const suffix of ['', '-C01', '-C02', '-C03', '-C04', '-C05']) {
    const id = `WW-UKR-001${suffix}`;
    assert.ok(records.some((r) => r.id === id));
    assert.match(catalog.assets[id].model, /^ukrainian_/);
  }
  for (const id of ['WW-UKR-001-C01', 'WW-UKR-001-C02', 'WW-UKR-001-C03', 'WW-UKR-001-C04', 'WW-UKR-001-C05', 'WW-UKR-001-M01', 'WW-UKR-001-M02']) {
    assert.equal(records.find((r) => r.id === id).parent_id, 'WW-UKR-001');
  }
});

test('motif manifest validates local recipes, nested parameters and expected IDs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/motifs/manifest.json', import.meta.url), 'utf8'));
  assert.equal(validateMotifsManifest(manifest).schema, MOTIFS_SCHEMA);
  assert.equal(manifest.entries.length, 2);
  assert.throws(() => validateMotifsManifest({ ...manifest, schema: 'other' }), /schema/);
  assert.equal(safeMotifAsset('/assets/motifs/tassel-sash.tres', 'recipe'), '/assets/motifs/tassel-sash.tres');
  assert.equal(safeMotifAsset('/assets/motifs/../secret.png', 'image'), null);
  assert.equal(safeMotifAsset('https://example.com/x.png', 'image'), null);
  const sequence = formatMotifParameter('sequence', manifest.entries[0].parameters.sequence);
  assert.match(sequence, /yellow [^；]+u 0.005–0.011；green [^；]+u 0.013–0.015/);
  assert.equal(formatMotifParameter('colors', ['#fff', '#000']), '#fff / #000');
});
