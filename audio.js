// ClipCreate Editor — Mejorar voz v1.2 (reducir ruido de verdad, aislar voz, normalizar y completar canal); v1.1: nivel final corregido. La misma cadena de Web Audio se usa al escuchar y al exportar,
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

// Reducir ruido: mira el sonido por frecuencias (ventanas de 1024 muestras), aprende el ruido de fondo de cada una
// (el mínimo de los últimos segundos) y baja solo esa parte. Así saca el ruido también mientras se habla.
const DENOISE = `
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
registerProcessor('cc-denoise', class extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'amount', defaultValue: 0.5 }]; }
  constructor() {
    super();
    const N = 1024, H = 256, B = N / 2 + 1;
    Object.assign(this, { N, H, pos: 0, win: new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)),
      inp: [new Float32Array(N), new Float32Array(N)], acc: [new Float32Array(N), new Float32Array(N)], oq: [new Float32Array(H), new Float32Array(H)],
      re: [new Float32Array(N), new Float32Array(N)], im: [new Float32Array(N), new Float32Array(N)],
      S: new Float32Array(B), Nz: new Float32Array(B).fill(1e9), G: new Float32Array(B).fill(1), rise: 1 + 2.5 / (sampleRate / H) });
  }
  frame(amt) {
    const { N, H, win, re, im, S, Nz, G } = this, B = N / 2 + 1, over = 1.2 + 2 * amt, floor = 10 ** (-(8 + 22 * amt) / 20);
    for (let c = 0; c < 2; c++) { for (let i = 0; i < N; i++) { re[c][i] = this.inp[c][i] * win[i]; im[c][i] = 0; } fft(re[c], im[c], false); }
    const g = new Float32Array(B);
    for (let k = 0; k < B; k++) {
      const P = (re[0][k] ** 2 + im[0][k] ** 2 + re[1][k] ** 2 + im[1][k] ** 2) / 2 + 1e-12;
      S[k] = S[k] ? 0.75 * S[k] + 0.25 * P : P;
      Nz[k] = Math.min(S[k], Nz[k] * this.rise);               // el ruido: el piso que se va encontrando
      g[k] = Math.max(floor, 1 - over * Nz[k] / S[k]);
    }
    for (let k = 0; k < B; k++) { // se suaviza entre frecuencias vecinas y en el tiempo (evita el sonido "de agua")
      const gs = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(B - 1, k + 1)]) / 4;
      G[k] = gs > G[k] ? 0.5 * G[k] + 0.5 * gs : 0.8 * G[k] + 0.2 * gs;
    }
    for (let c = 0; c < 2; c++) {
      for (let k = 0; k < B; k++) { re[c][k] *= G[k]; im[c][k] *= G[k]; if (k && k < N / 2) { re[c][N - k] = re[c][k]; im[c][N - k] = -im[c][k]; } }
      fft(re[c], im[c], true);
      const a = this.acc[c];
      for (let i = 0; i < N; i++) a[i] += re[c][i] / N * win[i] / 1.5;
      this.oq[c].set(a.subarray(0, H)); a.copyWithin(0, H); a.fill(0, N - H);
      this.inp[c].copyWithin(0, H);
    }
  }
  process([inp], [out], p) {
    const n = out[0].length, amt = p.amount[0];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) this.inp[c][this.N - this.H + this.pos] = inp.length ? (inp[c] || inp[0])[i] : 0;
      for (let c = 0; c < out.length; c++) out[c][i] = this.oq[Math.min(c, 1)][this.pos];
      if (++this.pos === this.H) { this.frame(amt); this.pos = 0; }
    }
    return true;
  }
});`;
const gateUrl = URL.createObjectURL(new Blob([GATE, DENOISE], { type: 'text/javascript' }));
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

// Herramientas de audio del clip (au), antes de «Mejorar voz»:
// completar canal (un micrófono que quedó de un solo lado), aislar voz, reducir ruido y normalizar intensidad.
export const auOn = au => !!au && (!!au.chan || au.den > 0 || !!au.iso || !!au.norm);
export function buildFx(ctx, c, withGate) {
  const au = c.au || {}, nodes = [], B = (type, frequency, Q = 0.7) => new BiquadFilterNode(ctx, { type, frequency, Q });
  if (au.chan === 'L' || au.chan === 'R') { // el canal elegido suena en los dos lados
    const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }), mg = new ChannelMergerNode(ctx, { numberOfInputs: 2 }), k = au.chan === 'L' ? 0 : 1;
    sp.connect(mg, k, 0); sp.connect(mg, k, 1);
    nodes.push({ input: sp, output: mg });
  }
  if (au.iso) nodes.push(B('highpass', 110), B('lowpass', 7800)); // aislar voz: fuera lo que no es voz
  const den = au.iso ? Math.max(0.85, au.den || 0) : au.den || 0;
  if (withGate && den > 0) nodes.push(new AudioWorkletNode(ctx, 'cc-denoise', { parameterData: { amount: den }, outputChannelCount: [2] }));
  if (au.norm) nodes.push(new GainNode(ctx, { gain: 10 ** (au.norm / 20) }));
  if (c.voz?.p) nodes.push(buildChain(ctx, c.voz, withGate));
  if (!nodes.length) return null;
  const io = n => n.input ? n : { input: n, output: n };
  nodes.map(io).reduce((a, b) => (a.output.connect(b.input), b));
  return { input: io(nodes[0]).input, output: io(nodes.at(-1)).output };
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
