/**
 * Salida de audio con Web Audio API. Las muestras del sintetizador (32 768 Hz estéreo) se
 * remuestrean linealmente a la frecuencia del AudioContext dentro de un ScriptProcessorNode.
 * Se usa ScriptProcessor porque funciona también al abrir la página como archivo local, donde
 * AudioWorklet no puede cargar su módulo.
 */
import { SAMPLE_RATE } from './sound.js';

export class AudioOutput {
  constructor(synth) {
    this.synth = synth; this.ctx = null; this.node = null; this.gain = null; this.volume = 0.8; this.muted = false;
    this.tmpL = new Float32Array(16384); this.tmpR = new Float32Array(16384);
    this.pos = 0; this.lastL = 0; this.lastR = 0; this.underruns = 0;
  }
  /** Debe llamarse desde un gesto del usuario (política de reproducción automática de los navegadores). */
  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Este navegador no tiene Web Audio API');
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain(); this.gain.gain.value = this.muted ? 0 : this.volume;
    this.node = this.ctx.createScriptProcessor(2048, 0, 2);
    this.node.onaudioprocess = (e) => this.#fill(e.outputBuffer);
    this.node.connect(this.gain); this.gain.connect(this.ctx.destination);
  }
  #fill(buf) {
    const outL = buf.getChannelData(0), outR = buf.getChannelData(1), n = outL.length;
    const step = SAMPLE_RATE / this.ctx.sampleRate;
    const need = Math.ceil(n * step) + 2;
    // Si hay demasiado retraso (> 0,2 s), se descarta lo antiguo para no acumular latencia
    while (this.synth.available > SAMPLE_RATE * 0.2) this.synth.read(this.tmpL, this.tmpR, Math.min(4096, this.synth.available - SAMPLE_RATE * 0.1));
    const got = this.synth.read(this.tmpL, this.tmpR, Math.min(need, this.tmpL.length));
    if (got < need) this.underruns++;
    for (let i = 0; i < n; i++) {
      const p = i * step, k = p | 0, f = p - k;
      if (k + 1 < got) { outL[i] = this.tmpL[k] + (this.tmpL[k + 1] - this.tmpL[k]) * f; outR[i] = this.tmpR[k] + (this.tmpR[k + 1] - this.tmpR[k]) * f; this.lastL = outL[i]; this.lastR = outR[i]; }
      else { this.lastL *= 0.995; this.lastR *= 0.995; outL[i] = this.lastL; outR[i] = this.lastR; } // sin datos: atenuar sin chasquido
    }
  }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; if (this.gain) this.gain.gain.value = m ? 0 : this.volume; }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
