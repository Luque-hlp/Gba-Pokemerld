/**
 * Demo del motor: carga un pack (el de demostración o uno del usuario) y, si contiene los recursos
 * esperados (tilemap con 2 capas + sprite animado), permite moverse por el mapa. Con otros packs muestra
 * el primer tilemap y el primer sprite disponibles.
 */
import { Engine } from '../src/engine/Engine.js';
import { buildDemoPack } from '../src/demo/demoPack.js';
import { hexToRGBA } from '../src/engine/PaletteManager.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const keys = new Set();
addEventListener('keydown', (e) => { if (/^(Arrow|Key[WASD])/.test(e.code)) { keys.add(e.code); e.preventDefault(); } });
addEventListener('keyup', (e) => keys.delete(e.code));
$('screen').addEventListener('click', () => $('screen').focus());

let stop = null, engine = null;

function start(pack, label) {
  stop?.();
  engine = new Engine({ width: 240, height: 160, backdrop: '#000000' });
  try { engine.loadPack(pack); }
  catch (e) { showLog(engine.log); $('status').textContent = `${label}: inválido`; return; }
  showLog(engine.log);
  const mapId = Object.keys(pack.tilemaps ?? {})[0];
  if (mapId) for (let l = 0; l < pack.tilemaps[mapId].layers.length; l++) engine.addBackground(mapId, { layer: l, priority: l });
  const spriteId = Object.keys(pack.sprites ?? {})[0];
  const animId = Object.entries(pack.animations ?? {}).find(([, a]) => a.sprite === spriteId)?.[0];
  const mapSize = mapId ? engine.tilemaps.size(mapId) : { width: 240, height: 160 };
  const hero = spriteId ? engine.sprites.spawn(spriteId, { x: mapSize.width / 2, y: mapSize.height / 2, priority: 1, animation: animId }) : null;
  const hasWalk = animId && pack.animations[animId].sequences.length >= 6;

  // Colisión sencilla para el pack de demostración: agua (tile 7) y cualquier tile de la capa superior
  const blocked = (px, py) => {
    if (!mapId) return false;
    const m = pack.tilemaps[mapId], tx = Math.floor(px / 8), ty = Math.floor(py / 8);
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return true;
    const i = ty * m.width + tx;
    return (m.layers[0].entries[i] & 0x3ff) === 7 || (m.layers[1]?.entries[i] & 0x3ff) > 0;
  };
  let facing = 'down', moving = false, anim = -1, fadeT = 0, fading = 0;
  // Packs genéricos: elegir secuencia (por defecto la 1 si existe: en sprites de pokeemerald la 0 es un fotograma fijo)
  const seqs = animId ? pack.animations[animId].sequences : [];
  $('seqSel').innerHTML = seqs.map((q, k) => `<option value="${k}">${k}: ${q.length} comandos</option>`).join('') || '<option>—</option>';
  $('seqSel').disabled = !seqs.length || hasWalk;
  if (hero?.anim && !hasWalk && seqs.length) { anim = seqs.length > 1 ? 1 : 0; $('seqSel').value = String(anim); hero.anim.start(anim); }
  $('seqSel').onchange = () => { if (hero?.anim) { anim = +$('seqSel').value; hero.anim.start(anim); } };
  const water = pack.palettes.field ? pack.palettes.field.colors.slice(13, 16) : null;

  engine.onTick = (e) => {
    if (!hero) { // sin sprites: las flechas desplazan la cámara
      const sp = 2;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) e.camera.x -= sp; if (keys.has('ArrowRight') || keys.has('KeyD')) e.camera.x += sp;
      if (keys.has('ArrowUp') || keys.has('KeyW')) e.camera.y -= sp; if (keys.has('ArrowDown') || keys.has('KeyS')) e.camera.y += sp;
      e.camera.x = Math.max(0, Math.min(Math.max(0, mapSize.width - e.width), e.camera.x));
      e.camera.y = Math.max(0, Math.min(Math.max(0, mapSize.height - e.height), e.camera.y));
    }
    if (hero && !hasWalk) {
      if (hero.anim?.ended && $('repeat').checked) hero.anim.start(anim); // conveniencia de la demo, no del juego
      e.camera.x = 0; e.camera.y = 0;
    } else if (hero) {
      let dx = 0, dy = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) dx = -1; else if (keys.has('ArrowRight') || keys.has('KeyD')) dx = 1;
      else if (keys.has('ArrowUp') || keys.has('KeyW')) dy = -1; else if (keys.has('ArrowDown') || keys.has('KeyS')) dy = 1;
      moving = !!(dx || dy);
      if (dx) facing = dx < 0 ? 'left' : 'right'; else if (dy) facing = 'down';
      const nx = hero.x + dx, ny = hero.y + dy;
      const w = engine.sprites.def(hero.sprite).frameWidth, h = engine.sprites.def(hero.sprite).frameHeight;
      if (moving && ![[nx + 3, ny + h - 3], [nx + w - 4, ny + h - 3]].some(([x, y]) => blocked(x, y))) { hero.x = nx; hero.y = ny; }
      if (hasWalk) {
        const want = facing === 'down' ? (moving ? 1 : 0) : facing === 'right' ? (moving ? 3 : 2) : (moving ? 5 : 4);
        if (want !== anim) { anim = want; hero.anim.start(want); }
      }
      e.camera.x = Math.max(0, Math.min(mapSize.width - e.width, hero.x + w / 2 - e.width / 2));
      e.camera.y = Math.max(0, Math.min(mapSize.height - e.height, hero.y + h / 2 - e.height / 2));
    }
    // ciclo de paleta del agua (rota 3 colores cada 12 ticks), como las animaciones de paleta del GBA
    if (water && $('cycle').checked && e.ticks % 12 === 0) {
      const k = (e.ticks / 12) % 3;
      for (let i = 0; i < 3; i++) e.palettes.setBase('field', 13 + i, hexToRGBA(water[(i + k) % 3]));
    }
    if (fading) { fadeT = Math.max(0, Math.min(1, fadeT + fading / 40)); e.palettes.fade(fadeT); if (fadeT === 0 || fadeT === 1) fading = fadeT === 1 ? -1 : 0; if (fadeT === 0) e.palettes.reset(); }
    if (e.ticks % 6 === 0) $('info').textContent = `tick ${e.ticks}\n${hero ? `sprite ${hero.sprite}  x=${hero.x} y=${hero.y}\nfotograma ${hero.frame}  hflip=${hero.hflip}\nanimación ${anim}  cmd ${hero.anim?.cmdIndex}  delay ${hero.anim?.delay}` : 'sin sprites'}\ncámara ${engine.camera.x | 0},${engine.camera.y | 0}`;
  };
  $('fade').onclick = () => { fading = 1; };
  $('topLayer').onchange = () => { engine.background.forEach((b) => { if (b.layer === 1) b.hidden = !$('topLayer').checked; }); };
  const origDraw = engine.draw.bind(engine);
  engine.draw = (ctx) => { const saved = engine.background; engine.background = saved.filter((b) => !b.hidden); origDraw(ctx); engine.background = saved; };
  stop = engine.run($('screen'));
  $('status').textContent = `${label} — ${pack.meta?.name ?? 'sin nombre'} · licencia: ${pack.meta?.license ?? 'no declarada'}`;
  $('screen').focus();
}

function showLog(log) {
  $('log').innerHTML = log.length ? log.map((l) => `<div class="logitem ${l.level}">[${l.level}] ${esc(l.message)}</div>`).join('') : '<span class="hint">Sin errores ni advertencias.</span>';
}

$('demo').onclick = () => start(buildDemoPack(), 'Demo');
$('packFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { start(JSON.parse(await f.text()), f.name); }
  catch (err) { showLog([{ level: 'error', message: `${f.name}: JSON no válido (${err.message})` }]); }
};
start(buildDemoPack(), 'Demo');
