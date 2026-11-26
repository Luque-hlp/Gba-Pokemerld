/**
 * Descubrimiento de tablas de animación por FORMA (sin direcciones prefijadas).
 * Forma tomada de la descompilación (src/data/pokemon_graphics/front_pic_anims.h:4810–4823, 5255):
 *   const union AnimCmd *const *const tabla[N]   → cada entrada apunta a
 *   const union AnimCmd *const anims[2 o 3]      → cada elemento apunta a
 *   union AnimCmd secuencia[]                    → termina en END (-1) o JUMP (-2)
 * Señales: la tabla es un tramo contiguo de punteros ROM; casi todos sus destinos son arrays cortos
 * de punteros cuyos destinos se decodifican como AnimCmd válidos (frames con imagen y duración acotadas).
 */
import { parseAnimCmds } from '../decoders/anim.js';
import { Evidence } from '../report/evidence.js';
import { hex } from '../core/BinaryReader.js';

const R = 0x08000000;
export const ANIM_SOURCES = {
  layout: 'src/data/pokemon_graphics/front_pic_anims.h:4810 — SINGLE/DOUBLE_ANIMATION: { sAnim_GeneralFrame0, sAnim_X_1[, sAnim_X_2] }',
  frame0: 'src/data.c:115 — sAnim_GeneralFrame0 = { ANIMCMD_FRAME(0, 0), ANIMCMD_END }',
  usage: 'src/pokemon.c:3566 — gMultiuseSpriteTemplate.anims = gMonFrontAnimsPtrTable[species]',
  timing: 'src/sprite.c:1035–1130 — duración d visible max(d,1) ticks; END mantiene el último fotograma; JUMP/LOOP',
};

/** ¿Hay una secuencia AnimCmd plausible en `off`? Devuelve los comandos o null. */
export function plausibleAnim(bytes, off, { maxImage = 64, maxCmds = 64 } = {}) {
  if (off < 0 || off & 3 || off + 8 > bytes.length) return null;
  let cmds;
  try { cmds = parseAnimCmds(bytes, off, maxCmds); } catch { return null; }
  const frames = cmds.filter((c) => c.op === 'frame');
  if (!frames.length) return null;
  if (frames.some((f) => f.image > maxImage)) return null;
  const last = cmds.at(-1);
  if (last.op === 'jump' && last.target >= cmds.length - 1) return null;
  return cmds;
}

/** Lee un array de punteros a secuencias (máx. `max`). Devuelve null si el primero no es válido. */
export function readAnimArray(bytes, off, max = 8) {
  if (off < 0 || off & 3) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seqs = [];
  for (let i = 0; i < max && off + i * 4 + 4 <= bytes.length; i++) {
    const p = dv.getUint32(off + i * 4, true) - R;
    if (p < 0 || p >= bytes.length) break;
    const cmds = plausibleAnim(bytes, p);
    if (!cmds) break;
    seqs.push({ offset: p, cmds });
  }
  return seqs.length ? seqs : null;
}

/**
 * @param {Uint8Array} bytes
 * @param {Array<{start:number,count:number}>} runs tramos de punteros contiguos (analyzer/pointers.js)
 * @param {object} [o] minEntries (def. 8), minValidRatio (def. 0.95)
 */
export function findAnimTables(bytes, runs, { minEntries = 8 } = {}) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (const run of runs) {
    if (run.count < minEntries) continue;
    // Un tramo de punteros puede contener la tabla principal Y los arrays a los que apunta (contiguos
    // en la ROM). Se buscan sub-tramos cuyas entradas apuntan a arrays de secuencias AnimCmd.
    const ok = [];
    for (let i = 0; i < run.count; i++) ok.push(!!readAnimArray(bytes, dv.getUint32(run.start + i * 4, true) - R, 1));
    for (let i = 0; i < run.count;) {
      if (!ok[i]) { i++; continue; }
      let j = i; while (j < run.count && ok[j]) j++;
      if (j - i >= minEntries) out.push(describe(bytes, dv, run.start + i * 4, j - i));
      i = j;
    }
  }
  return out.sort((a, b) => b.entries - a.entries);
}

function describe(bytes, dv, start, count) {
  const targets = Array.from({ length: count }, (_, i) => dv.getUint32(start + i * 4, true) - R);
  // Longitud de cada array = distancia al siguiente destino distinto (no hay terminador), máx. 8.
  const sorted = [...new Set(targets)].sort((a, b) => a - b);
  const next = new Map(sorted.map((t, k) => [t, sorted[k + 1] ?? t + 32]));
  const arrays = targets.map((t) => {
    const len = Math.max(1, Math.min(8, (next.get(t) - t) >> 2));
    const seqs = readAnimArray(bytes, t, len) ?? [];
    return { offset: t, seqs };
  });
  const firstPtrs = new Map(); const lens = {};
  for (const a of arrays) { if (!a.seqs.length) continue; firstPtrs.set(a.seqs[0].offset, (firstPtrs.get(a.seqs[0].offset) || 0) + 1); lens[a.seqs.length] = (lens[a.seqs.length] || 0) + 1; }
  const [commonFirst, sharedBy] = [...firstPtrs.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    start, entries: count, arrayLengthHistogram: lens,
    commonFirstSequence: { offset: commonFirst, sharedBy, cmds: plausibleAnim(bytes, commonFirst) },
    arrays,
    level: Evidence.CORROBORATED,
    basis: [ANIM_SOURCES.layout, `${count} entradas consecutivas apuntan a arrays de secuencias AnimCmd válidas`],
  };
}

/** Versión serializable (sin los comandos completos de cada entrada). */
export function summarizeAnimTable(t) {
  return { start: hex(t.start), entries: t.entries, arrayLengthHistogram: t.arrayLengthHistogram,
    commonFirstSequence: { offset: hex(t.commonFirstSequence.offset), sharedBy: t.commonFirstSequence.sharedBy, cmds: t.commonFirstSequence.cmds }, level: t.level, basis: t.basis };
}
