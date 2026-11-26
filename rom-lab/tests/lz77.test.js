import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompressLZ77, compressLZ77, readLZ77Header, LZ77Error } from '../src/decoders/lz77.js';
import { randomBytes, patternTiles } from './helpers.js';

test('vector manual: solo literales', () => {
  // cabecera: 0x10, tamaño 4 | flags 0x00 | 'A' 'B' 'C' 'D'
  const src = Uint8Array.from([0x10, 4, 0, 0, 0x00, 0x41, 0x42, 0x43, 0x44]);
  const r = decompressLZ77(src);
  assert.deepEqual([...r.data], [0x41, 0x42, 0x43, 0x44]);
  assert.equal(r.compressedSize, 9);
  assert.deepEqual(r.tokens, { literals: 4, refs: 0 });
});

test('vector manual: referencia solapada (RLE con disp=1)', () => {
  // 'A' literal, luego ref len=(0x5+3)=8 disp=(0x000+1)=1 -> 9 x 'A'
  const src = Uint8Array.from([0x10, 9, 0, 0, 0b01000000, 0x41, 0x50, 0x00]);
  const r = decompressLZ77(src);
  assert.deepEqual([...r.data], Array(9).fill(0x41));
  assert.equal(r.vramUnsafe, true);
});

test('vector manual: referencia con desplazamiento 2 y longitud mínima 3', () => {
  // 'A','B' literales; ref len 3 disp 2 -> ABABA
  const src = Uint8Array.from([0x10, 5, 0, 0, 0b00100000, 0x41, 0x42, 0x00, 0x01]);
  assert.deepEqual([...decompressLZ77(src).data], [...'ABABA'].map((c) => c.charCodeAt(0)));
});

test('offset distinto de cero', () => {
  const body = Uint8Array.from([0x10, 2, 0, 0, 0x00, 7, 9]);
  const src = new Uint8Array(16); src.set(body, 8);
  assert.deepEqual([...decompressLZ77(src, 8).data], [7, 9]);
});

test('ida y vuelta: datos aleatorios, patrones y tiles sintéticos', () => {
  const cases = [randomBytes(1, 3), randomBytes(1000, 7), new Uint8Array(5000), patternTiles(64), randomBytes(70000, 11).map((b, i) => (i % 97 < 50 ? b : 0))];
  for (const input of cases) {
    for (const vramSafe of [true, false]) {
      const comp = compressLZ77(input, { vramSafe });
      assert.equal(comp.length % 4, 0);
      const r = decompressLZ77(comp);
      assert.deepEqual(r.data, input);
      if (vramSafe) assert.equal(r.vramUnsafe, false);
    }
  }
});

test('cabecera', () => {
  assert.deepEqual(readLZ77Header(Uint8Array.from([0x10, 0x00, 0x20, 0x00])), { type: 0x10, decompressedSize: 0x2000 });
  assert.equal(readLZ77Header(Uint8Array.from([0x11, 0, 0, 0])), null);
});

test('rechazo de flujos inválidos', () => {
  const bad = {
    'tipo incorrecto': Uint8Array.from([0x11, 4, 0, 0, 0, 1, 2, 3, 4]),
    'tamaño 0': Uint8Array.from([0x10, 0, 0, 0, 0]),
    'referencia sin historial': Uint8Array.from([0x10, 4, 0, 0, 0x80, 0x10, 0x00]),
    'referencia anterior al inicio': Uint8Array.from([0x10, 8, 0, 0, 0x40, 0x41, 0x00, 0x05]),
    'truncado': Uint8Array.from([0x10, 8, 0, 0, 0x00, 1, 2]),
    'excede tamaño declarado': Uint8Array.from([0x10, 3, 0, 0, 0x40, 0x41, 0xf0, 0x00]),
  };
  for (const [name, src] of Object.entries(bad)) assert.throws(() => decompressLZ77(src), LZ77Error, name);
  assert.throws(() => decompressLZ77(Uint8Array.from([0x10, 0x00, 0x00, 0x10]), 0, { maxSize: 0x1000 }), /máximo/);
});
