// ClipCreate Editor — biblioteca propia v1.0: efectos de sonido, música, gráficos y LUTs generados desde cero
// en el navegador. No hay archivos de terceros: todo es original de ClipCreate y se puede usar sin pedir permiso.
const SR = 48000;

// ---------- Sonido ----------
async function render(dur, build) {
  const ctx = new OfflineAudioContext(2, Math.round(dur * SR), SR);
  build(ctx, ctx.destination);
  return ctx.startRendering();
}
function noise(ctx, dur) {
  const b = ctx.createBuffer(1, Math.max(1, Math.round(dur * SR)), SR), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return new AudioBufferSourceNode(ctx, { buffer: b });
}
const env = (ctx, pts) => { const g = new GainNode(ctx, { gain: 0 }); for (const [t, v, how] of pts) how === 'exp' ? g.gain.exponentialRampToValueAtTime(Math.max(v, 1e-4), t) : g.gain.linearRampToValueAtTime(v, t); return g; };
const osc = (ctx, type, f0, f1, t1) => { const o = new OscillatorNode(ctx, { type, frequency: f0 }); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t1); return o; };
const BP = (ctx, type, f, Q = 1) => new BiquadFilterNode(ctx, { type, frequency: f, Q });
function bell(ctx, out, t, f, dur = 1.2, vol = 0.3) {
  for (const [k, a] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
    const o = osc(ctx, 'sine', f * k), g = env(ctx, [[t, 0], [t + 0.005, vol * a], [t + dur / k, 0.0001, 'exp']]);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur);
  }
}
function kick(ctx, out, t, vol = 0.8) {
  const o = osc(ctx, 'sine', 150, 45, t + 0.12), g = env(ctx, [[t, 0], [t + 0.003, vol], [t + 0.35, 0.0001, 'exp']]);
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
}
function hat(ctx, out, t, vol = 0.12) {
  const n = noise(ctx, 0.06), g = env(ctx, [[t, 0], [t + 0.002, vol], [t + 0.05, 0.0001, 'exp']]);
  n.connect(BP(ctx, 'highpass', 7000)).connect(g).connect(out); n.start(t);
}

export const SFX = {
  whoosh: { label: 'Whoosh', dur: 0.6, make(c, o) { const n = noise(c, 0.6), f = BP(c, 'bandpass', 300, 1.2); f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(3500, 0.22); f.frequency.exponentialRampToValueAtTime(900, 0.55); n.connect(f).connect(env(c, [[0, 0], [0.2, 0.9], [0.55, 0.0001, 'exp']])).connect(o); n.start(); } },
  swoosh: { label: 'Swoosh rápido', dur: 0.3, make(c, o) { const n = noise(c, 0.3), f = BP(c, 'highpass', 800); f.frequency.setValueAtTime(800, 0); f.frequency.exponentialRampToValueAtTime(6000, 0.25); n.connect(f).connect(env(c, [[0, 0], [0.08, 0.7], [0.28, 0.0001, 'exp']])).connect(o); n.start(); } },
  pop: { label: 'Pop', dur: 0.15, make(c, o) { const s = osc(c, 'sine', 700, 120, 0.08); s.connect(env(c, [[0, 0], [0.004, 0.8], [0.13, 0.0001, 'exp']])).connect(o); s.start(); s.stop(0.15); } },
  click: { label: 'Click', dur: 0.05, make(c, o) { const n = noise(c, 0.02); n.connect(BP(c, 'highpass', 2000)).connect(env(c, [[0, 0], [0.001, 0.8], [0.02, 0.0001, 'exp']])).connect(o); n.start(); } },
  impacto: { label: 'Impacto', dur: 1.4, make(c, o) {
    const s = osc(c, 'sine', 90, 32, 0.9); s.connect(env(c, [[0, 0], [0.005, 1], [1.3, 0.0001, 'exp']])).connect(o); s.start(); s.stop(1.4);
    const n = noise(c, 0.3); n.connect(BP(c, 'lowpass', 1800)).connect(env(c, [[0, 0], [0.003, 0.6], [0.25, 0.0001, 'exp']])).connect(o); n.start();
  } },
  riser: { label: 'Subida (riser)', dur: 2.2, make(c, o) {
    const n = noise(c, 2.2), f = BP(c, 'bandpass', 200, 2); f.frequency.exponentialRampToValueAtTime(6000, 2.1);
    n.connect(f).connect(env(c, [[0, 0], [2.05, 0.7], [2.2, 0]])).connect(o); n.start();
    const s = osc(c, 'sawtooth', 110, 880, 2.1); s.connect(BP(c, 'lowpass', 2500)).connect(env(c, [[0, 0], [2.05, 0.12], [2.2, 0]])).connect(o); s.start(); s.stop(2.2);
  } },
  ding: { label: 'Ding', dur: 1.5, make(c, o) { bell(c, o, 0, 1320, 1.4, 0.35); } },
  notificacion: { label: 'Notificación', dur: 1, make(c, o) { bell(c, o, 0, 880, 0.6, 0.3); bell(c, o, 0.12, 1320, 0.8, 0.3); } },
  camara: { label: 'Cámara de fotos', dur: 0.3, make(c, o) { for (const t of [0, 0.09]) { const n = noise(c, 0.03); n.connect(BP(c, 'bandpass', 3000, 0.8)).connect(env(c, [[t, 0], [t + 0.002, 0.9], [t + 0.03, 0.0001, 'exp']])).connect(o); n.start(t); } } },
  glitch: { label: 'Glitch', dur: 0.45, make(c, o) {
    const s = new OscillatorNode(c, { type: 'square' }), g = new GainNode(c, { gain: 0 });
    for (let t = 0; t < 0.42; t += 0.03) { s.frequency.setValueAtTime(80 + Math.random() * 1600, t); g.gain.setValueAtTime(Math.random() < 0.7 ? 0.18 : 0, t); }
    g.gain.setValueAtTime(0, 0.42); s.connect(g).connect(o); s.start(); s.stop(0.45);
  } },
  tecleo: { label: 'Tecleo', dur: 1.3, make(c, o) { for (let t = 0.02; t < 1.2; t += 0.07 + Math.random() * 0.06) { const n = noise(c, 0.02); n.connect(BP(c, 'bandpass', 2500 + Math.random() * 2000, 1.5)).connect(env(c, [[t, 0], [t + 0.001, 0.5], [t + 0.02, 0.0001, 'exp']])).connect(o); n.start(t); } } }
};

// Música: bases cortas hechas acá (se repiten si el clip es más largo, cortándolas)
const NOTES = { A: 220, F: 174.61, C: 261.63, G: 196, D: 146.83, E: 164.81 };
export const MUSIC = {
  pulso: { label: 'Pulso (100 BPM)', dur: 28.8, make(c, o) {
    const beat = 0.6, bus = new GainNode(c, { gain: 0.8 }); bus.connect(o);
    ['A', 'F', 'C', 'G'].forEach((n, k) => { for (let r = 0; r < 3; r++) { const t0 = (k + r * 4) * beat * 4;
      for (let b = 0; b < 4; b++) { kick(c, bus, t0 + b * beat, 0.7); hat(c, bus, t0 + b * beat + beat / 2); }
      const s = osc(c, 'triangle', NOTES[n] / 2); s.connect(env(c, [[t0, 0], [t0 + 0.05, 0.25], [t0 + beat * 4 - 0.05, 0.2], [t0 + beat * 4, 0]])).connect(BP(c, 'lowpass', 600)).connect(bus); s.start(t0); s.stop(t0 + beat * 4);
    } });
  } },
  ambiente: { label: 'Ambiente suave', dur: 32, make(c, o) {
    const chords = [['A', 'C', 'E'], ['F', 'A', 'C'], ['C', 'E', 'G'], ['G', 'D', 'G']], lp = BP(c, 'lowpass', 1400, 0.5); lp.connect(o);
    for (let i = 0; i < 8; i++) { const t0 = i * 4, ch = chords[i % 4];
      for (const n of ch) for (const det of [-6, 6]) { const s = new OscillatorNode(c, { type: 'sawtooth', frequency: NOTES[n] * (n === ch[0] ? 1 : 2), detune: det });
        s.connect(env(c, [[t0, 0], [t0 + 1.2, 0.05], [t0 + 3.6, 0.045], [t0 + 4.2, 0]])).connect(lp); s.start(t0); s.stop(t0 + 4.3); } }
  } },
  noticias: { label: 'Informativo (120 BPM)', dur: 32, make(c, o) {
    const beat = 0.5, lp = BP(c, 'lowpass', 1800); lp.connect(o);
    ['D', 'D', 'F', 'C'].forEach((n, k) => { for (let r = 0; r < 4; r++) { const t0 = (k + r * 4) * beat * 4;
      for (let b = 0; b < 4; b++) { kick(c, o, t0 + b * beat, b % 2 ? 0.35 : 0.6); for (let q = 0; q < 4; q++) { const t = t0 + b * beat + q * beat / 4, s = osc(c, 'square', NOTES[n] * (q % 2 ? 2 : 1)); s.connect(env(c, [[t, 0], [t + 0.005, 0.06], [t + 0.1, 0.0001, 'exp']])).connect(lp); s.start(t); s.stop(t + 0.12); } }
    } });
  } }
};

function wav(buf) {
  const n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0)];
  let pk = 1e-6; for (const d of ch) for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
  const k = Math.min(1, 0.7 / pk), v = new DataView(new ArrayBuffer(44 + n * 4)), s = (o, t) => [...t].forEach((x, i) => v.setUint8(o + i, x.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) v.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i] * k)) * 32767, true);
  return new Blob([v], { type: 'audio/wav' });
}
// Devuelve un archivo WAV listo para importar
export async function sound(lib, id) {
  const s = lib[id];
  return new File([wav(await render(s.dur, s.make))], `${s.label} (ClipCreate).wav`, { type: 'audio/wav' });
}

// ---------- Gráficos (SVG → PNG) ----------
const F = 'font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"';
const xml = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
export const GRAPHICS = {
  flecha: { label: 'Flecha', w: 1024, h: 512, svg: (a) => `<path d="M60 380 Q 420 120 820 250" fill="none" stroke="${a}" stroke-width="56" stroke-linecap="round"/><path d="M760 120 L960 270 L720 380 Z" fill="${a}" stroke="${a}" stroke-width="30" stroke-linejoin="round"/>` },
  circulo: { label: 'Círculo a mano', w: 1024, h: 640, svg: (a) => `<path d="M120 330 C 120 120, 900 90, 920 300 C 940 520, 180 580, 140 360 C 120 250, 300 140, 520 120" fill="none" stroke="${a}" stroke-width="34" stroke-linecap="round"/>` },
  subrayado: { label: 'Subrayado', w: 1024, h: 200, svg: (a) => `<path d="M40 130 C 300 70, 700 60, 990 100" fill="none" stroke="${a}" stroke-width="46" stroke-linecap="round"/><path d="M80 160 C 380 120, 640 115, 900 140" fill="none" stroke="${a}" stroke-width="18" stroke-linecap="round" opacity=".7"/>` },
  recuadro: { label: 'Esquinas de foco', w: 1024, h: 1024, svg: (a) => ['M60 260 V60 H260', 'M764 60 H964 V260', 'M964 764 V964 H764', 'M260 964 H60 V764'].map(d => `<path d="${d}" fill="none" stroke="${a}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>`).join('') },
  suscribite: { label: 'Botón «Suscribite»', w: 1100, h: 300, svg: (a, d) => `<rect x="20" y="20" width="1060" height="260" rx="130" fill="${a}"/><path d="M150 205 h120 l-20 -25 v-45 a40 40 0 0 0 -80 0 v45 Z M195 215 a15 15 0 0 0 30 0" fill="${d}"/><text x="640" y="190" text-anchor="middle" font-size="120" ${F} fill="${d}">SUSCRIBITE</text>` },
  seguinos: { label: 'Seguinos @', w: 1200, h: 260, svg: (a, d, w, h) => `<rect x="20" y="20" width="1160" height="220" rx="110" fill="${d}" stroke="${a}" stroke-width="10"/><text x="600" y="168" text-anchor="middle" font-size="96" ${F} fill="${w}">${xml(h || '@tucuenta')}</text>` },
  globo: { label: 'Globo de diálogo', w: 1024, h: 768, svg: (a, d, w) => `<path d="M120 80 H904 a80 80 0 0 1 80 80 V500 a80 80 0 0 1 -80 80 H420 L260 720 L290 580 H120 a80 80 0 0 1 -80 -80 V160 a80 80 0 0 1 80 -80 Z" fill="${w}" stroke="${d}" stroke-width="16"/>` },
  destello: { label: 'Destello', w: 512, h: 512, svg: (a) => `<path d="M256 20 C 280 200, 312 232, 492 256 C 312 280, 280 312, 256 492 C 232 312, 200 280, 20 256 C 200 232, 232 200, 256 20 Z" fill="${a}"/>` },
  tilde: { label: 'Tilde', w: 512, h: 512, svg: (a, d) => `<circle cx="256" cy="256" r="236" fill="${a}"/><path d="M140 262 L222 344 L380 178" fill="none" stroke="${d}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>` },
  cruz: { label: 'Cruz', w: 512, h: 512, svg: (a, d, w) => `<circle cx="256" cy="256" r="236" fill="#e5322d"/><path d="M160 160 L352 352 M352 160 L160 352" stroke="${w}" stroke-width="56" stroke-linecap="round"/>` },
  barra: { label: 'Barra de nombre', w: 1400, h: 300, svg: (a, d) => `<rect x="0" y="40" width="1400" height="220" rx="24" fill="${d}" opacity=".88"/><rect x="0" y="40" width="34" height="220" rx="12" fill="${a}"/>` },
  marco: { label: 'Marco vertical', w: 1080, h: 1920, svg: (a) => `<rect x="30" y="30" width="1020" height="1860" rx="60" fill="none" stroke="${a}" stroke-width="22"/>` }
};
// Dibuja el gráfico con los colores de la marca y lo devuelve como PNG
export async function graphic(id, brand = {}) {
  const g = GRAPHICS[id], a = brand.color || '#ffd400', d = brand.dark || '#0a0a0a', w = '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">${g.svg(a, d, w, brand.handle)}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), im = new Image();
  im.src = url;
  try { await im.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h;
  cv.getContext('2d').drawImage(im, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return new File([blob], `${g.label} (ClipCreate).png`, { type: 'image/png' });
}
export const graphicPreview = (id, brand = {}) => { const g = GRAPHICS[id]; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.w} ${g.h}">${g.svg(brand.color || '#ffd400', brand.dark || '#0a0a0a', '#ffffff', brand.handle)}</svg>`)}`; };

// ---------- LUTs (tablas de color 3D) ----------
export const LUT_SIZE = 33;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (c, s) => { const l = lum(...c); return c.map(x => l + (x - l) * s); };
const con = (c, k) => c.map(x => 0.5 + (x - 0.5) * k);
const ss = x => x * x * (3 - 2 * x);
export const LUTS = {
  teal: { label: 'Cine teal & naranja', f: c => { const t = ss(lum(...c)); return sat(con([c[0] + (t - 0.45) * 0.14, c[1] + (0.5 - t) * 0.03, c[2] - (t - 0.45) * 0.16], 1.08), 0.95); } },
  pelicula: { label: 'Película cálida', f: c => sat(con(c.map((x, i) => 0.03 + x * 0.95 + [0.03, 0.01, -0.03][i] * ss(x)), 1.1), 1.05) },
  calido: { label: 'Atardecer', f: c => sat([c[0] * 1.07 + 0.02, c[1] * 1.02 + 0.01, c[2] * 0.9], 1.08) },
  frio: { label: 'Frío nórdico', f: c => sat([c[0] * 0.92, c[1] * 0.99, c[2] * 1.08 + 0.02], 0.92) },
  vintage: { label: 'Vintage', f: c => sat([0.08 + c[0] * 0.84 + 0.03, 0.08 + c[1] * 0.84 + 0.01, 0.08 + c[2] * 0.84 - 0.04], 0.75) },
  moody: { label: 'Moody', f: c => { const l = lum(...c); return sat(c.map((x, i) => Math.pow(x, 1.15) + [0, 0.01, 0.035 * (1 - l)][i]), 0.7); } },
  vivo: { label: 'Vivo para redes', f: c => sat(con(c, 1.12), 1.3) },
  byn: { label: 'Blanco y negro', f: c => { const l = 0.5 + (lum(...c) - 0.5) * 1.18; return [l, l, l]; } },
  noche: { label: 'Noche azul', f: c => sat([c[0] * 0.72, c[1] * 0.82, c[2] * 1.05 + 0.03], 0.8) }
};
// Tabla RGBA (rojo varía más rápido, como en .cube)
export function lutData(f, n = LUT_SIZE) {
  const d = new Uint8Array(n * n * n * 4);
  let k = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const o = f([r / (n - 1), g / (n - 1), b / (n - 1)]);
    for (let i = 0; i < 3; i++) d[k++] = Math.round(Math.min(1, Math.max(0, o[i])) * 255);
    d[k++] = 255;
  }
  return d;
}
export function toCube(name, d, n = LUT_SIZE) {
  const lines = [`TITLE "${name} - ClipCreate"`, `LUT_3D_SIZE ${n}`];
  for (let i = 0; i < d.length; i += 4) lines.push(`${(d[i] / 255).toFixed(4)} ${(d[i + 1] / 255).toFixed(4)} ${(d[i + 2] / 255).toFixed(4)}`);
  return lines.join('\n') + '\n';
}
export function parseCube(txt) {
  let n = 0, min = [0, 0, 0], max = [1, 1, 1];
  const vals = [];
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith('TITLE')) continue;
    if (l.startsWith('LUT_1D_SIZE')) throw new Error('Ese LUT es 1D; el editor usa LUTs 3D (.cube).');
    if (l.startsWith('LUT_3D_SIZE')) { n = parseInt(l.split(/\s+/)[1]); continue; }
    if (l.startsWith('DOMAIN_MIN')) { min = l.split(/\s+/).slice(1).map(Number); continue; }
    if (l.startsWith('DOMAIN_MAX')) { max = l.split(/\s+/).slice(1).map(Number); continue; }
    const p = l.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every(isFinite)) vals.push(p);
  }
  if (!(n >= 2 && n <= 65) || vals.length !== n ** 3) throw new Error('El archivo .cube no se pudo leer (tamaño inválido).');
  const d = new Uint8Array(n ** 3 * 4);
  vals.forEach((p, i) => { for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(Math.min(1, Math.max(0, (p[c] - min[c]) / (max[c] - min[c]))) * 255); d[i * 4 + 3] = 255; });
  return { size: n, data: d };
}
