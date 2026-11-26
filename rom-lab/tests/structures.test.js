import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMapLayouts, readTileset, pairSpriteTables, loadTilesetData } from '../src/structures/schemas.js';
import { scanPointers } from '../src/analyzer/pointers.js';
import { scanLZ77 } from '../src/analyzer/lz77scan.js';
import { findStridedTables } from '../src/analyzer/tables.js';
import { compressLZ77 } from '../src/decoders/lz77.js';
import { decodePalette } from '../src/decoders/palette.js';
import { patternTiles } from './helpers.js';

const B = 0x08000000;

/** ROM sintética con 2 tilesets (primario/secundario) y 3 layouts válidos + 1 inválido. */
function mapRom() {
  const rom = new Uint8Array(0x20000); const dv = new DataView(rom.buffer);
  const tiles = compressLZ77(patternTiles(16)); rom.set(tiles, 0x1000);
  const mkTs = (o, sec) => { rom[o] = 1; rom[o + 1] = sec; [0x1000, 0x2000, 0x3000, 0x3000 + 4 * 16].forEach((p, k) => dv.setUint32(o + 4 + k * 4, B + p, true)); dv.setUint32(o + 20, sec ? B + 0x5001 : 0, true); };
  mkTs(0x800, 0); mkTs(0x818, 1);
  const mkLayout = (o, w, h, p, s) => { dv.setInt32(o, w, true); dv.setInt32(o + 4, h, true); dv.setUint32(o + 8, B + 0x6000, true); dv.setUint32(o + 12, B + 0x7000, true); dv.setUint32(o + 16, B + p, true); dv.setUint32(o + 20, B + s, true); };
  mkLayout(0x400, 4, 4, 0x800, 0x818); mkLayout(0x420, 2, 3, 0x800, 0x818); mkLayout(0x440, 8, 8, 0x800, 0x818);
  mkLayout(0x460, 4, 4, 0x818, 0x800); // primario/secundario invertidos → debe rechazarse
  return rom;
}

test('Tileset: validación de forma', () => {
  const rom = mapRom();
  const t = readTileset(rom, 0x818);
  assert.equal(t.isSecondary, true); assert.equal(t.isCompressed, true); assert.equal(t.tilesDecompressedSize, 16 * 32); assert.equal(t.callback, '0x08005001');
  assert.equal(readTileset(rom, 0x804), null);
});

test('MapLayout: exige primario + secundario', () => {
  const r = findMapLayouts(mapRom());
  assert.deepEqual(r.layouts.map((l) => [l.offset, l.width, l.height]), [[0x400, 4, 4], [0x420, 2, 3], [0x440, 8, 8]]);
  assert.equal(r.tilesets.length, 2);
  const d = loadTilesetData(mapRom(), r.tilesets[0], decodePalette);
  assert.equal(d.metatileCount, 4); assert.equal(d.tiles.length, 16 * 32); assert.equal(d.palettes.length, 256);
});

test('emparejado de tablas por etiqueta (idéntica y +500)', () => {
  const rom = new Uint8Array(0x10000); const dv = new DataView(rom.buffer);
  let at = 0x2000; const sheets = [], pals = [];
  for (let i = 0; i < 6; i++) { const c = compressLZ77(patternTiles(64)); rom.set(c, at); sheets.push(at); at += c.length; }
  for (let i = 0; i < 12; i++) { const c = compressLZ77(Uint8Array.from({ length: 32 }, (_, k) => (k * 7 + i) & 0x7f)); rom.set(c, at); pals.push(at); at += c.length; }
  sheets.forEach((s, i) => { dv.setUint32(0x400 + i * 8, B + s, true); dv.setUint16(0x404 + i * 8, 2048, true); dv.setUint16(0x406 + i * 8, i, true); });
  pals.forEach((p, i) => { dv.setUint32(0x500 + i * 8, B + p, true); dv.setUint16(0x504 + i * 8, i < 6 ? i : i - 6 + 500, true); });
  const { refs } = scanPointers(rom);
  const corr = scanLZ77(rom, refs).candidates.filter((c) => c.level === 'corroborated');
  const tables = findStridedTables(rom, new Map(corr.map((c) => [c.offset, c])), refs);
  const pairs = pairSpriteTables(rom, tables);
  assert.deepEqual(pairs.map((p) => [p.sheetTable, p.paletteTable, p.relation.startsWith('tag +') ? '+500' : '=', p.level]),
    [['0x00000400', '0x00000500', '=', 'corroborated'], ['0x00000400', '0x00000530', '+500', 'confirmed']]);
});

test('emparejado: rechaza tablas de distinto tamaño aunque las etiquetas coincidan', () => {
  const rom = new Uint8Array(0x10000); const dv = new DataView(rom.buffer);
  let at = 0x2000; const sheets = [], pals = [];
  for (let i = 0; i < 4; i++) { const c = compressLZ77(patternTiles(64)); rom.set(c, at); sheets.push(at); at += c.length; }
  for (let i = 0; i < 9; i++) { const c = compressLZ77(Uint8Array.from({ length: 32 }, (_, k) => (k * 5 + i) & 0x7f)); rom.set(c, at); pals.push(at); at += c.length; }
  sheets.forEach((s, i) => { dv.setUint32(0x400 + i * 8, B + s, true); dv.setUint16(0x404 + i * 8, 2048, true); dv.setUint16(0x406 + i * 8, i, true); });
  pals.forEach((p, i) => { dv.setUint32(0x500 + i * 8, B + p, true); dv.setUint16(0x504 + i * 8, i, true); });
  const { refs } = scanPointers(rom);
  const corr = scanLZ77(rom, refs).candidates.filter((c) => c.level === 'corroborated');
  assert.deepEqual(pairSpriteTables(rom, findStridedTables(rom, new Map(corr.map((c) => [c.offset, c])), refs)), []);
});

import { findAnimTables, plausibleAnim } from '../src/structures/animations.js';

test('tablas de animación: forma tabla → arrays → secuencias, aunque estén contiguas en un solo tramo', () => {
  const rom = new Uint8Array(0x4000); const dv = new DataView(rom.buffer);
  const cmd = (o, lo, hi) => { dv.setUint16(o, lo & 0xffff, true); dv.setUint16(o + 2, hi, true); };
  cmd(0x100, 0, 0); cmd(0x104, 0xffff, 0);                                  // F0:0 END (común)
  for (let s = 0; s < 10; s++) { cmd(0x200 + s * 16, 0, 10 + s); cmd(0x204 + s * 16, 1, 5); cmd(0x208 + s * 16, 0xffff, 0); }
  // arrays {común, propia} contiguos en 0x800, y tabla principal justo después: un único tramo de punteros
  for (let s = 0; s < 10; s++) { dv.setUint32(0x800 + s * 8, B + 0x100, true); dv.setUint32(0x804 + s * 8, B + 0x200 + s * 16, true); }
  for (let s = 0; s < 10; s++) dv.setUint32(0x850 + s * 4, B + 0x800 + s * 8, true);
  const { runs } = scanPointers(rom, { minRun: 8 });
  assert.equal(runs.length, 1); // todo en un tramo
  const t = findAnimTables(rom, runs);
  assert.equal(t.length, 1);
  assert.equal(t[0].start, 0x850); assert.equal(t[0].entries, 10);
  assert.deepEqual(t[0].arrayLengthHistogram, { 2: 10 });
  assert.equal(t[0].commonFirstSequence.offset, 0x100); assert.equal(t[0].commonFirstSequence.sharedBy, 10);
  assert.deepEqual(t[0].arrays[3].seqs[1].cmds.map((c) => c.op === 'frame' ? c.duration : c.op), [13, 5, 'end']);
  assert.equal(plausibleAnim(rom, 0x102), null);         // desalineado
  assert.equal(plausibleAnim(rom, 0x900), null);         // ceros sin END
});
