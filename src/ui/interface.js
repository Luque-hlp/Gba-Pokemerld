/** Interfaz: conecta los elementos del DOM con eventos de la aplicación. Sin lógica de emulación. */
export class Interface {
  constructor(doc, { BUTTONS, BUTTON_LABELS }) {
    this.d = doc; this.handlers = {}; this.BUTTONS = BUTTONS; this.LABELS = BUTTON_LABELS; this.devOpen = false;
    const $ = (id) => doc.getElementById(id);
    this.$ = $;
    $('romInput').addEventListener('change', (e) => e.target.files[0] && this.emit('file', e.target.files[0]));
    const drop = $('dropZone');
    for (const t of [drop, $('screenWrap')]) {
      t.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      t.addEventListener('dragleave', () => drop.classList.remove('over'));
      t.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && this.emit('file', e.dataTransfer.files[0]); });
    }
    $('btnToggle').addEventListener('click', () => this.emit('toggle'));
    $('btnReset').addEventListener('click', () => this.emit('reset'));
    $('btnFull').addEventListener('click', () => this.emit('fullscreen'));
    $('volume').addEventListener('input', (e) => this.emit('volume', +e.target.value));
    $('mute').addEventListener('change', (e) => this.emit('mute', e.target.checked));
    $('speed').addEventListener('change', (e) => this.emit('speed', +e.target.value));
    $('btnExport').addEventListener('click', () => this.emit('exportSave'));
    $('importInput').addEventListener('change', (e) => { e.target.files[0] && this.emit('importSave', e.target.files[0]); e.target.value = ''; });
    $('btnSaveState').addEventListener('click', () => this.emit('saveState', +$('slot').value));
    $('btnLoadState').addEventListener('click', () => this.emit('loadState', +$('slot').value));
    $('btnResetKeys').addEventListener('click', () => this.emit('resetKeys'));
    $('btnDev').addEventListener('click', () => { this.devOpen = !this.devOpen; $('devPanel').hidden = !this.devOpen; this.emit('dev', this.devOpen); });
    $('traceOn').addEventListener('change', (e) => this.emit('trace', e.target.checked));
    $('memGo').addEventListener('click', () => { const v = parseInt($('memAddr').value.replace(/^0x/i, ''), 16); if (Number.isFinite(v)) this.emit('memAddr', v); });
    doc.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => {
      let m = 0; doc.querySelectorAll('[data-layer]').forEach((x) => { if (x.checked) m |= 1 << +x.dataset.layer; }); this.emit('layers', m);
    }));
    addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); $('btnDev').click(); } });
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { this.handlers[ev]?.(...a); }
  status(msg, error = false) { const s = this.$('status'); s.textContent = msg; s.classList.toggle('error', error); }
  fps(v) { this.$('fps').textContent = `${v.toFixed(0)} FPS`; }
  setRunning(on) {
    this.$('btnToggle').textContent = on ? 'Pausar' : 'Iniciar';
    this.$('btnToggle').disabled = false; this.$('btnReset').disabled = false;
    this.d.body.classList.toggle('running', on);
  }
  romInfo(info, m4a) {
    this.$('romMeta').innerHTML = `<b>${esc(info.title)}</b> · ${esc(info.gameCode)} · ${(info.size / 1048576).toFixed(0)} MiB · cabecera ${info.checksumOk ? 'válida' : '<span class="bad">con errores</span>'} · guardado ${esc(info.saveId ?? 'ninguno')}${info.rtc ? ' · RTC' : ''}${m4a ? '' : ' · <span class="bad">sin plantilla m4a</span>'}`;
    this.d.body.classList.add('loaded');
  }
  showKeymap(map) {
    const list = this.$('keymap');
    list.innerHTML = '';
    for (const b of this.BUTTONS) {
      const row = this.d.createElement('button');
      row.className = 'keyrow'; row.type = 'button';
      row.innerHTML = `<span>${this.LABELS[b]}</span><kbd>${esc(map[b].replace(/^Key|^Digit/, ''))}</kbd>`;
      row.addEventListener('click', () => { row.querySelector('kbd').textContent = '…'; this.emit('remap', b); });
      list.appendChild(row);
    }
  }
  download(blob, name) {
    const a = this.d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
