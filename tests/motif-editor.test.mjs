import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHex, hexForInput, normalizeMotifParameters, serializeMotifRecipe } from '../public/motif-recipe.js';
import { drawMotifPreview } from '../public/motif-preview.js';

const manifest = JSON.parse(readFileSync(new URL('../public/assets/motifs/manifest.json', import.meta.url), 'utf8'));
const stripe = manifest.entries.find((entry) => entry.id === 'stripe-overskirt');
const tassel = manifest.entries.find((entry) => entry.id === 'tassel-sash');

test('color and scalar normalization stay within Godot resource limits', () => {
  assert.equal(normalizeHex('#C8A23A'), 'c8a23aff');
  assert.equal(hexForInput('c8a23aff'), '#c8a23a');
  assert.equal(normalizeHex('bad'), '000000ff');
  const p = normalizeMotifParameters('tassel-sash', { ...tassel.parameters, strand_count: 900, length: -2, puff_radius: 1 });
  assert.equal(p.strand_count, 64); assert.equal(p.length, 0.02); assert.equal(p.puff_radius, 0.04);
});

test('stripe repeat changes clamp every patch to its own absolute-u cell', () => {
  const p = normalizeMotifParameters(stripe.id, { ...stripe.parameters, repeat_count: 32 });
  assert.equal(p.repeat_count, 32);
  for (const patch of p.sequence) {
    assert.ok(patch.u0 >= 0 && patch.u0 < 1 / 32);
    assert.ok(patch.u1 > patch.u0 && patch.u1 <= 1 / 32);
  }
  const text = serializeMotifRecipe(stripe.id, p);
  assert.match(text, /script_class="StripeMotif"/);
  assert.match(text, /repeat_count = 32/);
  assert.match(text, /Array\[Dictionary\]/);
});

test('modified tassel serializes colors, geometry parameters and seed', () => {
  const text = serializeMotifRecipe(tassel.id, { ...tassel.parameters, colors: ['#112233', '#445566'], strand_count: 36, seed: 42 });
  assert.match(text, /script_class="TasselMotif"/);
  assert.match(text, /Color\(0\.066667, 0\.133333, 0\.2, 1\)/);
  assert.match(text, /strand_count = 36/);
  assert.match(text, /seed = 42/);
  assert.doesNotMatch(text, /undefined|NaN/);
  assert.match(serializeMotifRecipe(stripe.id, { ...stripe.parameters, sequence: [] }), /sequence = Array\[Dictionary\]\(\[\]\)/);
});

test('live canvas preview draws both motifs without DOM or external assets', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] || ((...args) => calls.push([key, ...args])), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, getContext: (kind) => kind === '2d' ? ctx : null };
  for (const entry of manifest.entries) {
    const p = drawMotifPreview(canvas, entry.id, entry.parameters);
    assert.equal(p.motif, entry.parameters.motif);
    assert.equal(canvas.width, 640); assert.equal(canvas.height, 640);
  }
  assert.ok(calls.some(([name]) => name === 'bezierCurveTo'));
  assert.ok(calls.some(([name]) => name === 'strokeRect'));
});
