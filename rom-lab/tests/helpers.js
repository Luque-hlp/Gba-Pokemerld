/** Generadores de datos sintéticos: NINGUNA prueba depende de una ROM real. */
import { headerComplement } from '../src/analyzer/header.js';

/** PRNG determinista (mulberry32) para datos reproducibles. */
export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function randomBytes(n, seed = 1) { const r = rng(seed); return Uint8Array.from({ length: n }, () => (r() * 256) | 0); }

/** Cabecera GBA sintética con checksum correcto. El "logo" es relleno: no se usa el logo real. */
export function makeHeader(rom, { title = 'TESTROM', code = 'ZTSS', maker = '01', version = 0 } = {}) {
  const dv = new DataView(rom.buffer);
  dv.setUint32(0, 0xea00002e, true);           // B 0x080000C0
  const put = (o, s, n) => { for (let i = 0; i < n; i++) rom[o + i] = i < s.length ? s.charCodeAt(i) : 0; };
  put(0xa0, title, 12); put(0xac, code, 4); put(0xb0, maker, 2);
  rom[0xb2] = 0x96; rom[0xbc] = version;
  rom[0xbd] = headerComplement(rom);
  return rom;
}

/** Tiles 4bpp sintéticos con patrones repetitivos (comprimibles). */
export function patternTiles(count) {
  const out = new Uint8Array(count * 32);
  for (let t = 0; t < count; t++) for (let i = 0; i < 32; i++) out[t * 32 + i] = ((t + (i >> 2)) & 0xf) * 0x11;
  return out;
}
