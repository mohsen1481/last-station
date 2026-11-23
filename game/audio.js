/** Audio: sampled SFX + a few synthesized ones, one quiet mix with a limiter. */
import { CFG } from "../config.js";

export class AudioSys {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.buffers = {};
    this.user = { master: CFG.defaults.master, music: CFG.defaults.music, sfx: CFG.defaults.sfx };
    if (!this.ctx) return;
    const c = this.ctx;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -16;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.master = c.createGain();
    this.sfx = c.createGain();
    this.music = c.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    // Master is deliberately capped well below full scale: the game should never be loud.
    this.master.gain.value = this.user.master * 0.7;
    this.sfx.gain.value = this.user.sfx;
    this.music.gain.value = this.user.music * 2 * CFG.mix.music;
  }
  setVolumes(v) {
    Object.assign(this.user, v);
    this.applyVolumes();
  }

  async load(name, url) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      this.buffers[name] = await this.ctx.decodeAudioData(data);
    } catch (e) {
      console.warn("audio failed", name, e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state !== "running") this.ctx.resume();
  }
  suspend() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
  }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  _out(vol, pos) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = vol;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 2.5;
      p.maxDistance = 60;
      p.rolloffFactor = 1.1;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  /** Play a sampled sound. Missing samples fall back to a synthesized burst. */
  play(name, { vol = 1, rate = 1, pos = null, offset = 0 } = {}) {
    if (!this.ctx) return;
    const buf = this.buffers[name];
    if (!buf) {
      if (name.startsWith("shot")) this.burst(0.18, 900, vol);
      return;
    }
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(this._out(vol, pos));
    s.start(0, offset);
  }

  startMusic() {
    if (!this.ctx || this.musicSrc || !this.buffers.music) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers.music;
    s.loop = true;
    s.connect(this.music);
    s.start();
    this.musicSrc = s;
    // faint tube hum under everything
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 100;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0.012;
    o.connect(f); f.connect(g); g.connect(this.music);
    o.start();
  }

  /** Filtered noise burst: footsteps, dry-fire, impacts. */
  burst(dur, freq, vol, type = "lowpass", pos = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this._out(1, pos));
    s.start(t, Math.random() * 0.5, dur + 0.02);
  }

  tone(freq, dur, vol, type = "sine", slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  step() { this.burst(0.09, 520 + Math.random() * 260, CFG.mix.step); }
  dry() { this.burst(0.03, 3200, 0.22, "highpass"); }
  hurt() { this.tone(110, 0.32, 0.4, "sine", -60); this.burst(0.12, 400, 0.25); }
  pickup() { this.tone(660, 0.1, 0.16, "triangle"); setTimeout(() => this.tone(990, 0.14, 0.14, "triangle"), 70); }
  switchWeapon() { this.burst(0.05, 1800, 0.16, "bandpass"); }
  waveHorn() { this.tone(62, 2.2, 0.3, "sawtooth", -14); this.tone(93, 2.2, 0.16, "sine", -20); }
  headPop() { this.burst(0.16, 700, 0.4); this.tone(180, 0.12, 0.2, "square", -120); }
  ricochet(pos) { this.burst(0.07, 2600 + Math.random() * 1500, 0.2, "bandpass", pos); }
  casing(pos) { this.tone(3800 + Math.random() * 1400, 0.07, 0.035, "sine"); }
}
