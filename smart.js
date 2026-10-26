// ClipCreate Editor — herramientas inteligentes v1.2 (plan de la cuenta para el editor); v1.1: silencios sin pedacitos sueltos; silencios, Clips inteligentes (DeepSeek), reencuadre al
// hablante (MediaPipe), sincronizar cámaras por el audio y estirar el audio sin cambiar el tono.
import { session } from './subs.js';
const SERVER_URL = 'https://iodzwovvexubihbrqjho.supabase.co';
const SERVER_ANON = 'sb_publishable_RNR5-swJZWxpjs71rv3rUA_jt8YGV9C';

// ---------- Silencios ----------
// rms: volumen cada 50 ms. Devuelve los tramos [a, b] (en segundos) sin voz que duran al menos `min`
export function silences(rms, { min = 0.7, sens = 0.5, pad = 0.15 } = {}) {
  const v = Array.from(rms).filter(x => x > 0).sort((a, b) => a - b);
  if (v.length < 20) return [];
  const voice = v[Math.floor(v.length * 0.7)], floor = v[Math.floor(v.length * 0.1)];
  const thr = Math.max(floor * 1.6, voice * (0.04 + 0.16 * sens)); // más sensibilidad = más cosas cuentan como silencio
  const out = [];
  let s = -1;
  for (let i = 0; i <= rms.length; i++) {
    const quiet = i < rms.length && rms[i] < thr;
    if (quiet && s < 0) s = i;
    if (!quiet && s >= 0) {
      const a = s / 20 + pad, b = i / 20 - pad;
      // un silencio pegado al anterior (con menos de 1 s de voz en el medio) dejaría un pedacito suelto: se saltea
      if (b - a >= min - 2 * pad && b > a && (!out.length || a - out.at(-1)[1] >= 1)) out.push([a, b]);
      s = -1;
    }
  }
  return out;
}

// ---------- DeepSeek (Clips inteligentes) ----------
export const aiReady = () => { try { return !!session() || !!localStorage.getItem('clipcut.deepseek'); } catch { return false; } };
async function token() {
  let s = session();
  if (!s) return null;
  if (s.exp - 120 > Date.now() / 1000) return s.token;
  const r = await fetch(`${SERVER_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVER_ANON }, body: JSON.stringify({ refresh_token: s.refresh }) }).catch(() => null);
  if (!r?.ok) throw new Error('Tu sesión venció: entrá de nuevo en ClipCreate (Ajustes).');
  const j = await r.json();
  s = { ...s, token: j.access_token, refresh: j.refresh_token, exp: Date.now() / 1000 + (j.expires_in || 3600) };
  try { localStorage.setItem('clipcut.sesion', JSON.stringify(s)); } catch {}
  return s.token;
}
// Plan de la cuenta: null si no entró con su cuenta; tira error si no hay conexión (así se usa lo último que se supo)
export async function cuenta() {
  if (!session()) return null;
  const tk = await token();
  const r = await fetch(`${SERVER_URL}/rest/v1/rpc/mi_cuenta`, { method: 'POST', headers: { apikey: SERVER_ANON, Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: '{}' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error('No se pudo leer el plan (' + r.status + ').');
  return r.json();
}
async function deepseek(messages, videoId) {
  const tk = await token();
  let key = '';
  try { key = localStorage.getItem('clipcut.deepseek') || ''; } catch {}
  if (!tk && !key) throw new Error('Para usar la IA, entrá con tu cuenta en ClipCreate o cargá una clave de DeepSeek en sus Ajustes.');
  const r = await (tk
    ? fetch(`${SERVER_URL}/functions/v1/deepseek`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVER_ANON, Authorization: 'Bearer ' + tk, 'x-video': videoId }, body: JSON.stringify({ messages }) })
    : fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.3, response_format: { type: 'json_object' }, messages }) })
  ).catch(() => null);
  if (!r) throw new Error('No se pudo conectar. Revisá la conexión a internet.');
  if (r.status === 402) throw new Error(tk ? 'Llegaste al límite de videos de tu plan.' : 'Tu cuenta de DeepSeek no tiene saldo.');
  if (r.status === 429) throw new Error('Llegaste al límite de uso de hoy. Probá mañana.');
  if (r.status === 401) throw new Error(tk ? 'Tu sesión venció: entrá de nuevo en ClipCreate.' : 'La clave de DeepSeek no es válida.');
  if (!r.ok) throw new Error(`La IA respondió con un error (${r.status}). Probá de nuevo en un rato.`);
  const j = await r.json();
  try { return JSON.parse(j.choices[0].message.content); } catch { throw new Error('La IA devolvió algo que no se pudo leer. Probá de nuevo.'); }
}
// sents: [{a, b, text}] oraciones con tiempos. Devuelve propuestas con principio y final en oraciones completas.
export async function findClips(sents, { n = 5, min = 20, max = 60, videoId }) {
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const list = sents.map((x, i) => `${i} [${fmt(x.a)}] ${x.text}`).join('\n');
  const data = await deepseek([
    { role: 'system', content: 'Sos editor de clips virales para Reels, TikTok y Shorts de un programa de entrevistas en español rioplatense. Elegís momentos que se entienden solos, con una idea completa, un gancho en los primeros segundos y un cierre claro. Buscás frases polémicas, interesantes, emotivas o que enseñan algo.' },
    { role: 'user', content: `Elegí los ${n} mejores clips de entre ${min} y ${max} segundos. Cada uno empieza al inicio de una oración y termina al final de otra, y no se pisan. Para cada uno indicá la oración que sirve de gancho (puede ser la primera del clip u otra de adentro, para ponerla al principio), un título de hasta 8 palabras, un texto corto para la portada (hasta 5 palabras), una descripción para publicar con una pregunta y 3 hashtags, de qué tipo es (polémico, emotivo, educativo, gracioso o inspirador) y un puntaje de 1 a 10. Respondé solo con JSON así: {"clips":[{"desde":n,"hasta":n,"gancho":n,"titulo":"","portada":"","descripcion":"","tipo":"","puntaje":n}]}\n\nOraciones numeradas:\n${list}` }
  ], videoId);
  const used = [];
  return (data.clips || []).map(c => ({ d: Math.round(c.desde), h: Math.round(c.hasta), k: Math.round(c.gancho), ...c }))
    .filter(c => c.d >= 0 && c.h < sents.length && c.d <= c.h)
    .map(c => ({ a: sents[c.d].a, b: sents[c.h].b, hook: c.k >= c.d && c.k <= c.h && c.k !== c.d ? [sents[c.k].a, sents[c.k].b] : null,
      title: String(c.titulo || '').slice(0, 80), cover: String(c.portada || '').slice(0, 60), desc: String(c.descripcion || '').slice(0, 600),
      kind: String(c.tipo || ''), score: Math.max(1, Math.min(10, +c.puntaje || 5)), text: sents.slice(c.d, c.h + 1).map(x => x.text).join(' ') }))
    .filter(c => c.b - c.a >= min * 0.6 && c.b - c.a <= max * 1.5)
    .filter(c => { if (used.some(([x, y]) => c.a < y && c.b > x)) return false; used.push([c.a, c.b]); return true; })
    .sort((x, y) => y.score - x.score);
}

// ---------- Caras: quién habla y dónde está ----------
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let landmarker;
async function faceModel(say) {
  if (landmarker) return landmarker;
  say?.('Descargando el detector de caras (solo la primera vez)…');
  try {
    const { FilesetResolver, FaceLandmarker } = await import(MP + '/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(MP + '/wasm');
    const make = delegate => FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'IMAGE', numFaces: 4 });
    landmarker = await make('GPU').catch(() => make('CPU'));
    return landmarker;
  } catch { throw new Error('No se pudo descargar el detector de caras. Revisá la conexión a internet.'); }
}
// En planos abiertos las caras son chicas: se mira el cuadro en partes cuadradas que se pisan un poco
function facesIn(fm, cv) {
  const W = cv.width, H = cv.height, faces = [], tile = new OffscreenCanvas(512, 512), g = tile.getContext('2d');
  const add = (lm, tx, ts) => {
    const x = (tx + lm[1].x * ts) / W;
    if (faces.some(f => Math.abs(f.x - x) < 0.05)) return;
    faces.push({ x, y: lm[1].y, open: Math.abs(lm[14].y - lm[13].y) / Math.max(1e-3, Math.abs(lm[152].y - lm[10].y)) });
  };
  if (W <= H) { fm.detect(cv).faceLandmarks.forEach(lm => add(lm, 0, W)); return faces; }
  const n = Math.ceil(W / H) + 1;
  for (let i = 0; i < n; i++) {
    const tx = i * (W - H) / (n - 1);
    g.drawImage(cv, tx, 0, H, H, 0, 0, 512, 512);
    fm.detect(tile).faceLandmarks.forEach(lm => add(lm, tx, H));
  }
  return faces;
}
// Recorre el tramo [a, b] del video cada `step` s y devuelve, para cada momento, dónde está quien habla (0 a 1)
export async function speakerTrack(M, track, a, b, { step = 0.5, say, cancelled }) {
  const fm = await faceModel(say), sink = new M.CanvasSink(track, { width: 960, fit: 'contain', poolSize: 1 });
  const ts = []; for (let t = a; t < b; t += step) ts.push(t);
  const samples = [];
  let i = 0;
  for await (const w of sink.canvasesAtTimestamps(ts)) {
    if (cancelled?.()) return null;
    samples.push({ t: ts[i], faces: w ? facesIn(fm, w.canvas) : [] });
    if (++i % 5 === 0) say?.(`Buscando a quien habla… ${Math.round(i / ts.length * 100)} %`);
  }
  // personas: caras agrupadas por posición
  const people = [];
  for (const s of samples) for (const f of s.faces) {
    let p = people.find(p => Math.abs(p.x - f.x) < 0.1);
    if (!p) people.push(p = { x: f.x, n: 0 });
    p.x = (p.x * p.n + f.x) / (p.n + 1); p.n++; f.p = p;
  }
  // quien habla: la persona que más mueve la boca en una ventana de 2 s
  return samples.map((s, k) => {
    if (!s.faces.length) return { t: s.t, x: null };
    if (people.length === 1 || s.faces.length === 1) return { t: s.t, x: s.faces[0].x };
    let best = null, bestV = -1;
    for (const p of people) {
      const vals = samples.slice(Math.max(0, k - 2), k + 3).map(q => q.faces.find(f => f.p === p)?.open).filter(v => v != null);
      if (vals.length < 2) continue;
      let d = 0; for (let j = 1; j < vals.length; j++) d += Math.abs(vals[j] - vals[j - 1]);
      if (d / vals.length > bestV) { bestV = d / vals.length; best = p; }
    }
    const f = s.faces.find(f => f.p === best) || s.faces[0];
    return { t: s.t, x: f.x };
  });
}
// Convierte el recorrido en posiciones estables: cambia de persona con un corte y sigue suave a una sola
export function steady(track, { hold = 1 } = {}) {
  const pts = track.filter(p => p.x != null);
  if (!pts.length) return [];
  const out = [{ t: pts[0].t, x: pts[0].x }];
  let cur = pts[0].x, since = null;
  for (const p of pts) {
    const d = Math.abs(p.x - cur);
    if (d > 0.15) { // otra persona: cambia cuando dura más de `hold` segundos
      since ??= p.t;
      if (p.t - since >= hold) { out.push({ t: since - 0.001, x: cur, cut: true }, { t: since, x: p.x }); cur = p.x; since = null; }
    } else {
      since = null;
      if (d > 0.04) { cur += (p.x - cur) * 0.5; out.push({ t: p.t, x: cur }); }
    }
  }
  return out;
}

// ---------- Sincronizar dos cámaras por el audio ----------
// Envolvente de volumen a 50 por segundo de un tramo de audio
export async function envelope(M, track, a, dur) {
  const sink = new M.AudioBufferSink(track), out = new Float32Array(Math.ceil(dur * 50));
  for await (const w of sink.buffers(a, a + dur)) {
    const b = w.buffer, d = b.getChannelData(0), hop = b.sampleRate / 50;
    for (let i = 0; i < b.length; i++) { const k = Math.floor((w.timestamp - a + i / b.sampleRate) * 50); if (k >= 0 && k < out.length) out[k] += d[i] * d[i] / hop; }
  }
  return out.map(x => Math.sqrt(x));
}
// Corrimiento (en segundos) que mejor alinea B con A: un sonido en A a los t s está en B a los t + corrimiento s
export function bestLag(A, B, maxLag = 60) {
  const norm = x => { const m = x.reduce((s, v) => s + v, 0) / x.length; return x.map(v => v - m); };
  const a = norm(A), b = norm(B), L = Math.round(maxLag * 50);
  let best = 0, bestV = -Infinity;
  for (let lag = -L; lag <= L; lag++) {
    let s = 0, n = 0;
    for (let i = Math.max(0, -lag); i < a.length && i + lag < b.length; i++) { s += a[i] * b[i + lag]; n++; }
    if (n > Math.min(a.length, b.length) * 0.3 && s / n > bestV) { bestV = s / n; best = lag; }
  }
  return best / 50;
}

// ---------- Velocidad sin cambiar el tono (WSOLA) ----------
export function stretch(chs, speed, sr) {
  if (Math.abs(speed - 1) < 1e-3) return chs;
  const N = Math.round(sr * 0.04), H = N / 2, tol = Math.round(sr * 0.012), len = chs[0].length;
  const outLen = Math.floor(len / speed), out = chs.map(() => new Float32Array(outLen + N)), win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  let prev = 0;
  for (let o = 0; o < outLen; o += H) {
    const ideal = Math.round(o * speed);
    let best = ideal, bestV = -Infinity;
    if (o > 0) for (let d = -tol; d <= tol; d += 2) { // busca dónde se parece más a lo que venía (sin cortes raros)
      const s = ideal + d; if (s < 0 || s + N >= len) continue;
      let v = 0; for (let i = 0; i < N; i += 4) v += chs[0][s + i] * chs[0][prev + H + i];
      if (v > bestV) { bestV = v; best = s; }
    }
    best = Math.max(0, Math.min(len - N - 1, best));
    for (let c = 0; c < chs.length; c++) for (let i = 0; i < N; i++) out[c][o + i] += chs[c][best + i] * win[i];
    prev = best;
  }
  return out.map(d => d.subarray(0, outLen));
}
