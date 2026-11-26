#!/usr/bin/env node
/**
 * Ejecución sin navegador para pruebas con una ROM local (herramienta de desarrollo, no se distribuye ROM).
 *   node tools/headless.mjs <rom.gba> --frames 600 --shots 120,300,600 --keys START@400:10,A@500:5 --out capturas/
 * --keys: TECLA@fotograma[:duración]. Guarda PNG del framebuffer en los fotogramas indicados.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { GBA } from '../src/emulator.js';
import { KEYS } from '../src/hardware/keypad.js';

const args = process.argv.slice(2);
const rom = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('frames', 300);
const shots = new Set(opt('shots', String(frames)).split(',').map(Number));
const out = opt('out', 'shots');
const keys = (opt('keys', '') || '').split(',').filter(Boolean).map((s) => { const [k, rest] = s.split('@'); const [f, d] = rest.split(':'); return { key: KEYS[k], from: +f, to: +f + (+(d ?? 5)) }; });
mkdirSync(out, { recursive: true });

function png(fb, w, h, file) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(fb.buffer, fb.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const logs = new Map();
const gba = new GBA({ log: (lvl, msg) => { const k = `[${lvl}] ${msg}`; logs.set(k, (logs.get(k) || 0) + 1); } });
const bytes = new Uint8Array(readFileSync(rom));
const info = gba.loadRom(bytes, rom);
console.log('ROM:', info.title, info.gameCode, 'guardado', info.saveType, info.saveId, 'RTC', info.rtc, 'm4a', gba.bios.m4aTemplate?.toString(16));
const t0 = performance.now();
for (let f = 1; f <= frames; f++) {
  for (const k of keys) gba.keypad.set(k.key, f >= k.from && f < k.to);
  gba.runFrame();
  if (shots.has(f)) png(gba.ppu.framebuffer, 240, 160, `${out}/f${String(f).padStart(5, '0')}.png`);
}
const ms = performance.now() - t0;
console.log(`${frames} fotogramas en ${(ms / 1000).toFixed(2)} s → ${(frames / (ms / 1000)).toFixed(1)} fps; PC 0x${gba.cpu.next.toString(16)} ${gba.cpu.t ? 'Thumb' : 'ARM'} modo 0x${gba.cpu.mode.toString(16)}`);
console.log('SWI:', [...gba.bios.calls].map((n, i) => n ? `${i.toString(16)}:${n}` : null).filter(Boolean).join(' '));
console.log('IRQ:', [...gba.irq.counts].join(','), 'IE', gba.irq.ie.toString(16), 'IME', gba.irq.ime, 'DISPCNT', gba.io.regs[0].toString(16));
if (gba.io.unknownWrites.size) console.log('E/S sin implementar:', [...gba.io.unknownWrites].map(([k, v]) => `0x${k.toString(16)}×${v}`).join(' '));
for (const [k, v] of [...logs].slice(0, 20)) console.log(v > 1 ? `${k} (×${v})` : k);
