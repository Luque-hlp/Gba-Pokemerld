/**
 * Descubrimiento de tablas de estructuras con paso fijo (stride) a partir de evidencia:
 * secuencias de punteros equiespaciados que apuntan todos a recursos LZ77 válidos.
 * Para cada tabla se mide qué campos u16 coinciden con el tamaño descomprimido del recurso
 * apuntado: eso sugiere el layout {ptr, u16 size, ...} sin suponerlo a priori.
 */
import { hex } from '../core/BinaryReader.js';
import { Evidence } from '../report/evidence.js';

/**
 * @param {Uint8Array} bytes
 * @param {Map<number, object>} lzByOffset offset -> candidato LZ77 (corroborado)
 * @param {Map<number, number[]>} refs
 * @param {object} [opts] minEntries (def. 4), strides (def. [4,8,12,16,20,24,28,32])
 */
export function findStridedTables(bytes, lzByOffset, refs, opts = {}) {
  const minEntries = opts.minEntries ?? 4;
  const strides = opts.strides ?? [4, 8, 12, 16, 20, 24, 28, 32];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Posiciones (en archivo) que contienen un puntero a un recurso LZ77 corroborado
  const sites = new Map(); // site -> target
  for (const [target] of lzByOffset) for (const s of refs.get(target) ?? []) sites.set(s, target);
  const sorted = [...sites.keys()].sort((a, b) => a - b);
  const used = new Set();
  const tables = [];

  for (const start of sorted) {
    if (used.has(start)) continue;
    let best = null;
    for (const stride of strides) {
      let n = 0;
      while (sites.has(start + n * stride)) n++;
      if (n >= minEntries && (!best || n * 1 > best.n || (n === best.n && stride < best.stride))) best = { stride, n };
    }
    if (!best) continue;
    const all = [];
    for (let i = 0; i < best.n; i++) { const s = start + i * best.stride; used.add(s); all.push({ site: s, target: sites.get(s) }); }

    // Segmentación: tablas distintas pueden estar contiguas con el mismo paso. Se divide la secuencia
    // donde cambia de forma sostenida (>= minEntries entradas) la coincidencia del campo u16 de tamaño.
    for (const entries of segmentBySizeField(dv, all, best.stride, lzByOffset, minEntries)) {
      if (entries.length >= minEntries) tables.push(describeTable(dv, entries, best.stride, lzByOffset));
    }
  }
  return tables.sort((a, b) => b.entries - a.entries);
}

/** Campo u16 (offset dentro de la estructura) que más coincide con el tamaño descomprimido. */
function bestSizeField(dv, entries, stride, lz) {
  const fields = [];
  for (let fo = 4; fo + 2 <= stride; fo += 2) {
    let matches = 0;
    for (const e of entries) if (dv.getUint16(e.site + fo, true) === lz.get(e.target).decompressedSize) matches++;
    if (matches > 0) fields.push({ fieldOffset: fo, type: 'u16', matches, of: entries.length });
  }
  return fields.sort((a, b) => b.matches - a.matches);
}

function segmentBySizeField(dv, entries, stride, lz, minEntries) {
  if (stride < 6) return [entries];
  const [field] = bestSizeField(dv, entries, stride, lz);
  if (!field) return [entries];
  const state = entries.map((e) => dv.getUint16(e.site + field.fieldOffset, true) === lz.get(e.target).decompressedSize);
  const cuts = [0];
  let cur = state[0];
  for (let i = 1; i < state.length; i++) {
    if (state[i] === cur) continue;
    // ¿el nuevo estado se mantiene al menos minEntries entradas?
    let k = i; while (k < state.length && state[k] === state[i]) k++;
    if (k - i >= minEntries) { cuts.push(i); cur = state[i]; }
  }
  cuts.push(entries.length);
  const segs = [];
  for (let i = 0; i + 1 < cuts.length; i++) segs.push(entries.slice(cuts[i], cuts[i + 1]));
  return segs;
}

function describeTable(dv, entries, stride, lz) {
  const fieldMatches = bestSizeField(dv, entries, stride, lz);
  const top = fieldMatches[0];
  const ratio = top ? top.matches / top.of : 0;
  const exceptions = top && ratio < 1
    ? entries.map((e, i) => ({ i, e })).filter(({ e }) => dv.getUint16(e.site + top.fieldOffset, true) !== lz.get(e.target).decompressedSize)
      .slice(0, 16).map(({ i, e }) => ({ index: i, site: hex(e.site), fieldValue: dv.getUint16(e.site + top.fieldOffset, true), decompressedSize: lz.get(e.target).decompressedSize }))
    : [];
  const sizes = {};
  for (const e of entries) { const z = lz.get(e.target).decompressedSize; sizes[z] = (sizes[z] || 0) + 1; }
  const uniqueTargets = new Set(entries.map((e) => e.target)).size;
  return {
    start: hex(entries[0].site), end: hex(entries.at(-1).site + stride), stride, entries: entries.length, uniqueTargets,
    decompressedSizeHistogram: sizes,
    sizeFieldMatches: fieldMatches,
    sizeFieldExceptions: exceptions,
    level: ratio >= 0.9 ? Evidence.CORROBORATED : Evidence.HYPOTHESIS,
    interpretation: ratio >= 0.9
      ? `Hipótesis de layout: {+0 ptr a LZ77, +${top.fieldOffset} u16 = tamaño descomprimido (${top.matches}/${top.of})${stride > top.fieldOffset + 2 ? ', resto sin interpretar' : ''}}`
      : `Tabla de ${entries.length} punteros a LZ77 con paso ${stride}; campos restantes sin interpretar`,
    sample: entries.slice(0, 4).map((e) => ({ site: hex(e.site), target: hex(e.target), decompressedSize: lz.get(e.target).decompressedSize })),
  };
}
