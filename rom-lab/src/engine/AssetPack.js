/**
 * Formato intermedio "gba-asset-pack" v1 (ver docs/ENGINE.md). El motor SOLO consume este formato:
 * nunca lee una ROM. Los datos se mantienen indexados (tiles 4bpp + paletas) para conservar el
 * comportamiento de paletas del GBA (cambios de paleta, fundidos) sin re-decodificar.
 */
export const PACK_FORMAT = 'gba-asset-pack';
export const PACK_VERSION = 1;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 propio (sin atob/btoa ni Buffer) para funcionar igual en navegador y Node. */
export function base64Encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
export function base64Decode(str) {
  const clean = str.replace(/\s+/g, '');
  if (clean.length % 4 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error('Base64 inválido');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Valida un pack y devuelve { ok, errors, warnings }. No lanza: el llamador decide.
 * Todas las referencias cruzadas (sprite→tileset, animación→sprite…) se comprueban.
 */
export function validatePack(pack) {
  const errors = [], warnings = [];
  const err = (p, m) => errors.push(`${p}: ${m}`);
  if (!isObj(pack)) return { ok: false, errors: ['El pack no es un objeto JSON'], warnings };
  if (pack.format !== PACK_FORMAT) err('format', `debe ser "${PACK_FORMAT}"`);
  if (pack.version !== PACK_VERSION) err('version', `versión ${pack.version} no soportada (se espera ${PACK_VERSION})`);
  const lic = pack.meta?.license;
  if (!lic || /^(unspecified|unknown|desconocid)/i.test(lic)) warnings.push('meta.license: sin licencia declarada. Verifica que tienes derechos sobre estos recursos antes de usarlos.');
  const sec = (k) => (isObj(pack[k]) ? pack[k] : (pack[k] !== undefined && err(k, 'debe ser un objeto'), {}));
  const palettes = sec('palettes'), tilesets = sec('tilesets'), tilemaps = sec('tilemaps'), sprites = sec('sprites'), animations = sec('animations');

  for (const [id, p] of Object.entries(palettes)) {
    if (!Array.isArray(p.colors) || !p.colors.length || p.colors.length % 16) err(`palettes.${id}.colors`, 'array de colores con longitud múltiplo de 16');
    else p.colors.forEach((c, i) => COLOR_RE.test(c) || err(`palettes.${id}.colors[${i}]`, `"${c}" no es #rrggbb`));
  }
  for (const [id, t] of Object.entries(tilesets)) {
    if (t.bpp !== 4 && t.bpp !== 8) err(`tilesets.${id}.bpp`, 'debe ser 4 u 8');
    if (typeof t.data !== 'string') { err(`tilesets.${id}.data`, 'base64 requerido'); continue; }
    try { const n = base64Decode(t.data).length; if (n % (t.bpp === 8 ? 64 : 32)) err(`tilesets.${id}.data`, `${n} bytes no es múltiplo del tamaño de tile`); }
    catch (e) { err(`tilesets.${id}.data`, e.message); }
  }
  for (const [id, m] of Object.entries(tilemaps)) {
    if (!tilesets[m.tileset]) err(`tilemaps.${id}.tileset`, `tileset "${m.tileset}" inexistente`);
    if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) err(`tilemaps.${id}`, 'width/height enteros ≥ 1');
    if (!Array.isArray(m.palettes) || m.palettes.some((p) => p !== null && !palettes[p])) err(`tilemaps.${id}.palettes`, 'lista de ids de paleta (uno por banco, null = sin usar)');
    if (!Array.isArray(m.layers) || !m.layers.length) err(`tilemaps.${id}.layers`, 'al menos una capa');
    else m.layers.forEach((l, k) => { if (!Array.isArray(l.entries) || l.entries.length !== m.width * m.height) err(`tilemaps.${id}.layers[${k}].entries`, `se esperan ${m.width * m.height} entradas`); });
  }
  for (const [id, s] of Object.entries(sprites)) {
    if (!tilesets[s.tileset]) err(`sprites.${id}.tileset`, `tileset "${s.tileset}" inexistente`);
    if (!palettes[s.palette]) err(`sprites.${id}.palette`, `paleta "${s.palette}" inexistente`);
    if (![8, 16, 32, 64].includes(s.frameWidth) || ![8, 16, 32, 64].includes(s.frameHeight)) err(`sprites.${id}`, 'frameWidth/frameHeight ∈ {8,16,32,64} (tamaños OBJ del GBA)');
    if (s.mapping && s.mapping !== '1d') err(`sprites.${id}.mapping`, 'solo se admite "1d"');
  }
  for (const [id, a] of Object.entries(animations)) {
    if (!sprites[a.sprite]) err(`animations.${id}.sprite`, `sprite "${a.sprite}" inexistente`);
    if (!Array.isArray(a.sequences) || !a.sequences.length) { err(`animations.${id}.sequences`, 'al menos una secuencia'); continue; }
    a.sequences.forEach((seq, k) => {
      if (!Array.isArray(seq) || !seq.length) return err(`animations.${id}.sequences[${k}]`, 'secuencia vacía');
      const last = seq.at(-1);
      if (!('end' in last) && !('jump' in last)) warnings.push(`animations.${id}.sequences[${k}]: no termina en end/jump (se comportará como end implícito)`);
      seq.forEach((c, j) => { if (!('frame' in c || 'end' in c || 'jump' in c || 'loop' in c)) err(`animations.${id}.sequences[${k}][${j}]`, 'comando desconocido'); if ('jump' in c && (c.jump < 0 || c.jump >= seq.length)) err(`animations.${id}.sequences[${k}][${j}]`, 'jump fuera de la secuencia'); });
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}
