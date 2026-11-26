/**
 * Secuencias de animación de sprites de pokeemerald (ESPECÍFICO DEL JUEGO).
 * Fuente: include/sprite.h — union AnimCmd (4 bytes):
 *   s16 type: -1 = END, -2 = JUMP(target:6 en bits 16–21), -3 = LOOP(count:6 en bits 16–21);
 *   otro valor = FRAME: imageValue:16, duration:6, hFlip:1, vFlip:1.
 */
export const ANIM_END = -1, ANIM_JUMP = -2, ANIM_LOOP = -3;

/** Decodifica comandos hasta END/JUMP o `max` comandos. */
export function parseAnimCmds(bytes, offset, max = 64) {
  const cmds = [];
  for (let i = 0; i < max; i++) {
    const o = offset + i * 4;
    if (o + 4 > bytes.length) throw new RangeError('Secuencia de animación truncada');
    const w = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    const type = (w << 16) >> 16; // s16
    const hi = w >>> 16;
    if (type === ANIM_END) { cmds.push({ op: 'end' }); return cmds; }
    if (type === ANIM_JUMP) { cmds.push({ op: 'jump', target: hi & 63 }); return cmds; }
    if (type === ANIM_LOOP) { cmds.push({ op: 'loop', count: hi & 63 }); continue; }
    cmds.push({ op: 'frame', image: w & 0xffff, duration: hi & 63, hflip: !!(hi & 64), vflip: !!(hi & 128) });
  }
  throw new RangeError(`Sin END/JUMP en ${max} comandos`);
}

/** Expande comandos a una línea temporal [{image, frames}] (ticks de 1/60 s). Los bucles se desenrollan una vez. */
export function animTimeline(cmds) {
  return cmds.filter((c) => c.op === 'frame').map((c) => ({ image: c.image, ticks: Math.max(1, c.duration), hflip: c.hflip, vflip: c.vflip }));
}
