import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeader, headerComplement, decodeArmBranch } from '../src/analyzer/header.js';
import { findDataEnd, mapRegions, shannonEntropy } from '../src/analyzer/regions.js';
import { scanPointers } from '../src/analyzer/pointers.js';
import { scanLZ77 } from '../src/analyzer/lz77scan.js';
import { findStridedTables } from '../src/analyzer/tables.js';
import { detectSaveType } from '../src/analyzer/strings.js';
import { analyzeRom } from '../src/analyzer/analyzeRom.js';
import { compressLZ77 } from '../src/decoders/lz77.js';
import { makeHeader, patternTiles, randomBytes } from './helpers.js';

const BASE = 0x08000000;

test('salto ARM del punto de entrada', () => {
  assert.equal(decodeArmBranch(0xea00002e, BASE).target, 0x080000c0);
  assert.equal(decodeArmBranch(0xeafffffe, BASE).target, BASE); // bucle infinito: B .
  assert.equal(decodeArmBranch(0xe3a00000, BASE), null);        // MOV, no es salto
});

test('cabecera sintética válida e inválida', () => {
  const rom = makeHeader(new Uint8Array(0x200), { title: 'HELLO', code: 'ZABS' });
  const h = parseHeader(rom);
  assert.equal(h.title, 'HELLO'); assert.equal(h.gameCode, 'ZABS');
  assert.equal(h.complement.valid, true);
  assert.equal(h.entryPoint.target, '0x080000C0');
  assert.ok(h.claims.some((c) => /Español/.test(c.statement) && c.level === 'confirmed'));
  rom[0xa0] ^= 1;
  assert.equal(parseHeader(rom).complement.valid, false);
  assert.throws(() => parseHeader(new Uint8Array(10)), RangeError);
});

test('fin de datos y regiones', () => {
  const rom = new Uint8Array(0x10000).fill(0xff); rom.set(randomBytes(0x3000, 5), 0);
  assert.deepEqual(findDataEnd(rom), { dataEnd: 0x3000, paddingByte: '0xFF', paddingSize: 0xd000 });
  const m = mapRegions(rom, 0x1000);
  assert.equal(m.regions.at(-1).class, 'fill-FF');
  assert.equal(m.regions[0].class, 'high-entropy');
  assert.equal(shannonEntropy(new Uint8Array(100)), 0);
});

test('punteros y tablas contiguas', () => {
  const rom = new Uint8Array(0x1000); const dv = new DataView(rom.buffer);
  for (let i = 0; i < 10; i++) dv.setUint32(0x100 + i * 4, BASE + 0x800 + i * 0x10, true);
  dv.setUint32(0x200, BASE + 0x5000, true); // fuera del archivo: no cuenta
  const { refs, runs, stats } = scanPointers(rom, { minRun: 8 });
  assert.equal(stats.romPointerWords, 10);
  assert.deepEqual(runs, [{ start: 0x100, count: 10 }]);
  assert.deepEqual(refs.get(0x800), [0x100]);
});

/** ROM sintética: cabecera + 6 recursos LZ77 + tabla {ptr,u16 size,u16 tag} + un falso candidato sin referencia. */
function syntheticRom() {
  const rom = makeHeader(new Uint8Array(0x8000).fill(0xff));
  rom.fill(0, 0xc0, 0x6000);
  const dv = new DataView(rom.buffer);
  let at = 0x1000; const placed = [];
  for (let i = 0; i < 6; i++) {
    const comp = compressLZ77(patternTiles(4 + i));
    rom.set(comp, at); placed.push({ off: at, size: (4 + i) * 32 }); at += comp.length + 4;
  }
  placed.forEach((p, i) => { dv.setUint32(0x400 + i * 8, BASE + p.off, true); dv.setUint16(0x404 + i * 8, p.size, true); dv.setUint16(0x406 + i * 8, 100 + i, true); });
  rom.set(compressLZ77(patternTiles(2)), 0x3000); // válido pero sin puntero
  return { rom, placed };
}

test('escáner LZ77: corroborado vs hipótesis', () => {
  const { rom, placed } = syntheticRom();
  const { refs } = scanPointers(rom);
  const { candidates } = scanLZ77(rom, refs);
  const corr = candidates.filter((c) => c.level === 'corroborated');
  assert.deepEqual(corr.map((c) => c.offset), placed.map((p) => p.off));
  assert.ok(corr.every((c, i) => c.decompressedSize === placed[i].size));
  assert.ok(corr[0].possibleFormats.some((f) => f.format === 'tiles-4bpp' && f.tiles === 4));
  const lone = candidates.find((c) => c.offset === 0x3000);
  assert.equal(lone.level, 'hypothesis');
});

test('descubrimiento de tabla con paso 8 y campo de tamaño', () => {
  const { rom } = syntheticRom();
  const { refs } = scanPointers(rom);
  const corr = scanLZ77(rom, refs).candidates.filter((c) => c.level === 'corroborated');
  const tables = findStridedTables(rom, new Map(corr.map((c) => [c.offset, c])), refs);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].stride, 8); assert.equal(tables[0].entries, 6);
  assert.deepEqual(tables[0].sizeFieldMatches[0], { fieldOffset: 4, type: 'u16', matches: 6, of: 6 });
  assert.equal(tables[0].level, 'corroborated');
});

test('firma de tipo de guardado', () => {
  const rom = new Uint8Array(64); rom.set([...'xxFLASH1M_V103yy'].map((c) => c.charCodeAt(0)), 10);
  assert.deepEqual(detectSaveType(rom).hits, [{ offset: '0x0000000C', id: 'FLASH1M_V103' }]);
});

test('analyzeRom completo sobre ROM sintética, sin modificar el buffer', () => {
  const { rom } = syntheticRom();
  const copy = rom.slice();
  const r = analyzeRom(rom, { fileName: 'synthetic.gba' });
  assert.deepEqual(rom, copy);
  assert.equal(r.file.unmodified, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.compression.lz77.stats.corroborated, 6);
  assert.equal(r.structures.stridedTables[0].stride, 8);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('segmentación de tablas contiguas con el mismo paso', () => {
  // Tabla A: {ptr, u16 size, u16 tag} x6 ; Tabla B contigua: {ptr, u16 tag, u16 0} x6
  const rom = makeHeader(new Uint8Array(0x10000).fill(0)); const dv = new DataView(rom.buffer);
  let at = 0x2000; const offs = [];
  for (let i = 0; i < 12; i++) { const c = compressLZ77(patternTiles(1 + (i % 6))); rom.set(c, at); offs.push({ off: at, size: (1 + (i % 6)) * 32 }); at += c.length + 4; }
  offs.forEach((o, i) => {
    dv.setUint32(0x400 + i * 8, BASE + o.off, true);
    dv.setUint16(0x404 + i * 8, i < 6 ? o.size : 500 + i, true);
  });
  const { refs } = scanPointers(rom);
  const corr = scanLZ77(rom, refs).candidates.filter((c) => c.level === 'corroborated');
  const tables = findStridedTables(rom, new Map(corr.map((c) => [c.offset, c])), refs).sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(tables.length, 2);
  assert.deepEqual(tables.map((t) => [t.start, t.entries, t.level]), [['0x00000400', 6, 'corroborated'], ['0x00000430', 6, 'hypothesis']]);
});
