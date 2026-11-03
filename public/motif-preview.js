import { normalizeMotifParameters, normalizeHex } from './motif-recipe.js';

const cssColor = (hex) => `#${normalizeHex(hex).slice(0, 6)}`;
function rng(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function stripePreview(ctx, size, p) {
  ctx.fillStyle = cssColor(p.base_color); ctx.fillRect(0, 0, size, size);
  for (let repeat = 0; repeat < p.repeat_count; repeat++) {
    const cell = repeat / p.repeat_count;
    for (const stripe of p.sequence) {
      ctx.fillStyle = cssColor(stripe.color);
      ctx.fillRect((cell + stripe.u0) * size, 0, Math.max(1, (stripe.u1 - stripe.u0) * size), size);
    }
  }
  // Schematic pleat valleys and fine warp lines, not a shader or material claim.
  for (let x = 0; x < size; x += 3) {
    const wave = (Math.cos(x / size * Math.PI * 2 * 40) + 1) / 2;
    ctx.fillStyle = `rgba(0,0,0,${0.04 + (1 - wave) * 0.13})`; ctx.fillRect(x, 0, 1, size);
  }
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  for (let y = 2; y < size; y += 7) ctx.fillRect(0, y, size, 1);
  ctx.strokeStyle = 'rgba(35,39,35,.25)'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, size - 8, size - 8);
}

function tasselPreview(ctx, size, p) {
  ctx.fillStyle = '#f1eee7'; ctx.fillRect(0, 0, size, size);
  const random = rng(p.seed), center = size / 2, top = size * 0.1;
  const length = size * (0.32 + (p.length - 0.02) / 0.28 * 0.38);
  const spread = size * (0.07 + (p.spread - 0.01) / 0.11 * 0.18);
  ctx.lineCap = 'round';
  for (let i = 0; i < p.strand_count; i++) {
    const angle = Math.PI * 2 * i / p.strand_count + (random() - 0.5) * 0.12;
    const strandLength = length * (0.75 + random() * 0.3);
    const dx = Math.cos(angle) * spread, dy = Math.sin(angle) * spread * 0.22;
    ctx.strokeStyle = cssColor(p.colors[i % 2]); ctx.lineWidth = Math.max(1.2, p.strand_radius * size * 0.7);
    ctx.beginPath(); ctx.moveTo(center + dx * 0.12, top);
    ctx.bezierCurveTo(center + dx * 0.35, top + strandLength * 0.35, center + dx * 0.75 + dy, top + strandLength * 0.7, center + dx, top + strandLength);
    ctx.stroke();
  }
  for (let i = 0; i < p.puff_count; i++) {
    const angle = Math.PI * 2 * i / Math.max(1, p.puff_count) + (random() - 0.5) * 0.4;
    const radial = spread * (0.55 + random() * 0.45), drop = length * (0.55 + random() * 0.4);
    const radius = p.puff_radius * size * (0.55 + random() * 0.3);
    ctx.fillStyle = cssColor(p.colors[i % 2]); ctx.beginPath();
    ctx.arc(center + Math.cos(angle) * radial, top + drop + Math.sin(angle) * radial * 0.18, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = cssColor(p.colors[0]); ctx.beginPath(); ctx.arc(center, top, Math.max(8, size * 0.025), 0, Math.PI * 2); ctx.fill();
}

export function drawMotifPreview(canvas, id, source) {
  const p = normalizeMotifParameters(id, source);
  const size = 640;
  if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持二维画布');
  if (id === 'stripe-overskirt') stripePreview(ctx, size, p);
  else if (id === 'tassel-sash') tasselPreview(ctx, size, p);
  else throw new Error(`未知 motif：${id}`);
  return p;
}
