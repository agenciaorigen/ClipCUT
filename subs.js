// ClipCreate Editor — subtítulos v1.0: transcribe la voz del proyecto y arma los tiempos de cada palabra.
// Con cuenta de ClipCreate se transcribe en el servidor (Groq, con el tiempo real de cada palabra);
// sin cuenta, en la compu con Whisper (no se sube nada).
const SERVER_URL = 'https://iodzwovvexubihbrqjho.supabase.co';
const SERVER_ANON = 'sb_publishable_RNR5-swJZWxpjs71rv3rUA_jt8YGV9C';
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const SR = 16000;

// La sesión es la misma que la de ClipCreate (mismo sitio)
export const session = () => { try { return JSON.parse(localStorage.getItem('clipcut.sesion') || 'null'); } catch { return null; } };
async function token() {
  let s = session();
  if (!s) return null;
  if (s.exp - 120 > Date.now() / 1000) return s.token;
  const r = await fetch(`${SERVER_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVER_ANON }, body: JSON.stringify({ refresh_token: s.refresh })
  }).catch(() => null);
  if (!r?.ok) { try { localStorage.removeItem('clipcut.sesion'); } catch {} throw new Error('Tu sesión venció: entrá de nuevo en ClipCreate (Ajustes) y volvé a probar.'); }
  const j = await r.json();
  s = { ...s, token: j.access_token, refresh: j.refresh_token, exp: Date.now() / 1000 + (j.expires_in || 3600) };
  try { localStorage.setItem('clipcut.sesion', JSON.stringify(s)); } catch {}
  return s.token;
}

// Audio chico para mandar: Opus a 32 kbps (10 minutos ≈ 2,4 MB)
async function oggOf(M, piece) {
  const out = new M.Output({ format: new M.OggOutputFormat(), target: new M.BufferTarget() });
  const src = new M.AudioSampleSource({ codec: 'opus', bitrate: 32000 });
  out.addAudioTrack(src);
  await out.start();
  for (let i = 0; i < piece.length; i += SR) {
    const s = new M.AudioSample({ data: piece.slice(i, i + SR), format: 'f32', numberOfChannels: 1, sampleRate: SR, timestamp: i / SR });
    await src.add(s); s.close();
  }
  await out.finalize();
  return new File([out.target.buffer], 'audio.ogg', { type: 'audio/ogg' });
}

let serverOff = false;
async function serverPiece(M, piece, a, videoId) {
  if (serverOff) return null;
  const tk = await token();
  if (!tk) return null;
  const fd = new FormData();
  fd.append('audio', await oggOf(M, piece));
  fd.append('segundos', String(Math.ceil(piece.length / SR)));
  const r = await fetch(`${SERVER_URL}/functions/v1/transcribir`, { method: 'POST', headers: { apikey: SERVER_ANON, Authorization: 'Bearer ' + tk, 'x-video': videoId }, body: fd }).catch(() => null);
  if (!r || r.status === 404 || r.status === 501) { serverOff = true; return null; }
  if (r.status === 402) throw new Error('Llegaste al límite de videos de tu plan. Podés transcribir en la compu saliendo de tu cuenta en ClipCreate.');
  if (r.status === 429) throw new Error('Llegaste al límite de transcripción de hoy en el servidor. Mañana se renueva.');
  if (!r.ok) return null;
  const { segments } = await r.json();
  return (segments || []).map(s => ({
    a: a + s.start, b: a + s.end, text: String(s.text || '').trim(),
    w: Array.isArray(s.words) && s.words.length ? s.words.map(([x, y]) => [a + x, a + y]) : undefined
  }));
}

// Whisper en la compu, en un proceso aparte (la página no se congela)
const WORKER = `let asr, asrId;
self.onmessage = async ({ data }) => {
  try {
    if (asrId !== data.id) {
      asrId = data.id;
      asr = (async () => {
        const m = await import(data.tf);
        try { await caches.keys(); } catch { m.env.useBrowserCache = false; }
        return m.pipeline('automatic-speech-recognition', data.id, { device: 'wasm', dtype: 'q8',
          progress_callback: p => { if (p.status === 'progress' && /\\.onnx$/.test(p.file || '')) postMessage({ type: 'load', progress: p.progress }); } });
      })();
      asr.catch(() => { asrId = null; });
    }
    const run = await asr, opts = { language: 'spanish', task: 'transcribe', return_timestamps: true };
    if (data.audio.length > 30 * 16000) Object.assign(opts, { chunk_length_s: 30, stride_length_s: 5 });
    const out = await run(data.audio, opts);
    postMessage({ type: 'done', chunks: out.chunks || [] });
  } catch (e) { postMessage({ type: 'error', message: String((e && e.message) || e) }); }
};`;
let worker;
function localPiece(piece, a, model, onLoad) {
  worker ??= new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
  return new Promise((res, rej) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'load') return onLoad?.(data.progress || 0);
      if (data.type === 'error') return rej(new Error('No se pudo transcribir en la compu: ' + data.message));
      res(data.chunks.map(c => ({ a: a + c.timestamp[0], b: a + (c.timestamp[1] ?? piece.length / SR), text: c.text.trim() })));
    };
    worker.onerror = e => { e.preventDefault(); worker.terminate(); worker = null; rej(new Error('El transcriptor se cerró. Cerrá otras pestañas y probá de nuevo.')); };
    const copy = piece.slice();
    worker.postMessage({ audio: copy, id: model, tf: TF }, [copy.buffer]);
  });
}
export const stopLocal = () => { worker?.terminate(); worker = null; };

// Volumen cada 50 ms: sirve para cortar en silencios y para ubicar las palabras
export function rmsOf(pcm) {
  const hop = SR / 20, out = new Float32Array(Math.floor(pcm.length / hop));
  for (let k = 0; k < out.length; k++) { let s = 0; for (let i = k * hop; i < (k + 1) * hop; i++) s += pcm[i] * pcm[i]; out[k] = Math.sqrt(s / hop); }
  return out;
}
// Corta el audio en pedazos de unos `every` segundos, siempre en el momento más callado cerca del corte
function pieces(rms, total, every) {
  const out = [];
  let a = 0;
  while (total - a > every * 1.2) {
    const lo = Math.round((a + every - 15) * 20), hi = Math.round((a + every) * 20);
    let best = hi;
    for (let k = lo; k < hi; k++) if (rms[k] < rms[best]) best = k;
    out.push([a, best / 20]); a = best / 20;
  }
  out.push([a, total]);
  return out;
}

// Whisper a veces inventa frases en los silencios o se traba repitiendo: eso se saca
const JUNK = /(subt[ií]tulos? (realizados|hechos|por)|amara\.org|gracias por (ver|mirar)|suscr[ií]bete|dale like|www\.|\.com\b)/i;
function clean(segs) {
  const out = [];
  for (const s of segs) {
    let t = s.text.replace(/\s+/g, ' ').trim();
    if (!t || JUNK.test(t) || /^[\p{P}\s♪]+$/u.test(t) || s.b <= s.a) continue;
    t = t.replace(/(\p{L}+)(\s+\1\b){2,}/giu, '$1');
    const prev = out.at(-1);
    if (prev && prev.text.toLowerCase() === t.toLowerCase()) { prev.b = s.b; continue; }
    out.push({ ...s, text: t, w: s.w?.length === t.split(' ').length ? s.w : undefined });
  }
  return out;
}

// Tiempo estimado de cada palabra (cuando el transcriptor no lo da): se reparte según las sílabas,
// contando solo los momentos con voz
const syl = w => Math.max(1, (w.match(/[aeiouáéíóúü]+/gi) || []).length);
export function estimateWords(seg, rms) {
  const words = seg.text.split(' '), a = seg.a, b = seg.b;
  const i0 = Math.round(a * 20), n = Math.max(1, Math.round((b - a) * 20));
  let voiced = null, nv = 0;
  if (rms && n > 2) {
    const slice = Array.from(rms.subarray(i0, i0 + n)), thr = Math.max(...slice) * 0.15;
    voiced = slice.map(x => x > thr); nv = voiced.filter(Boolean).length;
    if (nv < n * 0.3) voiced = null;
  }
  const at = f => {
    if (!voiced) return a + (b - a) * f;
    let need = f * nv;
    for (let j = 0; j < n; j++) if (voiced[j]) { if (need <= 1) return Math.min(b, a + (j + need) / 20); need--; }
    return b;
  };
  const ws = words.map(syl), tot = ws.reduce((x, y) => x + y, 0);
  let acc = 0;
  return ws.map(w => { const s = at(acc / tot); acc += w; return [s, at(acc / tot)]; });
}

// Transcribe todo el audio (16 kHz mono). Devuelve frases con el tiempo de cada palabra.
export async function transcribe(M, pcm, { videoId, model, onProgress, onLoad, cancelled }) {
  const rms = rmsOf(pcm), total = pcm.length / SR, useServer = !!session() && !serverOff;
  const parts = pieces(rms, total, useServer ? 600 : 240), out = [];
  let done = 0, where = useServer ? 'servidor' : 'compu';
  for (const [a, b] of parts) {
    if (cancelled()) return null;
    const piece = pcm.subarray(Math.floor(a * SR), Math.floor(b * SR));
    let segs = useServer ? await serverPiece(M, piece, a, videoId) : null;
    if (!segs) { where = 'compu'; segs = await localPiece(piece, a, model, onLoad); }
    out.push(...segs);
    done += b - a; onProgress(done / total, where);
  }
  return clean(out).map(s => ({ ...s, w: s.w || estimateWords(s, rms), exact: !!s.w }));
}

// ---------- SRT y VTT ----------
const ts = (s, sep) => { const ms = Math.round(s * 1000); return [ms / 3600000, ms / 60000 % 60, ms / 1000 % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':') + sep + String(ms % 1000).padStart(3, '0'); };
export const toSRT = items => items.map((x, i) => `${i + 1}\n${ts(x.a, ',')} --> ${ts(x.b, ',')}\n${x.text}\n`).join('\n');
export const toVTT = items => 'WEBVTT\n\n' + items.map(x => `${ts(x.a, '.')} --> ${ts(x.b, '.')}\n${x.text}\n`).join('\n');
export function parseSubs(txt) {
  const sec = t => { const p = t.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const out = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n'), k = lines.findIndex(l => l.includes('-->'));
    if (k < 0) continue;
    const [a, b] = lines[k].split('-->').map(x => sec(x.split(' ').filter(Boolean)[0] || x));
    const text = lines.slice(k + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text && isFinite(a) && isFinite(b) && b > a) out.push({ a, b, text });
  }
  return out;
}
