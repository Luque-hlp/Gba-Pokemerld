import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GBA } from '../src/emulator.js';
import { Bus, vramIndex } from '../src/memory/bus.js';
import { Timers } from '../src/hardware/timers.js';
import { Interrupts, IRQ } from '../src/hardware/interrupts.js';
import { Flash, Sram } from '../src/cartridge/saveMemory.js';
import { RTC, GPIO } from '../src/cartridge/gpio.js';
import { inspectRom, headerComplement, RomError } from '../src/cartridge/romLoader.js';
import { biosArcTan, biosArcTan2, findM4aTemplate } from '../src/bios/hle.js';
import { captureState, restoreState } from '../src/storage/saveState.js';
import { COLOR_LUT } from '../src/video/palette.js';

/** ROM sintética mínima: cabecera válida + un bucle infinito Thumb en el punto de entrada. */
function syntheticRom({ code = [0xe7fe], extra = (r) => r } = {}) {
  const rom = new Uint8Array(0x10000);
  const dv = new DataView(rom.buffer);
  dv.setUint32(0, 0xea00002e, true); // B 0x080000C0
  const put = (o, s) => { for (let i = 0; i < s.length; i++) rom[o + i] = s.charCodeAt(i); };
  put(0xa0, 'TESTROM'); put(0xac, 'ZTST'); put(0xb0, '01'); rom[0xb2] = 0x96;
  rom[0xbd] = headerComplement(rom);
  // 0xC0 (ARM): ADD r0, pc, #1 ; BX r0  → código Thumb en 0xC8
  dv.setUint32(0xc0, 0xe28f0001, true); dv.setUint32(0xc4, 0xe12fff10, true);
  code.forEach((h, i) => dv.setUint16(0xc8 + i * 2, h, true));
  return extra(rom);
}

// ------------------------------------------------------------------ memoria
test('bus: espejos de EWRAM/IWRAM/PAL/OAM/VRAM y escrituras de 8 bits', () => {
  const gba = new GBA();
  gba.loadRom(syntheticRom());
  const b = gba.bus;
  b.write32(0x02000010, 0x11223344); assert.equal(b.read32(0x02040010), 0x11223344);
  b.write16(0x03000020, 0xbeef); assert.equal(b.read16(0x03008020), 0xbeef);
  b.write8(0x05000003, 0x7f); assert.equal(b.read16(0x05000002), 0x7f7f); // paleta: byte duplicado
  b.write8(0x07000000, 0x55); assert.equal(b.read8(0x07000000), 0);       // OAM ignora bytes
  b.write8(0x06000001, 0x12); assert.equal(b.read16(0x06000000), 0x1212); // VRAM BG: duplicado
  b.write8(0x06010000, 0x12); assert.equal(b.read8(0x06010000), 0);       // VRAM OBJ: ignorado
  assert.equal(vramIndex(0x06018000), 0x10000); assert.equal(vramIndex(0x0601fffe), 0x17ffe);
  b.write16(0x06018004, 0xabcd); assert.equal(b.read16(0x06010004), 0xabcd);
});

test('bus: ROM de solo lectura, espejos de estados de espera y lectura fuera de la ROM', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const b = gba.bus;
  assert.equal(b.read8(0x080000b2), 0x96); assert.equal(b.read8(0x0a0000b2), 0x96); assert.equal(b.read8(0x0c0000b2), 0x96);
  b.write32(0x080000b0, 0); assert.equal(b.read8(0x080000b2), 0x96);
  assert.equal(b.read16(0x08100000), (0x100000 >> 1) & 0xffff); // más allá del tamaño: patrón de direcciones
});

test('bus: la BIOS solo es legible desde código de la BIOS', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  assert.equal(gba.bus.read32(0x18), gba.bus.biosLatch); // PC en la ROM: devuelve el último opcode de BIOS
});

// ------------------------------------------------------------------ timers
test('timers: prescaler, recarga, IRQ y cascada', () => {
  const irq = new Interrupts(); irq.ie = 0xffff;
  const t = new Timers(irq); const over = [];
  t.onOverflow = (i) => over.push(i);
  t.write(0, false, 0xfff0, 0); t.write(0, true, 0xc0, 0);     // timer 0: recarga 0xFFF0, IRQ, ÷1
  t.write(1, false, 0xfffe, 0); t.write(1, true, 0xc4, 0);     // timer 1: cascada, IRQ
  assert.equal(t.cyclesUntilOverflow(), 16);
  t.sync(16); assert.equal(t.read(0, false, 16), 0xfff0); assert.equal(irq.if & IRQ.TIMER0, IRQ.TIMER0);
  t.sync(48); // dos desbordamientos más del timer 0 → el 1 llega a 0x10000
  assert.equal(over.filter((x) => x === 0).length, 3);
  assert.equal(over.filter((x) => x === 1).length, 1); assert.equal(t.read(1, false, 48), 0xffff); // FFFE→FFFF→(desborda) FFFE→FFFF
  t.write(2, false, 0, 48); t.write(2, true, 0x81, 48);       // ÷64
  t.sync(48 + 64 * 10); assert.equal(t.read(2, false, 48 + 640), 10);
});

// ------------------------------------------------------------------ DMA
test('DMA: inmediata 32 bits, decremento, fija, repetición en HBlank y IRQ', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const b = gba.bus;
  for (let i = 0; i < 8; i++) b.write32(0x02000000 + i * 4, i + 1);
  b.write32(0x040000d4, 0x02000000); b.write32(0x040000d8, 0x03000000); b.write16(0x040000dc, 8);
  b.write16(0x040000de, 0x8400 | 0x4000); gba.irq.ie = 0xffff;
  assert.equal(b.read32(0x0300001c), 8); assert.equal(gba.irq.if & IRQ.DMA3, IRQ.DMA3);
  assert.equal(b.read16(0x040000de) & 0x8000, 0); // se apaga al terminar
  b.write32(0x040000d4, 0x0200001c); b.write32(0x040000d8, 0x03000100); b.write16(0x040000dc, 4);
  b.write16(0x040000de, 0x8400 | (1 << 7)); // origen decreciente
  assert.deepEqual([0, 4, 8, 12].map((o) => b.read32(0x03000100 + o)), [8, 7, 6, 5]);
  // HBlank con repetición: 1 unidad por línea, destino fijo
  b.write32(0x040000b0, 0x02000000); b.write32(0x040000b4, 0x03000200); b.write16(0x040000b8, 1);
  b.write16(0x040000ba, 0x8000 | 0x2000 | 0x0200 | (2 << 5) | 0x400);
  gba.dma.trigger(2); gba.dma.trigger(2);
  assert.equal(b.read32(0x03000200), 2); assert.equal(gba.dma.ch[0].active, true);
});

// ------------------------------------------------------------------ BIOS HLE
test('BIOS: ArcTan/ArcTan2 frente a Math.atan2 (error < 0,1°)', () => {
  assert.ok(Math.abs(biosArcTan(0x4000) - 0x2000) <= 2, `atan(1) = ${biosArcTan(0x4000)}`);
  for (const [x, y] of [[100, 0], [100, 100], [0, 100], [-100, 100], [-100, 0], [-100, -100], [0, -100], [100, -100], [3, 7], [-7, 3]]) {
    const ref = ((Math.atan2(y, x) / (2 * Math.PI)) * 0x10000 + 0x10000) % 0x10000;
    let d = Math.abs(biosArcTan2(x, y) - ref); d = Math.min(d, 0x10000 - d);
    assert.ok(d < 0x10000 / 3600, `(${x},${y}) → ${biosArcTan2(x, y)} vs ${ref.toFixed(1)}`);
  }
});

test('BIOS: Div, Sqrt, CpuSet (copia y relleno), CpuFastSet, LZ77 a VRAM, RL', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const { cpu, bus, bios } = gba, r = cpu.r;
  r[0] = (-7) >>> 0; r[1] = 2; bios.swi(0x06);
  assert.equal(r[0] | 0, -3); assert.equal(r[1] | 0, -1); assert.equal(r[3], 3);
  r[0] = 1000000; bios.swi(0x08); assert.equal(r[0], 1000);
  bus.write32(0x02000000, 0xaabbccdd);
  r[0] = 0x02000000; r[1] = 0x03000000; r[2] = (1 << 24) | (1 << 26) | 4; bios.swi(0x0b); // relleno 32 bits
  assert.deepEqual([0, 4, 8, 12].map((o) => bus.read32(0x03000000 + o)), Array(4).fill(0xaabbccdd));
  bus.write32(0x03000100 + 28, 0x5a5a5a5a);
  r[0] = 0x03000000; r[1] = 0x03000100; r[2] = 3; bios.swi(0x0c); // CpuFastSet redondea a 8 palabras
  assert.equal(bus.read32(0x0300010c), 0xaabbccdd); assert.equal(bus.read32(0x0300011c), 0); // la palabra 7 se copia (origen = 0)
  // LZ77: "ABABABAB" = A, B literales + referencia len 6 disp 2
  const lz = [0x10, 8, 0, 0, 0x20, 0x41, 0x42, 0x30, 0x01];
  lz.forEach((v, i) => bus.write8(0x02001000 + i, v));
  r[0] = 0x02001000; r[1] = 0x06000000; bios.swi(0x12);
  assert.equal(bus.read16(0x06000000), 0x4241); assert.equal(bus.read16(0x06000006), 0x4241);
  // RL: 3 literales "XYZ" + 5 × 'Q'
  [0x30, 8, 0, 0, 0x02, 0x58, 0x59, 0x5a, 0x82, 0x51].forEach((v, i) => bus.write8(0x02002000 + i, v));
  r[0] = 0x02002000; r[1] = 0x02003000; bios.swi(0x14);
  assert.equal(String.fromCharCode(...bus.ewram.subarray(0x3000, 0x3008)), 'XYZQQQQQ');
});

test('BIOS: ObjAffineSet (rotación de 90° y escala 2×)', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const { cpu, bus, bios } = gba, r = cpu.r;
  bus.write16(0x02000000, 0x200); bus.write16(0x02000002, 0x100); bus.write16(0x02000004, 0x4000); // sx=2, sy=1, 90°
  r[0] = 0x02000000; r[1] = 0x02000100; r[2] = 1; r[3] = 2; bios.swi(0x0f);
  const s16 = (a) => (bus.read16(a) << 16) >> 16;
  assert.deepEqual([s16(0x02000100), s16(0x02000102), s16(0x02000104), s16(0x02000106)], [0, -0x200, 0x100, 0]);
});

test('BIOS: VBlankIntrWait detiene la CPU y repite la SWI hasta que el manejador marca BIOS_IF', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const { cpu, bus, bios, irq } = gba;
  cpu.t = 1; cpu.branch(0x08000100); cpu.next = 0x08000102; // como si se acabase de ejecutar una SWI en 0x08000100
  bios.swi(0x05);
  assert.equal(irq.halted, true); assert.equal(cpu.next, 0x08000100); assert.equal(irq.ime, 1);
  bus.write16(0x03007ff8, 1); cpu.next = 0x08000102; bios.swi(0x05); // el manejador ya marcó el bit
  assert.equal(cpu.inIntrWait, false); assert.equal(bus.read16(0x03007ff8), 0);
});

test('BIOS: plantilla m4a localizada por forma', () => {
  const rom = new Uint8Array(0x1000); const dv = new DataView(rom.buffer);
  const fine = 0x08000101;
  for (let i = 0; i < 36; i++) dv.setUint32(0x400 + i * 4, [0, 5, 6, 7, 8].includes(i) ? fine : 0x08000201 + i * 0x10, true);
  assert.equal(findM4aTemplate(rom), 0x08000400);
  dv.setUint32(0x404, fine, true); // la entrada 1 igual a la 0: ya no es la plantilla
  assert.equal(findM4aTemplate(rom), null);
});

// ------------------------------------------------------------------ cartucho
test('cargador: cabecera, tipo de guardado, RTC y errores comprensibles', () => {
  const rom = syntheticRom({ extra: (r) => { const s = 'FLASH1M_V103 SIIRTC_V001'; for (let i = 0; i < s.length; i++) r[0x2000 + i] = s.charCodeAt(i); return r; } });
  const info = inspectRom(rom, 'test.gba');
  assert.equal(info.title, 'TESTROM'); assert.equal(info.checksumOk, true); assert.equal(info.saveType, 'flash128'); assert.equal(info.rtc, true);
  assert.ok(info.warnings.some((w) => /validado con Pokémon Esmeralda/.test(w)));
  assert.throws(() => inspectRom(new Uint8Array(10)), RomError);
  const zip = new Uint8Array(0x200); zip[0] = 0x50; zip[1] = 0x4b;
  assert.throws(() => inspectRom(zip, 'rom.zip'), /Descomprímelo/);
});

test('Flash 128 KiB: ID, escritura, borrado de sector y de chip, bancos', () => {
  const f = new Flash(0x20000);
  const cmd = (c) => { f.write8(0x5555, 0xaa); f.write8(0x2aaa, 0x55); f.write8(0x5555, c); };
  cmd(0x90); assert.deepEqual([f.read8(0), f.read8(1)], [0xc2, 0x09]); cmd(0xf0);
  cmd(0xa0); f.write8(0x1234, 0x42); assert.equal(f.read8(0x1234), 0x42); assert.equal(f.dirty, true);
  cmd(0xb0); f.write8(0, 1); cmd(0xa0); f.write8(0x10, 0x99); assert.equal(f.data[0x10010], 0x99);
  cmd(0xb0); f.write8(0, 0); assert.equal(f.read8(0x1234), 0x42);
  cmd(0x80); f.write8(0x5555, 0xaa); f.write8(0x2aaa, 0x55); f.write8(0x1000, 0x30); // borrar sector 1
  assert.equal(f.read8(0x1234), 0xff);
  cmd(0x80); cmd(0x10); assert.ok(f.data.every((b) => b === 0xff));
  const s = new Sram(); s.write8(0x9000, 7); assert.equal(s.read8(0x1000), 7); // espejo de 32 KiB
});

test('RTC por GPIO: protocolo del juego (comando MSB primero, datos LSB primero)', () => {
  const fixed = new Date(2025, 2, 14, 15, 9, 26).getTime();
  const rtc = new RTC(() => fixed), gpio = new GPIO(rtc);
  const W = (v) => gpio.write(0xc4, v);
  gpio.write(0xc8, 1);
  const cmd = (value) => { for (let i = 0; i < 8; i++) { const b = (value >> (7 - i)) & 1; W((b << 1) | 4); W((b << 1) | 5); } };
  const read = () => { let v = 0; for (let i = 0; i < 8; i++) { W(4); W(5); v = (v >> 1) | (((gpio.read(0xc4) & 2) >> 1) << 7); } return v; };
  W(1); W(5); gpio.write(0xc6, 7); cmd(0x65); gpio.write(0xc6, 5); // leer fecha y hora
  const bytes = Array.from({ length: 7 }, read);
  assert.deepEqual(bytes, [0x25, 0x03, 0x14, 0x05, 0x15, 0x09, 0x26]); // BCD: 25-03-14, viernes, 15:09:26
  W(1); W(5); gpio.write(0xc6, 7); cmd(0x63); gpio.write(0xc6, 5);
  assert.equal(read(), 0x40); // estado: 24 h, sin fallo de alimentación
});

test('puerto serie sin cable: entradas en alto y transferencia con reloj interno', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const b = gba.bus; gba.irq.ie = 0xffff;
  b.write16(0x04000134, 0x8000 | 0x10); // GP: SC salida, resto entradas
  assert.equal(b.read16(0x04000134) & 0xe, 0xe);
  b.write16(0x04000134, 0); b.write16(0x04000128, 0x4000 | 0x1000 | 0x80 | 1); // 32 bits, reloj interno, IRQ
  gba.serial.update(gba.now() + 100000);
  assert.equal(b.read16(0x04000128) & 0x80, 0); assert.equal(b.read16(0x04000120), 0xffff); assert.ok(gba.irq.if & IRQ.SERIAL);
});

// ------------------------------------------------------------------ vídeo
test('PPU: modo 3 (bitmap) y modo 0 con un tile, paleta y volteo horizontal', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const b = gba.bus;
  b.write16(0x04000000, 0x0403); b.write16(0x04000020, 0x100); b.write16(0x04000026, 0x100); // modo 3, BG2, PA=PD=1
  b.write16(0x06000000 + (5 * 240 + 7) * 2, 0x001f);
  gba.ppu.startLine(0); for (let y = 0; y < 160; y++) gba.ppu.renderLine(y);
  assert.equal(gba.ppu.framebuffer[5 * 240 + 7], COLOR_LUT[0x1f]);
  // Modo 0: BG0, tiles en 0x06000000, mapa en el screenblock 31; tile 1 con el píxel (0,0) = índice 1
  b.write16(0x04000000, 0x0100); b.write16(0x04000008, 31 << 8);
  b.write16(0x06000000 + 32, 0x0001); b.write16(0x05000002, 0x03e0); // tile 1, color 1 = verde
  b.write16(0x06000000 + 31 * 0x800, 1 | 0x400); // entrada (0,0): tile 1, volteo H
  gba.ppu.renderLine(0);
  assert.equal(gba.ppu.framebuffer[7], COLOR_LUT[0x3e0]); assert.equal(gba.ppu.framebuffer[0], COLOR_LUT[0]);
});

test('PPU: sprite 8×8 sobre fondo, ventana y oscurecimiento', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  const b = gba.bus;
  b.write16(0x04000000, 0x1040); // OBJ, mapeo 1D
  b.write16(0x06010000, 0x0011); // tile 0 OBJ: píxeles (0,0) y (1,0) índice 1
  b.write16(0x05000202, 0x7c00); // paleta OBJ 0, color 1 = azul
  b.write16(0x07000000, 10); b.write16(0x07000002, 20); b.write16(0x07000004, 0); // y=10, x=20
  gba.ppu.renderLine(10);
  assert.equal(gba.ppu.framebuffer[10 * 240 + 20], COLOR_LUT[0x7c00]);
  b.write16(0x04000050, 0x00d0); b.write16(0x04000054, 16); // oscurecer OBJ al 100 %
  gba.ppu.renderLine(10);
  assert.equal(gba.ppu.framebuffer[10 * 240 + 20], COLOR_LUT[0]);
  b.write16(0x04000000, 0x3040); b.write16(0x04000040, (0 << 8) | 16); b.write16(0x04000044, (0 << 8) | 160); // WIN0 = x 0..15
  b.write16(0x04000048, 0x0010); b.write16(0x0400004a, 0x0000); // dentro: OBJ sin efectos; fuera: nada
  gba.ppu.renderLine(10);
  assert.equal(gba.ppu.framebuffer[10 * 240 + 20], COLOR_LUT[0]); // fuera de la ventana: sprite oculto (backdrop)
});

// ------------------------------------------------------------------ integración
test('ROM sintética: arranque, interrupción de VBlank y estado rápido reversible', () => {
  const gba = new GBA(); gba.loadRom(syntheticRom());
  gba.runFrame();
  assert.equal(gba.cpu.t, 1); assert.equal(gba.cpu.next, 0x080000c8); // bucle infinito Thumb
  assert.equal(gba.ppu.vcount, 227);
  gba.bus.write32(0x02000000, 0x12345678);
  const s = captureState(gba);
  gba.bus.write32(0x02000000, 0); gba.runFrame();
  restoreState(gba, s);
  assert.equal(gba.bus.read32(0x02000000), 0x12345678); assert.equal(gba.cpu.next, 0x080000c8);
  assert.throws(() => restoreState(gba, { ...s, version: 99 }), /incompatible/);
});
