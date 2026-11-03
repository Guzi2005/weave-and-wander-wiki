// Pure, browser-safe parameter normalization and Godot .tres serialization.
export const MOTIF_LIMITS = {
  stripe: { repeat_count: [1, 32] },
  tassel: { strand_count: [4, 64], puff_count: [0, 40], length: [0.02, 0.3], spread: [0.01, 0.12], strand_radius: [0.001, 0.02], puff_radius: [0.004, 0.04], seed: [0, 999999] },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
const integer = (value, min, max) => Math.round(clamp(value, min, max));
export function normalizeHex(value, fallback = '000000ff') {
  const text = String(value || '').replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(text)) return `${text}ff`;
  if (/^[0-9a-f]{8}$/.test(text)) return text;
  return fallback;
}
export function hexForInput(value) { return `#${normalizeHex(value).slice(0, 6)}`; }

export function normalizeMotifParameters(id, source) {
  if (id === 'stripe-overskirt') {
    const repeat_count = integer(source?.repeat_count, ...MOTIF_LIMITS.stripe.repeat_count);
    const cell = 1 / repeat_count;
    const sequence = (Array.isArray(source?.sequence) ? source.sequence : []).slice(0, 16).map((stripe, index) => {
      const u0 = clamp(stripe?.u0, 0, Math.max(0, cell - 0.0001));
      const u1 = clamp(stripe?.u1, Math.min(cell, u0 + 0.0001), cell);
      return { role: /^[A-Za-z0-9_-]{1,32}$/.test(stripe?.role || '') ? stripe.role : `stripe_${index}`,
        color: normalizeHex(stripe?.color, 'ffffffff'), u0, u1 };
    });
    return { motif: 'warp_stripe', base_color: normalizeHex(source?.base_color, '1f3a3cff'), repeat_count, sequence };
  }
  if (id === 'tassel-sash') {
    const limits = MOTIF_LIMITS.tassel;
    return { motif: 'yarn_pompon_tassel',
      colors: [normalizeHex(source?.colors?.[0], 'd9b13bff'), normalizeHex(source?.colors?.[1], '7e4a8cff')],
      strand_count: integer(source?.strand_count, ...limits.strand_count), puff_count: integer(source?.puff_count, ...limits.puff_count),
      length: clamp(source?.length, ...limits.length), spread: clamp(source?.spread, ...limits.spread),
      strand_radius: clamp(source?.strand_radius, ...limits.strand_radius), puff_radius: clamp(source?.puff_radius, ...limits.puff_radius),
      seed: integer(source?.seed, ...limits.seed) };
  }
  throw new Error(`未知 motif：${id}`);
}

function color(value) {
  const hex = normalizeHex(value);
  const channels = [0, 2, 4, 6].map((start) => Number((parseInt(hex.slice(start, start + 2), 16) / 255).toFixed(6)));
  return `Color(${channels.join(', ')})`;
}
const gdString = (value) => JSON.stringify(String(value));

export function serializeMotifRecipe(id, source) {
  const p = normalizeMotifParameters(id, source);
  const stripe = id === 'stripe-overskirt';
  const className = stripe ? 'StripeMotif' : 'TasselMotif';
  const script = stripe ? 'stripe_motif.gd' : 'tassel_motif.gd';
  const lines = [`[gd_resource type="Resource" script_class="${className}" load_steps=2 format=3]`, '',
    `[ext_resource type="Script" path="res://components/motifs/${script}" id="1"]`, '', '[resource]', 'script = ExtResource("1")'];
  if (stripe) {
    lines.push(`base_color = ${color(p.base_color)}`, `repeat_count = ${p.repeat_count}`);
    if (p.sequence.length === 0) {
      lines.push('sequence = Array[Dictionary]([])');
    } else {
      lines.push('sequence = Array[Dictionary]([');
      p.sequence.forEach((entry, index) => {
        lines.push(`${index ? '}, {' : '{'}`);
        lines.push(`"role": ${gdString(entry.role)}, "color": ${color(entry.color)}, "u0": ${entry.u0}, "u1": ${entry.u1}`);
      });
      lines.push('}])');
    }
  } else {
    lines.push(`colors = Array[Color]([${p.colors.map(color).join(', ')}])`,
      `strand_count = ${p.strand_count}`, `puff_count = ${p.puff_count}`, `length = ${p.length}`,
      `spread = ${p.spread}`, `strand_radius = ${p.strand_radius}`, `puff_radius = ${p.puff_radius}`, `seed = ${p.seed}`);
  }
  return `${lines.join('\n')}\n`;
}
