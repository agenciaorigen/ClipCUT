// ClipCreate Editor — Mejorar voz v1.1 (nivel final corregido). La misma cadena de Web Audio se usa al escuchar y al exportar,
// así lo que oís es lo que sale. Todo se procesa en la compu.

// Perfiles: filtro de graves, calidez, menos "voz de caja", presencia, aire, eses, nivelado y nivel final
export const PROFILES = {
  podcast:    { label: 'Podcast',    hp: 80,  warm: 2, mud: -2, pres: 3, air: 1, ess: -2,   thr: -24, ratio: 3,   target: -17, noise: 0.5 },
  entrevista: { label: 'Entrevista', hp: 90,  warm: 0, mud: -2, pres: 2, air: 0, ess: -1.5, thr: -22, ratio: 2.5, target: -18, noise: 0.4 },
  viral:      { label: 'Voz viral',  hp: 100, warm: 1, mud: -3, pres: 5, air: 2, ess: -2.5, thr: -28, ratio: 4.5, target: -15, noise: 0.6 }
};

// Compuerta suave: baja el ruido de fondo entre frases (no lo saca de abajo de la voz)
const GATE = `registerProcessor('cc-gate', class extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'thr', defaultValue: -50 }, { name: 'range', defaultValue: -12 }]; }
  constructor() { super(); this.ms = 0; this.g = 1; this.hold = 0;
    this.avg = 1 - Math.exp(-1 / (0.02 * sampleRate)); this.att = 1 - Math.exp(-1 / (0.004 * sampleRate)); this.rel = 1 - Math.exp(-1 / (0.12 * sampleRate)); }
  process([inp], [out], p) {
    if (!inp.length) return true;
    const thr = 10 ** (p.thr[0] / 20), floor = 10 ** (p.range[0] / 20), n = inp[0].length, hold = 0.08 * sampleRate;
    for (let i = 0; i < n; i++) {
      let m = 0; for (const ch of inp) m += ch[i] * ch[i];
      this.ms += (m / inp.length - this.ms) * this.avg; // nivel promedio de los últimos 20 ms (como el análisis)
      if (Math.sqrt(this.ms) > thr) this.hold = hold; else if (this.hold > 0) this.hold--;
      const target = this.hold > 0 ? 1 : floor;
      this.g += (target - this.g) * (target > this.g ? this.att : this.rel);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * this.g;
    }
    return true;
  }
});`;
const gateUrl = URL.createObjectURL(new Blob([GATE], { type: 'text/javascript' }));
const ready = new WeakMap();
export const loadGate = ctx => {
  if (!ready.has(ctx)) ready.set(ctx, ctx.audioWorklet ? ctx.audioWorklet.addModule(gateUrl).then(() => true, () => false) : Promise.resolve(false));
  return ready.get(ctx);
};

// Ajustes finales de una voz: el perfil más lo que se movió a mano
export function settings(v) {
  const p = PROFILES[v.p] || PROFILES.entrevista;
  return { ...p, noise: v.noise ?? p.noise, pres: v.clarity ?? p.pres, ratio: 1 + (v.level ?? 0.5) * 2 * (p.ratio - 1), gain: v.gain ?? 0, floor: v.floor ?? -60, hum: v.hum !== false };
}

// Arma la cadena: entrada → graves → zumbido → compuerta → ecualizador → nivel → compresor → limitador → salida
export function buildChain(ctx, v, withGate) {
  const s = settings(v), B = (type, frequency, gain = 0, Q = 0.9) => new BiquadFilterNode(ctx, { type, frequency, gain, Q });
  const nodes = [B('highpass', s.hp, 0, 0.7)];
  if (s.hum) nodes.push(B('notch', 50, 0, 30), B('notch', 100, 0, 30), B('notch', 150, 0, 30)); // la corriente en Argentina es de 50 Hz
  if (withGate && s.noise > 0) nodes.push(new AudioWorkletNode(ctx, 'cc-gate', {
    parameterData: { thr: Math.min(s.floor + 9, -28 - s.gain), range: -24 * s.noise }, outputChannelCount: [2]
  }));
  nodes.push(B('lowshelf', 160, s.warm), B('peaking', 300, s.mud, 1), B('peaking', 3200, s.pres), B('highshelf', 10000, s.air), B('peaking', 7000, s.ess, 3));
  nodes.push(new GainNode(ctx, { gain: 10 ** (s.gain / 20) }));                // nivel parejo (sale del análisis)
  nodes.push(new DynamicsCompressorNode(ctx, { threshold: s.thr, knee: 8, ratio: s.ratio, attack: 0.005, release: 0.2 }));
  // devuelve lo que bajó el compresor y descuenta la ganancia automática que le suma el navegador
  // (en Web Audio, cada compresor sube solo 0,6 × lo que comprimiría una señal a 0 dB)
  const auto = r => 0.6 * -r.thr * (1 - 1 / r.ratio);
  nodes.push(new GainNode(ctx, { gain: 10 ** ((s.target + 18 + Math.max(0, -18 - s.thr) * (1 - 1 / s.ratio) - auto(s) - auto({ thr: -2, ratio: 20 })) / 20) }));
  nodes.push(new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 })); // limitador
  nodes.reduce((a, b) => (a.connect(b), b));
  return { input: nodes[0], output: nodes.at(-1), nodes };
}

// Mide la voz y el ruido de fondo de un tramo: con eso se nivela el volumen y se ajusta la compuerta
export async function analyze(M, track, a, b, onProgress) {
  const sink = new M.AudioBufferSink(track), frames = [];
  let acc = 0, cnt = 0, hop = 0;
  for await (const w of sink.buffers(a, b)) {
    const buf = w.buffer, chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    hop ||= Math.round(buf.sampleRate * 0.05);
    for (let i = 0; i < buf.length; i++) {
      let x = 0; for (const d of chs) x += d[i]; x /= chs.length;
      acc += x * x;
      if (++cnt === hop) { frames.push(Math.sqrt(acc / hop)); acc = cnt = 0; }
    }
    onProgress?.(Math.min(1, (w.timestamp - a) / (b - a)));
  }
  if (frames.length < 10) return null;
  const db = x => 20 * Math.log10(Math.max(x, 1e-6)), top = Math.max(...frames);
  const voiced = frames.filter(x => x > top * 0.1).sort((x, y) => x - y), all = frames.slice().sort((x, y) => x - y);
  const voice = db(voiced[Math.floor(voiced.length * 0.6)] || 0.05), floor = db(all[Math.floor(all.length * 0.1)]);
  return { gain: Math.max(-12, Math.min(18, -18 - voice)), floor: Math.round(floor) };
}
