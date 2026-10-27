/**
 * Stadionton mit der Web-Audio-API – komplett synthetisch, ohne Audiodateien:
 * Grundrauschen der Zuschauer, Raunen bei Chancen, Torjubel, Pfiffe.
 * Einstellung (an/aus, Lautstärke) liegt pro Gerät im lokalen Speicher.
 */
const KEY = "fl-sound";

export interface SoundPrefs { on: boolean; volume: number }

export function soundPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return { on: v.on !== false, volume: typeof v.volume === "number" ? Math.min(1, Math.max(0, v.volume)) : 0.6 };
    }
  } catch { /* Speicher nicht verfügbar */ }
  return { on: true, volume: 0.6 };
}

export function saveSoundPrefs(p: SoundPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignorieren */ }
  engine?.apply();
}

class Stadium {
  ctx: AudioContext;
  master: GainNode;
  crowd: GainNode;
  noise: AudioBuffer;
  ambient: AudioBufferSourceNode | null = null;
  level = 0.25;

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.crowd = this.ctx.createGain();
    this.crowd.gain.value = 0;
    this.crowd.connect(this.master);
    this.noise = this.pinkNoise(4);
    this.apply();
  }

  apply() {
    const p = soundPrefs();
    this.master.gain.setTargetAtTime(p.on ? p.volume : 0, this.ctx.currentTime, 0.05);
  }

  /** Rosa Rauschen klingt wie eine entfernte Menge. */
  pinkNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  startAmbient() {
    if (this.ambient) return;
    const src = this.noiseSource(true);
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 520;
    band.Q.value = 0.45;
    // Leichtes Wogen der Menge
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 0.13;
    depth.gain.value = 0.06;
    lfo.connect(depth).connect(this.crowd.gain);
    lfo.start();
    src.connect(band).connect(this.crowd);
    src.start();
    this.ambient = src;
    this.setLevel(this.level);
  }

  stopAmbient() {
    this.crowd.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    const a = this.ambient;
    this.ambient = null;
    if (a) setTimeout(() => { try { a.stop(); } catch { /* bereits gestoppt */ } }, 1500);
  }

  setLevel(v: number) {
    this.level = v;
    if (this.ambient) this.crowd.gain.setTargetAtTime(v, this.ctx.currentTime, 0.6);
  }

  /** Rauschstoss mit Hüllkurve: Jubel, Raunen, Pfiffe der Fans. */
  burst(o: { gain: number; attack: number; hold: number; release: number; freq: number; to?: number; q?: number }) {
    const t = this.ctx.currentTime;
    const src = this.noiseSource(true);
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = o.q ?? 0.7;
    band.frequency.setValueAtTime(o.freq, t);
    if (o.to) band.frequency.exponentialRampToValueAtTime(o.to, t + o.attack + o.hold);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + o.attack);
    g.gain.setValueAtTime(o.gain, t + o.attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.hold + o.release);
    src.connect(band).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + o.attack + o.hold + o.release + 0.1);
  }

  /** Schiedsrichterpfiff (Trillerpfeife): kurz, lang oder dreifach. */
  whistle(kind: "short" | "long" | "triple") {
    const parts = kind === "triple" ? [[0, 0.35], [0.5, 0.35], [1.0, 1.1]] : kind === "long" ? [[0, 0.9]] : [[0, 0.22]];
    for (const [at, len] of parts) {
      const t = this.ctx.currentTime + at;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      // Triller: schnelle Amplitudenmodulation durch die Kugel in der Pfeife
      const trill = this.ctx.createGain();
      trill.gain.value = 0.6;
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = "square";
      lfo.frequency.value = 28;
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain).connect(trill.gain);
      for (const f of [2950, 3110]) {
        const o = this.ctx.createOscillator();
        o.frequency.value = f;
        o.connect(trill);
        o.start(t);
        o.stop(t + len + 0.05);
      }
      trill.connect(g).connect(this.master);
      lfo.start(t);
      lfo.stop(t + len + 0.05);
    }
  }
}

let engine: Stadium | null = null;

function get(): Stadium | null {
  if (typeof window === "undefined" || !soundPrefs().on) return engine;
  try {
    engine ??= new Stadium();
    if (engine.ctx.state === "suspended") void engine.ctx.resume();
  } catch {
    return null; // Kein Web Audio verfügbar
  }
  return engine;
}

/** Ton für ein Spielereignis. mine: betrifft das eigene Team; home: das eigene Team spielt zu Hause. */
export function playEvent(type: string, mine: boolean, home: boolean) {
  const s = get();
  if (!s || !soundPrefs().on) return;
  // Die Mehrheit im Stadion hält zum Heimteam
  const homeCrowd = mine === home;
  switch (type) {
    case "kickoff": s.whistle("short"); break;
    case "halftime": s.whistle("long"); break;
    case "fulltime": s.whistle("triple"); break;
    case "foul": case "freekick": case "offside": s.whistle("short"); break;
    case "yellow": case "red":
      s.whistle("short");
      s.burst({ gain: 0.22, attack: 0.15, hold: 0.4, release: 0.9, freq: 900, to: 1300, q: 1.2 }); // Pfiffe
      break;
    case "chance": case "save": case "miss": case "penalty_miss":
      // Raunen: steigt an und fällt enttäuscht ab
      s.burst({ gain: homeCrowd ? 0.5 : 0.25, attack: 0.35, hold: 0.25, release: 1.2, freq: 380, to: 820 });
      break;
    case "goal": case "penalty_goal": case "own_goal": {
      // Das Ereignis gehört zum begünstigten Team
      if (homeCrowd) {
        s.burst({ gain: 1, attack: 0.12, hold: 2.6, release: 3, freq: 700, to: 1050, q: 0.5 });
        s.burst({ gain: 0.45, attack: 0.3, hold: 2.2, release: 2.5, freq: 1600, q: 0.9 });
      } else {
        // Gästeblock jubelt, der Rest stöhnt
        s.burst({ gain: 0.35, attack: 0.15, hold: 1.6, release: 2, freq: 900, q: 0.8 });
        s.burst({ gain: 0.4, attack: 0.2, hold: 0.3, release: 1.6, freq: 420, to: 220, q: 0.8 });
      }
      break;
    }
  }
}

/** Grundgeräusch der Zuschauer; Pegel steigt bei knappen Spielständen und gegen Ende. */
export function crowd(on: boolean, level = 0.25) {
  const s = on ? get() : engine;
  if (!s) return;
  if (on) {
    s.startAmbient();
    s.setLevel(level);
  } else s.stopAmbient();
}
