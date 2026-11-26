/**
 * Estructuras ESPECÍFICAS DEL JUEGO, con su fuente en la descompilación (pret/pokeemerald, tal como
 * aparece en github.com/marcoscodas/bravely-emerald, commit 949c610). Las direcciones de la descompilación
 * son de la versión inglesa y NO se usan: cada estructura se localiza en la ROM por su forma y se valida.
 */
import { decompressLZ77 } from '../decoders/lz77.js';
import { Evidence } from '../report/evidence.js';
import { hex } from '../core/BinaryReader.js';

export const ROM_BASE = 0x08000000;

export const SOURCES = {
  CompressedSpriteSheet: 'include/sprite.h:19 — { const u32 *data; u16 size; u16 tag; } (8 bytes)',
  CompressedSpritePalette: 'include/sprite.h:42 — { const u32 *data; u16 tag; } (8 bytes con relleno)',
  SPECIES_SHINY_TAG: 'include/data.h:6 — #define SPECIES_SHINY_TAG 500',
  NUM_SPECIES_TABLE: 'include/constants/species.h — SPECIES_UNOWN_QMARK = 439 → tablas de 440 entradas',
  Tileset: 'include/global.fieldmap.h:55 — { bool8 isCompressed; bool8 isSecondary; u16 pad; u32 tiles; u32 palettes; u32 metatiles; u32 metatileAttributes; u32 callback; } (24 bytes)',
  MapLayout: 'include/global.fieldmap.h:66 — { s32 width; s32 height; u32 border; u32 map; u32 primaryTileset; u32 secondaryTileset; } (24 bytes)',
  TilesetLoading: 'src/fieldmap.c:903–984 — tiles primarios a tile 0 (512), secundarios a 512; paletas 0–5 primario, 6–12 secundario',
  MonPicOam: 'src/pokemon.c:2145 — .shape = SPRITE_SHAPE(64x64): los sprites de batalla son OBJ de 64×64',
};

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const toOff = (ptr, len) => (ptr >= ROM_BASE && ptr - ROM_BASE < len ? ptr - ROM_BASE : -1);
const lzSize = (b, o) => { try { return decompressLZ77(b, o, { maxSize: 0x40000 }).decompressedSize; } catch { return 0; } };

/** Lee una tabla de CompressedSpriteSheet/Palette de `count` entradas. */
export function readSpriteTable(bytes, offset, count, kind) {
  const dv = view(bytes); const out = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 8;
    const ptr = dv.getUint32(o, true);
    out.push(kind === 'sheet'
      ? { index: i, data: toOff(ptr, bytes.length), size: dv.getUint16(o + 4, true), tag: dv.getUint16(o + 6, true) }
      : { index: i, data: toOff(ptr, bytes.length), tag: dv.getUint16(o + 4, true) });
  }
  return out;
}

/**
 * Empareja tablas de hojas de sprites y de paletas mediante su campo `tag` (evidencia independiente del
 * análisis de punteros). Entrada: las tablas descubiertas por analyzer/tables.js.
 */
export function pairSpriteTables(bytes, stridedTables) {
  const tables = stridedTables.filter((t) => t.stride === 8 && t.entries >= 4).map((t) => ({ ...t, startN: parseInt(t.start, 16) }));
  const sheets = tables.filter((t) => t.level === Evidence.CORROBORATED || /4096|2048/.test(Object.keys(t.decompressedSizeHistogram).join()));
  const pals = tables.filter((t) => { const k = Object.keys(t.decompressedSizeHistogram); return k.includes('32') && t.decompressedSizeHistogram['32'] / t.entries > 0.9; });
  const result = [];
  for (const s of sheets) {
    const se = readSpriteTable(bytes, s.startN, s.entries, 'sheet');
    const n = se.length;
    const identity = se.every((e, i) => e.tag === i); // etiquetas 0..n-1: coincidir con ellas es casi trivial
    for (const p of pals) {
      // Regla de tamaño: la zona de paletas tiene exactamente n entradas, o 2n (normal + variocolor).
      if (p.entries !== n && p.entries !== 2 * n) continue;
      for (let k = 0; k < p.entries / n; k++) {
        const pe = readSpriteTable(bytes, p.startN + k * n * 8, n, 'palette');
        let same = 0, plus500 = 0;
        for (let i = 0; i < n; i++) { if (se[i].tag === pe[i].tag) same++; else if (pe[i].tag === se[i].tag + 500) plus500++; }
        if (same !== n && plus500 !== n) continue;
        const strong = plus500 === n || !identity;
        result.push({
          sheetTable: s.start, paletteTable: hex(p.startN + k * n * 8), entries: n,
          relation: same === n ? (identity ? 'tag idéntico (= índice)' : 'tag idéntico') : 'tag + 500 (SPECIES_SHINY_TAG)',
          matches: `${n}/${n}`,
          level: strong ? Evidence.CONFIRMED : Evidence.CORROBORATED,
          basis: [SOURCES.CompressedSpriteSheet, SOURCES.CompressedSpritePalette,
            plus500 === n ? SOURCES.SPECIES_SHINY_TAG : identity ? 'Etiquetas = índice y mismo número de entradas (evidencia débil)' : 'Coincidencia de etiquetas no triviales índice a índice'],
        });
      }
    }
  }
  return result;
}

/** Lee y valida un Tileset en `offset`. Devuelve null si no cumple la forma. */
export function readTileset(bytes, offset) {
  if (offset < 0 || offset + 24 > bytes.length) return null;
  const dv = view(bytes);
  const isCompressed = bytes[offset], isSecondary = bytes[offset + 1];
  if (isCompressed > 1 || isSecondary > 1) return null;
  const p = [4, 8, 12, 16].map((k) => toOff(dv.getUint32(offset + k, true), bytes.length));
  if (p.some((x) => x < 0)) return null;
  const cb = dv.getUint32(offset + 20, true);
  if (cb !== 0 && (toOff(cb, bytes.length) < 0 || !(cb & 1))) return null; // callback: NULL o función Thumb
  const tilesLZ = isCompressed ? lzSize(bytes, p[0]) : null;
  if (isCompressed && !tilesLZ) return null;
  return { offset, isCompressed: !!isCompressed, isSecondary: !!isSecondary, tiles: p[0], palettes: p[1], metatiles: p[2], metatileAttributes: p[3], callback: cb ? hex(cb) : null, tilesDecompressedSize: tilesLZ };
}

/**
 * Busca MapLayouts: dimensiones pequeñas + dos punteros a Tilesets válidos, el primero primario y el
 * segundo secundario. Esta doble condición es muy improbable por azar.
 */
export function findMapLayouts(bytes, { limit = bytes.length, maxDim = 256 } = {}) {
  const dv = view(bytes); const layouts = []; const tilesets = new Map();
  const ts = (o) => { if (!tilesets.has(o)) tilesets.set(o, readTileset(bytes, o)); return tilesets.get(o); };
  for (let o = 0; o + 24 <= limit; o += 4) {
    const w = dv.getInt32(o, true), h = dv.getInt32(o + 4, true);
    if (w < 1 || h < 1 || w > maxDim || h > maxDim) continue;
    const border = toOff(dv.getUint32(o + 8, true), bytes.length), map = toOff(dv.getUint32(o + 12, true), bytes.length);
    if (border < 0 || map < 0 || map + w * h * 2 > bytes.length) continue;
    const p = toOff(dv.getUint32(o + 16, true), bytes.length), s = toOff(dv.getUint32(o + 20, true), bytes.length);
    if (p < 0 || s < 0) continue;
    const tp = ts(p), tsec = ts(s);
    if (!tp || !tsec || tp.isSecondary || !tsec.isSecondary) continue;
    layouts.push({ offset: o, width: w, height: h, border, map, primaryTileset: p, secondaryTileset: s });
  }
  const used = new Set(layouts.flatMap((l) => [l.primaryTileset, l.secondaryTileset]));
  return {
    layouts,
    tilesets: [...used].sort((a, b) => a - b).map((o) => tilesets.get(o)),
    level: layouts.length ? Evidence.CORROBORATED : Evidence.HYPOTHESIS,
    basis: [SOURCES.MapLayout, SOURCES.Tileset, 'Forma + primario.isSecondary = 0 + secundario.isSecondary = 1'],
  };
}

/** Prepara los datos de un tileset para el renderizador de metatiles. */
export function loadTilesetData(bytes, ts, decodePalette, { secondary = false, metatileCount } = {}) {
  const tiles = ts.isCompressed ? decompressLZ77(bytes, ts.tiles, { maxSize: 0x40000 }).data
    : bytes.subarray(ts.tiles, Math.min(bytes.length, ts.tiles + (secondary ? 512 : 512) * 32)); // sin compresión: el juego copia 512 tiles (fieldmap.c)
  // Distancia metatiles→atributos = 16 B por metatile (8 u16) si los atributos siguen a los metatiles
  const count = metatileCount ?? Math.max(0, Math.min(512, (ts.metatileAttributes - ts.metatiles) / 16 | 0));
  const metatiles = bytes.subarray(ts.metatiles, ts.metatiles + count * 16);
  const palettes = decodePalette(bytes, ts.palettes, 16 * 16).colors; // array u16[16][16]
  return { tiles, metatiles, palettes, metatileCount: count };
}
