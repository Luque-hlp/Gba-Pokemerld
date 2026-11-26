/**
 * Arranque de la aplicación web: cargador de ROM (File API, todo en local), bucle de emulación con
 * requestAnimationFrame, salida de vídeo en Canvas 240×160 y conexión de audio, controles y guardado.
 */
import { GBA, CYCLES_PER_FRAME, CPU_HZ } from './emulator.js';
import { RomError, crc32 } from './cartridge/romLoader.js';
import { AudioOutput } from './audio/webAudio.js';
import { Controls, BUTTONS, BUTTON_LABELS } from './ui/controls.js';
import { SaveManager } from './storage/saveManager.js';
import { captureState, restoreState } from './storage/saveState.js';
import { Logger } from './debug/logger.js';
import { Debugger } from './debug/debugger.js';
import { Interface } from './ui/interface.js';

const FRAME_MS = 1000 / (CPU_HZ / CYCLES_PER_FRAME); // ≈ 16,743 ms (59,73 Hz)

const logger = new Logger();
const gba = new GBA({ log: (lvl, msg) => logger.log(lvl, msg) });
const audio = new AudioOutput(gba.synth);
const controls = new Controls(gba.keypad);
const ui = new Interface(document, { BUTTONS, BUTTON_LABELS });
const dbg = new Debugger(gba, document.getElementById('devPanel'), logger);

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const image = new ImageData(new Uint8ClampedArray(gba.ppu.framebuffer.buffer), 240, 160);

let running = false, loaded = false, saves = null, raf = 0, last = 0, acc = 0, speed = 1;
let fpsFrames = 0, fpsTime = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!running) { last = now; return; }
  acc += Math.min(now - last, 100) * speed; last = now;
  let n = 0;
  try {
    while (acc >= FRAME_MS && n < 4) { gba.runFrame(); acc -= FRAME_MS; n++; fpsFrames++; }
  } catch (e) {
    running = false; logger.log('error', `Excepción del emulador: ${e.message}`); ui.status(`Error del emulador: ${e.message}`, true); console.error(e);
  }
  if (n) ctx.putImageData(image, 0, 0);
  saves?.tick();
  if (now - fpsTime > 1000) { dbg.fps = (fpsFrames * 1000) / (now - fpsTime); fpsFrames = 0; fpsTime = now; ui.fps(dbg.fps); if (ui.devOpen) dbg.render(); }
}

async function loadFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = gba.loadRom(bytes, file.name);
    const key = `${info.gameCode}-${crc32(bytes).toString(16)}`;
    saves = new SaveManager(key, gba.bus.save, { onStatus: (m) => ui.status(m) });
    let restored = false;
    try { restored = await saves.load(); } catch (e) { logger.log('warn', `No se pudo leer IndexedDB: ${e.message}`); }
    loaded = true;
    ui.romInfo(info, gba.bios.m4aTemplate);
    info.warnings.forEach((w) => logger.log('warn', w));
    ui.status(`${info.title} (${info.gameCode}) cargado · guardado: ${info.saveType}${info.rtc ? ' · reloj RTC' : ''}${restored ? ' · partida del navegador recuperada' : ''}`);
    await start();
  } catch (e) {
    const msg = e instanceof RomError ? e.message : `No se pudo cargar el archivo: ${e.message}`;
    logger.log('error', msg); ui.status(msg, true);
  }
}

async function start() {
  if (!loaded) return;
  try { await audio.start(); } catch (e) { logger.log('warn', `Audio no disponible: ${e.message}`); }
  running = true; ui.setRunning(true); canvas.focus();
}
function pause() { running = false; ui.setRunning(false); audio.suspend(); controls.releaseAll(); }

// ---------------------------------------------------------------- eventos de la interfaz
ui.on('file', loadFile);
ui.on('toggle', () => (running ? pause() : start()));
ui.on('reset', () => { if (!loaded) return; gba.reset(); ui.status('Reiniciado'); });
ui.on('fullscreen', () => (document.fullscreenElement ? document.exitFullscreen() : document.getElementById('screenWrap').requestFullscreen?.()));
ui.on('volume', (v) => audio.setVolume(v));
ui.on('mute', (m) => audio.setMuted(m));
ui.on('speed', (v) => { speed = v; });
ui.on('remap', async (btn) => { ui.status(`Pulsa la tecla para ${BUTTON_LABELS[btn]}…`); const code = await controls.remap(btn); ui.showKeymap(controls.map); ui.status(`${BUTTON_LABELS[btn]} → ${code}`); });
ui.on('resetKeys', () => { controls.resetMap(); ui.showKeymap(controls.map); });
ui.on('exportSave', () => {
  if (!saves?.mem) return ui.status('No hay memoria de guardado que exportar.', true);
  ui.download(saves.exportBlob(), `${gba.info.gameCode}.sav`);
});
ui.on('importSave', async (file) => {
  try { await saves.import(new Uint8Array(await file.arrayBuffer())); gba.reset(); ui.status('Partida importada. El juego se ha reiniciado para leerla.'); }
  catch (e) { ui.status(e.message, true); }
});
ui.on('saveState', async (slot) => { if (!loaded) return; await saves.saveState(slot, captureState(gba)); ui.status(`Estado rápido ${slot} guardado (no sustituye al guardado del juego)`); });
ui.on('loadState', async (slot) => {
  if (!loaded) return;
  try { const s = await saves.loadState(slot); if (!s) return ui.status(`El estado ${slot} está vacío.`, true); restoreState(gba, s); ui.status(`Estado rápido ${slot} cargado`); }
  catch (e) { ui.status(e.message, true); }
});
ui.on('dev', (open) => { if (open) dbg.render(); });
ui.on('trace', (on) => dbg.setTrace(on));
ui.on('memAddr', (a) => { dbg.memAddr = a; dbg.render(); });
ui.on('layers', (mask) => { gba.ppu.layerMask = mask; });

controls.bindTouch(document.getElementById('pad'));
ui.showKeymap(controls.map);
document.addEventListener('visibilitychange', () => { if (document.hidden && running) pause(); });
addEventListener('beforeunload', () => { if (saves?.mem?.dirty) saves.persist(); });
raf = requestAnimationFrame(frame);
