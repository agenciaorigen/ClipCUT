// ClipCreate Editor v2.0 — editor de video multipista que corre entero en el navegador.
// Vista previa con <video>/<audio> + canvas; exportación real con WebCodecs (mediabunny). Proyectos y archivos en IndexedDB.
// v2.0: Mejorar voz, subtítulos automáticos con estilos, transiciones, corrección de color y animación de textos.
import * as S from './store.js';
import * as Voz from './audio.js';
import * as Sub from './subs.js';
import * as Assets from './assets.js';
import * as GL from './gl.js';
import * as Smart from './smart.js';

const $ = id => document.getElementById(id);
const MB = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
let mbLib;
const mb = async () => mbLib ??= await import(MB);

const ASPECTS = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] };
const FONTS = { montserrat: 'Montserrat', anton: 'Anton', jakarta: '"Plus Jakarta Sans"', playfair: '"Playfair Display"' };
const NAMES = { video: 'Video', audio: 'Audio', text: 'Texto' };
const DEF = {
  video: { vol: 1, mute: false, fadeIn: 0, fadeOut: 0, voz: null, speed: 1, x: 0, y: 0, scale: 1, rot: 0, opacity: 1, fit: 'cover', bg: 'color', kb: 0, kf: null,
    exp: 0, con: 0, sat: 0, temp: 0, tint: 0, hue: 0, vib: 0, hl: 0, sh: 0, wh: 0, bl: 0, vig: 0, grain: 0, lut: '', lutMix: 1,
    tr: 'none', trD: 0.5, trDir: 'izq', trK: 1 },
  audio: { vol: 1, mute: false, fadeIn: 0, fadeOut: 0, voz: null, speed: 1, duck: false },
  text: { in: 0, text: 'Texto', font: 'montserrat', weight: 800, size: 0.06, color: '#ffffff', stroke: true, box: 'none', boxColor: '#000000', x: 0, y: 0.25, anim: 'ninguna' }
};
const HW = 140;   // ancho de los nombres de pista en la línea de tiempo
const MIN = 0.1;   // largo mínimo de un clip, en segundos
const RATE = 48000;

const say = t => { $('status').textContent = t; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fmt = s => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));
const sp = c => c.speed || 1;
const len = c => (c.out - c.in) / sp(c);
const srcAt = (c, t) => c.in + (t - c.start) * sp(c); // segundo del archivo que se ve en el segundo t del proyecto
const end = c => c.start + len(c);

let P = null;               // proyecto abierto
const media = new Map();    // id → registro del archivo + url
let T = 0, playing = false, t0 = 0, p0 = 0, sel = null, pps = 40, dirty = true;
const past = [], future = [];

// ---------- Proyecto ----------
const tracks = kind => P.tracks.filter(t => t.kind === kind);
const dur = () => Math.max(0, ...P.tracks.flatMap(t => t.clips.map(end)));
const isAV = (c, t) => t.kind !== 'text' && media.get(c.media)?.type !== 'image';
function find(id) {
  for (const t of P.tracks) { const c = t.clips.find(x => x.id === id); if (c) return { c, t }; }
  return null;
}
function newTrack(kind) {
  const t = { id: S.uid(), kind, name: `${NAMES[kind]} ${tracks(kind).length + 1}`, muted: false, hidden: false, clips: [] };
  // los textos van arriba de todo, el video nuevo arriba de los otros videos y el audio abajo
  const i = kind === 'audio' ? P.tracks.length : kind === 'text' ? 0 : P.tracks.findIndex(x => x.kind === 'video');
  P.tracks.splice(i < 0 ? P.tracks.length : i, 0, t);
  return t;
}
function blank() {
  P = { id: S.uid(), name: 'Proyecto sin título', updated: Date.now(), aspect: '9:16', bg: '#000000', safe: true, sub: { ...SUBDEF }, tracks: [], media: [] };
  newTrack('text'); newTrack('video'); newTrack('audio');
  return P;
}

// ---------- Guardado ----------
let saveT;
const saveSoon = () => { $('saved').textContent = 'Guardando…'; clearTimeout(saveT); saveT = setTimeout(save, 600); };
async function save() {
  clearTimeout(saveT);
  if (!P) return;
  P.updated = Date.now();
  try { await S.put('projects', P); $('saved').textContent = 'Guardado'; }
  catch (e) { $('saved').textContent = 'Sin guardar'; say('No se pudo guardar el proyecto: ' + (e.message || e)); }
}
addEventListener('beforeunload', () => { if (saveT) save(); });

// ---------- Deshacer / rehacer ----------
const snap = () => JSON.stringify({ name: P.name, aspect: P.aspect, bg: P.bg, safe: P.safe, sub: P.sub, tracks: P.tracks });
function remember(before) {
  if (snap() === before) return false;
  past.push(before); if (past.length > 200) past.shift();
  future.length = 0;
  return true;
}
function edit(fn) { const s = snap(); fn(); if (remember(s)) changed(); }
function restore(s) { Object.assign(P, JSON.parse(s)); if (sel && !find(sel)) sel = null; changed(); sizeStage(); }
const undo = () => { if (!past.length) return; future.push(snap()); restore(past.pop()); say('Deshecho.'); };
const redo = () => { if (!future.length) return; past.push(snap()); restore(future.pop()); say('Rehecho.'); };
function changed() {
  silMarks = []; $('silCut').disabled = true;
  dirty = true; saveSoon(); renderTimeline(); renderProps(); renderBin(); renderSubs(); renderTranscript();
  $('undo').disabled = !past.length; $('redo').disabled = !future.length;
  $('pname').value = P.name;
}

// ---------- Abrir proyectos ----------
async function openProject(id) {
  pause();
  let p = null;
  try { p = id ? await S.get('projects', id) : null; } catch (e) { say('No se pudo leer el proyecto: ' + e.message); }
  for (const m of media.values()) URL.revokeObjectURL(m.url);
  media.clear(); releaseAll();
  if (p) P = p; else blank();
  P.sub = { ...SUBDEF, ...P.sub };
  for (const t of P.tracks) t.clips = t.clips.map(c => ({ ...DEF[t.kind], ...c }));
  for (const mid of P.media) {
    try { const m = await S.get('media', mid); if (m) media.set(mid, { ...m, url: URL.createObjectURL(m.blob) }); } catch {}
  }
  past.length = future.length = 0; sel = null; T = 0;
  try { localStorage.setItem('clipcreate.editor.ultimo', P.id); } catch {}
  history.replaceState(null, '', '?p=' + P.id);
  if (!p) await save();
  sizeStage(); fitZoom(); changed(); $('saved').textContent = 'Guardado';
  const lost = P.tracks.flatMap(t => t.clips).filter(c => c.media && !media.has(c.media)).length;
  if (lost) say(`Faltan ${lost} archivo(s) de este proyecto: se borraron del navegador. Importalos de nuevo.`);
}

// ---------- Importar ----------
const typeOf = f => {
  const t = f.type.split('/')[0];
  if (['video', 'audio', 'image'].includes(t)) return t;
  const ext = f.name.split('.').pop().toLowerCase();
  return ['mp4', 'mov', 'mkv', 'webm', 'm4v'].includes(ext) ? 'video' : ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext) ? 'audio' : ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? 'image' : null;
};
const thumbOf = (src, w, h) => {
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = Math.max(1, Math.round(160 * h / w));
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.7);
};
async function probe(f, type) {
  if (type === 'image') {
    const bm = await createImageBitmap(f).catch(() => { throw new Error(`No se pudo abrir la imagen «${f.name}».`); });
    const r = { duration: 5, w: bm.width, h: bm.height, hasAudio: false, thumb: thumbOf(bm, bm.width, bm.height) };
    bm.close(); return r;
  }
  const el = document.createElement(type === 'audio' ? 'audio' : 'video');
  el.preload = 'auto'; el.muted = true; el.playsInline = true;
  const url = URL.createObjectURL(f);
  el.src = url;
  try {
    await Promise.race([
      once(el, 'loadeddata'),
      once(el, 'error').then(() => { throw new Error(`Este navegador no puede reproducir «${f.name}». Convertilo a MP4 (H.264) o MP3 y probá de nuevo.`); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`«${f.name}» tardó demasiado en abrir.`)), 30000))
    ]);
    let duration = el.duration, hasAudio = type === 'audio';
    try {
      const M = await mb(), inp = new M.Input({ source: new M.BlobSource(f), formats: M.ALL_FORMATS });
      if (type === 'video') hasAudio = !!(await inp.getPrimaryAudioTrack());
      if (!isFinite(duration)) duration = await inp.computeDuration();
    } catch { if (type === 'video') hasAudio = true; }
    if (!isFinite(duration) || duration <= 0) throw new Error(`No se pudo saber cuánto dura «${f.name}».`);
    const r = { duration, w: el.videoWidth || 0, h: el.videoHeight || 0, hasAudio, thumb: '' };
    if (type === 'video' && r.w) {
      el.currentTime = Math.min(1, duration / 4);
      await Promise.race([once(el, 'seeked'), new Promise(res => setTimeout(res, 4000))]);
      r.thumb = thumbOf(el, r.w, r.h);
    }
    return r;
  } finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
}
// Abre un archivo, lo guarda en el navegador y lo suma a la lista del proyecto (sin ponerlo en la línea de tiempo)
async function importOne(f, type = typeOf(f)) {
  say(`Abriendo «${f.name}»…`);
  const info = await probe(f, type);
  say(`Guardando «${f.name}» en el navegador…`);
  const rec = { id: S.uid(), name: f.name, type, blob: f, ...info };
  await S.put('media', rec);
  P.media.push(rec.id);
  media.set(rec.id, { ...rec, url: URL.createObjectURL(f) });
  return rec;
}
async function importFiles(files) {
  const wasEmpty = !dur(), added = [];
  for (const f of files) {
    const type = typeOf(f);
    if (!type) { say(`«${f.name}» no es un video, un audio ni una imagen.`); continue; }
    try { added.push(await importOne(f, type)); } catch (e) { say(e.message || String(e)); return finishImport(added, wasEmpty); }
  }
  finishImport(added, wasEmpty);
  if (added.length) say(added.length === 1 ? `Listo: «${added[0].name}» importado.` : `Listo: ${added.length} archivos importados.`);
}
function finishImport(added, wasEmpty) {
  if (!added.length) return;
  // proyecto vacío: cada archivo va uno detrás del otro en su pista (videos e imágenes arriba, audios abajo)
  if (wasEmpty) edit(() => { const at = { video: 0, audio: 0 }; for (const m of added) { const k = m.type === 'audio' ? 'audio' : 'video'; at[k] = end(addMedia(m.id, at[k])); } });
  else { save(); renderBin(); }
  fitZoom();
}

// Pone un archivo en la línea de tiempo (en la pista elegida o en la primera que corresponda)
function addMedia(mid, at = T, track = null) {
  const m = media.get(mid), kind = m.type === 'audio' ? 'audio' : 'video';
  const t = track?.kind === kind ? track : tracks(kind)[0] || newTrack(kind);
  const c = { ...DEF[kind], id: S.uid(), media: mid, start: Math.max(0, at), in: 0, out: m.duration };
  t.clips.push(c); fitFree(t, c); sel = c.id;
  return c;
}
function addText(preset, at = T) {
  edit(() => {
    const t = tracks('text')[0] || newTrack('text');
    const c = { ...DEF.text, ...preset, id: S.uid(), start: Math.max(0, at), in: 0, out: preset.out || 4 };
    delete c.label; delete c.desc;
    t.clips.push(c); fitFree(t, c); sel = c.id;
  });
  fitIfNeeded();
}

// Si el clip se pisa con otro de la misma pista, lo corre al hueco libre más cercano
function fitFree(t, c) {
  const others = t.clips.filter(o => o !== c);
  const free = s => s >= 0 && others.every(o => s + len(c) <= o.start + 1e-6 || s >= end(o) - 1e-6);
  if (free(c.start)) return;
  const cands = [...others.map(end), ...others.map(o => o.start - len(c))].filter(free);
  c.start = cands.sort((a, b) => Math.abs(a - c.start) - Math.abs(b - c.start))[0] ?? Math.max(0, ...others.map(end));
}

// ---------- Acciones de edición ----------
function split() {
  const targets = sel ? [find(sel)].filter(Boolean) : P.tracks.flatMap(t => t.clips.map(c => ({ c, t })));
  const hits = targets.filter(({ c }) => T > c.start + MIN / 2 && T < end(c) - MIN / 2);
  if (!hits.length) return say('Poné el cursor sobre un clip para dividirlo.');
  edit(() => {
    for (const { c, t } of hits) {
      const cut = srcAt(c, T), b = { ...c, id: S.uid(), start: T, in: cut, fadeIn: 0, tr: 'none', kf: shiftKf(c.kf, T - c.start) };
      if (c.sub) { // las palabras se reparten entre los dos pedazos
        const w = wordsOf(c), tm = timesOf(c);
        if (w.length < 2) continue;
        let k = tm.findIndex(([x]) => x >= T - c.start);
        k = k < 0 ? w.length - 1 : Math.max(1, k);
        c.text = w.slice(0, k).join(' '); b.text = w.slice(k).join(' ');
        c.words = tm.slice(0, k); b.words = tm.slice(k).map(([x, y]) => [x - (T - c.start), y - (T - c.start)]);
      }
      if (t.kind === 'text' || media.get(c.media)?.type === 'image') { b.in = 0; b.out = end(c) - T; c.out = c.in + (T - c.start); }
      else c.out = cut;
      c.fadeOut = 0;
      t.clips.push(b); sel = b.id;
    }
  });
}
function remove() {
  if (!sel) return say('Elegí un clip para borrarlo.');
  edit(() => { const f = find(sel); f.t.clips = f.t.clips.filter(c => c !== f.c); sel = null; });
}
function duplicate() {
  const f = sel && find(sel);
  if (!f) return say('Elegí un clip para duplicarlo.');
  edit(() => { const c = { ...f.c, id: S.uid(), start: end(f.c) }; f.t.clips.push(c); fitFree(f.t, c); sel = c.id; });
}
function detach() {
  const f = sel && find(sel);
  if (!f || f.t.kind !== 'video' || media.get(f.c.media)?.type !== 'video') return say('Elegí un clip de video para separarle el audio.');
  if (!media.get(f.c.media).hasAudio) return say('Ese video no tiene audio.');
  if (f.c.mute) return say('El audio de ese clip ya está separado o silenciado.');
  edit(() => {
    const c = f.c, a = { ...DEF.audio, id: S.uid(), media: c.media, start: c.start, in: c.in, out: c.out, vol: c.vol, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
    let t = tracks('audio').find(t => t.clips.every(o => end(a) <= o.start || a.start >= end(o)));
    t ??= newTrack('audio');
    t.clips.push(a); c.mute = true;
  });
  say('Audio separado: ahora está en su propia pista.');
}
// ---------- Cortar tramos (edición por texto, silencios) y copiar tramos (Clips inteligentes) ----------
const timed = c => !!c.media && media.get(c.media)?.type !== 'image';
function trimTail(c, t) { // deja el clip hasta el segundo t del proyecto
  if (c.sub) { const tm = timesOf(c), w = wordsOf(c), k = Math.max(1, tm.filter(([x]) => x < t - c.start).length); c.text = w.slice(0, k).join(' '); c.words = tm.slice(0, k); }
  c.out = timed(c) ? srcAt(c, t) : c.in + (t - c.start); c.fadeOut = 0;
  return c;
}
function trimHead(c, t) { // deja el clip desde el segundo t del proyecto
  const dt = t - c.start;
  if (c.sub) { const tm = timesOf(c), w = wordsOf(c); let k = tm.findIndex(([x]) => x >= dt); if (k < 0) k = w.length - 1; c.text = w.slice(k).join(' '); c.words = tm.slice(k).map(([x, y]) => [Math.max(0, x - dt), y - dt]); }
  if (timed(c)) c.in = srcAt(c, t); else c.out -= dt;
  c.kf = shiftKf(c.kf, dt); c.start = t; c.fadeIn = 0;
  return c;
}
// Saca el tramo [a, b] de todas las pistas y corre lo que sigue para cerrar el hueco
function cutRange(a, b) {
  const d = b - a;
  if (d <= 0) return;
  for (const t of P.tracks) {
    const out = [];
    for (const c of t.clips) {
      const e = end(c);
      if (e <= a + 1e-6) out.push(c);
      else if (c.start >= b - 1e-6) { c.start -= d; out.push(c); }
      else if (c.start >= a - 1e-6 && e <= b + 1e-6) continue;
      else if (c.start < a && e > b) { const tl = trimHead({ ...c, id: S.uid(), tr: 'none' }, b); tl.start = a; out.push(trimTail(c, a), tl); }
      else if (c.start < a) out.push(trimTail(c, a));
      else { trimHead(c, b); c.start = a; out.push(c); }
    }
    t.clips = out.filter(c => len(c) > 0.02);
  }
}
// Copia de las pistas con solo los tramos pedidos, uno detrás del otro (para armar un clip nuevo)
function rangeTracks(ranges) {
  return P.tracks.map(t => {
    const clips = [];
    let at = 0;
    for (const [a, b] of ranges) {
      for (const c0 of t.clips) {
        if (end(c0) <= a || c0.start >= b) continue;
        const c = structuredClone(c0);
        c.id = S.uid();
        if (c.start < a) trimHead(c, a);
        if (end(c) > b) trimTail(c, b);
        c.start = c.start - a + at;
        clips.push(c);
      }
      at += b - a;
    }
    return { ...t, id: S.uid(), clips };
  });
}

// Congela el cuadro actual: lo convierte en una imagen de 2 s y corre lo que sigue en esa pista
async function freeze() {
  const f = sel && find(sel), m = f && media.get(f.c.media);
  if (!f || m?.type !== 'video' || T <= f.c.start || T >= end(f.c)) return say('Poné el cursor sobre un clip de video para congelar ese cuadro.');
  const el = elFor(f.c);
  if (el.seeking || el.readyState < 2) await Promise.race([once(el, 'seeked'), new Promise(r => setTimeout(r, 1500))]);
  const cv = document.createElement('canvas'); cv.width = el.videoWidth; cv.height = el.videoHeight;
  cv.getContext('2d').drawImage(el, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const rec = await importOne(new File([blob], `Cuadro ${fmt(T)}.png`, { type: 'image/png' }), 'image');
  const D = 2;
  edit(() => {
    const { c, t } = f, at = T, b = trimHead({ ...c, id: S.uid(), tr: 'none' }, at);
    trimTail(c, at);
    for (const o of t.clips) if (o !== c && o.start >= at - 1e-6) o.start += D;
    b.start = at + D;
    const img = { ...DEF.video, ...Object.fromEntries(ATTRS.video.map(k => [k, structuredClone(c[k])])), id: S.uid(), media: rec.id, start: at, in: 0, out: D, speed: 1, tr: 'none', kf: null, voz: null };
    t.clips.push(img, b); sel = img.id;
  });
  say('Cuadro congelado por 2 segundos.');
}

// Copiar y pegar ajustes entre clips (encuadre, color, efectos, transición, voz)
const ATTRS = {
  video: ['fit', 'bg', 'kb', 'x', 'y', 'scale', 'rot', 'opacity', 'exp', 'con', 'sat', 'temp', 'tint', 'hue', 'vib', 'hl', 'sh', 'wh', 'bl', 'vig', 'grain', 'lut', 'lutMix', 'tr', 'trD', 'trDir', 'trK'],
  audio: ['vol', 'fadeIn', 'fadeOut', 'voz', 'duck'],
  text: ['font', 'weight', 'size', 'color', 'stroke', 'box', 'boxColor', 'x', 'y', 'anim']
};
let clipboard = null;
function copyAttrs() {
  const f = sel && find(sel);
  if (!f) return say('Elegí un clip para copiar sus ajustes.');
  const keys = f.t.kind === 'video' ? [...ATTRS.video, ...ATTRS.audio] : ATTRS[f.t.kind];
  clipboard = { kind: f.t.kind, v: Object.fromEntries(keys.map(k => [k, structuredClone(f.c[k])])) };
  say('Ajustes copiados. Elegí otro clip y tocá «Pegar ajustes» (Ctrl+Alt+V).');
}
function pasteAttrs() {
  const f = sel && find(sel);
  if (!f || !clipboard) return say(clipboard ? 'Elegí un clip para pegarle los ajustes.' : 'Primero copiá los ajustes de un clip.');
  const ok = Object.keys(DEF[f.t.kind]);
  edit(() => { for (const [k, v] of Object.entries(clipboard.v)) if (ok.includes(k)) f.c[k] = structuredClone(v); });
  say('Ajustes pegados.');
}

// Cambiar la velocidad estira o acorta el clip: lo que sigue en la pista se corre para no pisarse
function setSpeed(c, t, v) {
  const old = end(c);
  c.speed = clamp(v, 0.25, 4);
  const d = end(c) - old;
  for (const o of t.clips) if (o !== c && o.start >= old - 1e-6) o.start += d;
}

// Reencuadre al hablante: busca las caras, ve quién mueve la boca y arma los fotogramas clave de la posición
function frameGeom(c, m) {
  const [A, B] = ASPECTS[P.aspect], W = A / B, k = (c.fit === 'contain' ? Math.min(W / m.w, 1 / m.h) : Math.max(W / m.w, 1 / m.h)) * c.scale;
  return { mul: m.w * k / W, room: Math.max(0, (m.w * k / W - 1) / 2) };
}
async function reframeClip(c, opts = {}) {
  const m = media.get(c.media);
  if (m?.type !== 'video' || !m.w) return false;
  const g = frameGeom(c, m);
  if (g.room < 0.02) return false; // el video ya entra entero: no hay nada que mover
  const M = await mb(), inp = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS }), vt = await inp.getPrimaryVideoTrack();
  const tr = await Smart.speakerTrack(M, vt, c.in, c.out, { say, cancelled: () => job.cancel, ...opts });
  if (!tr) return null;
  const pts = Smart.steady(tr).map(p => [(p.t - c.in) / sp(c), clamp(-(p.x - 0.5) * g.mul, -g.room, g.room)]);
  if (!pts.length) return false;
  c.kf = { ...(c.kf || {}), x: pts };
  return true;
}
async function reframe(list) {
  if (P.aspect === '16:9') return say('El reencuadre es para formatos verticales o cuadrados: cambiá el formato del proyecto primero.');
  job.cancel = false;
  let n = 0;
  const before = snap();
  try {
    for (const c of list) { const r = await reframeClip(c); if (r === null) return say('Cancelado.'); if (r) n++; }
  } catch (e) { return say(e.message || String(e)); }
  if (remember(before)) changed();
  say(n ? `Listo: ${n === 1 ? 'el clip sigue' : `${n} clips siguen`} a quien habla. Podés ajustar cada posición con los fotogramas clave (◆).` : 'No encontré caras para seguir, o el video ya entra entero en el cuadro.');
}

// Sincroniza un clip con otro (dos cámaras, o una cámara y un grabador de audio) comparando el sonido
async function syncTo(c, otherId) {
  const o = find(otherId)?.c, ma = o && media.get(o.media), mb2 = media.get(c.media);
  if (!o || !ma?.hasAudio || !(mb2?.hasAudio || mb2?.type === 'audio')) return say('Los dos clips tienen que tener sonido para sincronizarlos.');
  say('Comparando el sonido de los dos clips…');
  try {
    const M = await mb(), ta = await trackOf(M, ma, 'audio'), tb = await trackOf(M, mb2, 'audio');
    // se comparan los primeros 4 minutos de cada archivo: un sonido a los t s de uno está a los t + lag s del otro
    const A = await Smart.envelope(M, ta, 0, Math.min(240, ma.duration)), B = await Smart.envelope(M, tb, 0, Math.min(240, mb2.duration));
    const lag = Smart.bestLag(A, B, 60);
    edit(() => {
      c.start = o.start + (c.in - lag - o.in) / sp(o);
      if (c.start < 0) { c.in += -c.start * sp(c); c.start = 0; }
    });
    say(`Sincronizado: corrido ${Math.abs(lag).toFixed(2)} s. Para cambiar de cámara, dividí la pista de arriba y borrá los tramos donde querés ver la otra.`);
  } catch (e) { say('No se pudo sincronizar: ' + (e.message || e)); }
  finally { inputs.clear(); }
}

const moveSel = d => { const f = sel && find(sel); if (f) edit(() => { f.c.start = Math.max(0, f.c.start + d); fitFree(f.t, f.c); }); };

// ---------- Vista previa ----------
const stage = $('stage'), sg = stage.getContext('2d');
function sizeStage() {
  const [a, b] = ASPECTS[P.aspect], box = $('stageWrap').getBoundingClientRect();
  const k = Math.min((box.width - 24) / a, (box.height - 24) / b), dpr = devicePixelRatio || 1;
  const w = Math.max(60, a * k), h = Math.max(60, b * k);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  stage.width = Math.round(w * dpr); stage.height = Math.round(h * dpr);
  dirty = true;
}
new ResizeObserver(() => P && sizeStage()).observe($('stageWrap'));

// Transiciones: la de un clip es la de entrada, desde el clip anterior de su misma pista
const TRANS = { none: 'Corte directo', disolver: 'Disolución cruzada', negro: 'Fundido a negro', blanco: 'Flash blanco', zoom: 'Zoom', deslizar: 'Deslizar', barrido: 'Barrido', desenfoque: 'Desenfoque', giro: 'Giro', glitch: 'Glitch' };
const NEEDS_PREV = new Set(['disolver', 'negro', 'zoom', 'deslizar', 'barrido', 'desenfoque', 'giro', 'glitch']);
const DIRS = { izq: [-1, 0], der: [1, 0], arriba: [0, -1], abajo: [0, 1] };
const prevOf = (t, c) => t.clips.find(o => o !== c && Math.abs(end(o) - c.start) < 0.02);
const nextOf = (t, c) => t.clips.find(o => o !== c && Math.abs(o.start - end(c)) < 0.02);
const trLen = c => c.tr && c.tr !== 'none' ? Math.min(c.trD, len(c)) : 0;
// Lo que un clip se sigue viendo después de su final, mientras dura la transición al siguiente
const tail = (t, c) => { const n = t.kind === 'video' && nextOf(t, c); return n && NEEDS_PREV.has(n.tr) ? trLen(n) : 0; };
const ease = p => p < 0.5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
const popEase = p => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;

// Sonido de la vista previa: cada clip pasa por su cadena de "Mejorar voz" y su volumen
let actx = null, master = null, meter = null, voiceMeter = null, duckNow = 1, gateOk = false, bypass = false, colorOff = false;
function audioCtx() {
  if (actx) return actx;
  try { actx = new AudioContext({ latencyHint: 'interactive' }); } catch { return null; }
  master = new GainNode(actx); meter = new AnalyserNode(actx, { fftSize: 2048 });
  master.connect(meter).connect(actx.destination);
  voiceMeter = new AnalyserNode(actx, { fftSize: 1024 }); // escucha solo las voces, para bajar la música
  Voz.loadGate(actx).then(ok => { gateOk = ok; });
  for (const el of els.values()) wire(el);
  return actx;
}
function wire(el) {
  if (!actx || el.cc) return;
  try { el.cc = { src: actx.createMediaElementSource(el), out: new GainNode(actx, { gain: 0 }), key: null }; el.cc.out.connect(master); }
  catch { el.cc = null; }
}
function route(el, c) { // arma (o rearma) la cadena de la voz cuando cambian sus ajustes
  const key = JSON.stringify(c.voz || null) + bypass + gateOk + !!c.duck;
  if (el.cc.key === key) return;
  el.cc.src.disconnect(); el.cc.chain?.output.disconnect(); el.cc.out.disconnect();
  el.cc.out.connect(master);
  if (!c.duck) el.cc.out.connect(voiceMeter);
  el.cc.chain = c.voz?.p && !bypass ? Voz.buildChain(actx, c.voz, gateOk) : null;
  el.cc.src.connect(el.cc.chain ? el.cc.chain.input : el.cc.out);
  el.cc.chain?.output.connect(el.cc.out);
  el.cc.key = key;
}

const els = new Map();  // id del clip → <video>/<audio> de la vista previa
function elFor(c) {
  let el = els.get(c.id);
  if (el) return el;
  const m = media.get(c.media);
  if (!m) return null;
  el = document.createElement(m.type === 'audio' ? 'audio' : 'video');
  el.preload = 'auto'; el.playsInline = true; el.src = m.url;
  el.onseeked = el.onloadeddata = () => { dirty = true; };
  $('pool').append(el); els.set(c.id, el); wire(el);
  return el;
}
function release(id) {
  const el = els.get(id);
  if (!el) return;
  if (el.cc) { el.cc.src.disconnect(); el.cc.chain?.output.disconnect(); el.cc.out.disconnect(); }
  el.pause(); el.removeAttribute('src'); el.load(); el.remove(); els.delete(id);
}
const releaseAll = () => [...els.keys()].forEach(release);

const fadeGain = (c, tc) => {
  let g = 1;
  if (c.fadeIn > 0 && tc < c.fadeIn) g *= tc / c.fadeIn;
  if (c.fadeOut > 0 && len(c) - tc < c.fadeOut) g *= (len(c) - tc) / c.fadeOut;
  return clamp(g, 0, 1);
};

// Mantiene cada <video>/<audio> en el punto justo según el cursor de la línea de tiempo
function syncMedia() {
  const live = new Set();
  for (const t of P.tracks) for (const c of t.clips) {
    const shown = end(c) + tail(t, c);
    if (!isAV(c, t) || T < c.start - 1.5 || T >= shown + 0.5) continue;
    const el = elFor(c);
    if (!el) continue;
    live.add(c.id);
    const on = T >= c.start && T < shown, want = Math.min(srcAt(c, T), media.get(c.media).duration - 0.05);
    if (el.playbackRate !== sp(c)) { el.playbackRate = sp(c); el.preservesPitch = true; }
    const audible = T >= c.start && T < end(c) && playing && !t.muted && !c.mute, v = audible ? c.vol * fadeGain(c, T - c.start) * (c.duck ? duckNow : 1) : 0;
    if (el.cc) { route(el, c); el.cc.out.gain.setTargetAtTime(v, actx.currentTime, 0.012); el.muted = false; }
    else { el.muted = !audible; el.volume = clamp(v, 0, 1); }
    if (!on) { // a punto de entrar: se deja listo en el primer cuadro
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - c.in) > 0.1) el.currentTime = c.in;
    } else if (playing) {
      if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - want) > 0.02) el.currentTime = want;
    }
  }
  for (const id of [...els.keys()]) if (!live.has(id)) release(id);
}

function bitmapOf(m) { // imagen decodificada (se carga una vez)
  if (m.bmp) return m.bmp;
  m.loading ??= createImageBitmap(m.blob).then(b => { m.bmp = b; dirty = true; return b; }).catch(() => null);
  return null;
}
function previewSrc(c) {
  const m = media.get(c.media);
  if (!m) return null;
  if (m.type === 'image') { const b = bitmapOf(m); return b && { w: b.width, h: b.height, paint: (g, ...r) => g.drawImage(b, ...r) }; }
  const el = els.get(c.id);
  return el && el.readyState >= 2 && el.videoWidth ? { w: el.videoWidth, h: el.videoHeight, paint: (g, ...r) => g.drawImage(el, ...r) } : null;
}

// Dibuja un instante del proyecto. srcOf(clip) devuelve { w, h, paint(g, x, y, w, h) } o null
function compose(g, t, srcOf) {
  const W = g.canvas.width, H = g.canvas.height;
  g.save();
  g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
  for (const tr of [...P.tracks].reverse()) {
    if (tr.hidden || tr.kind === 'audio') continue;
    if (tr.kind === 'text') {
      for (const c of tr.clips) if (t >= c.start && t < end(c)) c.sub ? drawSub(g, c, t) : drawText(g, c, t);
      continue;
    }
    const b = tr.clips.find(c => t >= c.start && t < end(c));
    if (!b) continue;
    const sb = srcOf(b), B = fx => sb && drawVisual(g, b, sb, fx, t), d = trLen(b);
    if (!d || t >= b.start + d) { B({}); continue; }
    const a = NEEDS_PREV.has(b.tr) ? prevOf(tr, b) : null, sa = a && srcOf(a);
    transition(g, b, ease((t - b.start) / d), sa ? fx => drawVisual(g, a, sa, fx, t) : null, B);
  }
  g.restore();
}
function transition(g, c, p, A, B) {
  const W = g.canvas.width, H = g.canvas.height, k = c.trK, [dx, dy] = DIRS[c.trDir] || DIRS.izq;
  const veil = (col, a) => { g.save(); g.globalAlpha = clamp(a, 0, 1); g.fillStyle = col; g.fillRect(0, 0, W, H); g.restore(); };
  switch (c.tr) {
    case 'disolver': A?.({}); B({ alpha: p }); break;
    case 'negro': if (p < 0.5) { A?.({}); veil('#000', p * 2); } else { B({}); veil('#000', 2 - p * 2); } break;
    case 'blanco': B({}); veil('#fff', (1 - p) * k); break;
    case 'zoom': p < 0.5 ? A?.({ k: 1 + p * k, blur: p * 16 * k }) : B({ k: 1 + (1 - p) * k, blur: (1 - p) * 16 * k }); break;
    case 'deslizar': A?.({ dx: dx * p, dy: dy * p }); B({ dx: dx * (p - 1), dy: dy * (p - 1) }); break;
    case 'barrido': A?.({}); B({ clip: dx < 0 ? [W * (1 - p), 0, W * p, H] : dx > 0 ? [0, 0, W * p, H] : dy < 0 ? [0, H * (1 - p), W, H * p] : [0, 0, W, H * p] }); break;
    case 'desenfoque': p < 0.5 ? A?.({ blur: p * 40 * k }) : B({ blur: (1 - p) * 40 * k }); break;
    case 'giro': p < 0.5 ? A?.({ rot: 180 * p * k * (dx || 1), k: 1 + p }) : B({ rot: -180 * (1 - p) * k * (dx || 1), k: 2 - p }); break;
    case 'glitch': (p < 0.5 ? A : B)?.({}); glitch(g, (1 - Math.abs(2 * p - 1)) * k, p); break;
    default: B({});
  }
}
function glitch(g, amt, p) { // franjas corridas y un halo de color: igual en la vista previa y en el video
  if (amt < 0.02) return;
  const W = g.canvas.width, H = g.canvas.height, rnd = i => { const x = Math.sin(i * 12.9898 + Math.floor(p * 24) * 78.233) * 43758.5453; return x - Math.floor(x); };
  g.save();
  for (let i = 0; i < 8; i++) { const y = rnd(i) * H, h = (0.02 + rnd(i + 9) * 0.08) * H; g.drawImage(g.canvas, 0, y, W, h, (rnd(i + 17) - 0.5) * W * 0.15 * amt, y, W, h); }
  g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.35 * amt; g.drawImage(g.canvas, W * 0.015 * amt, 0);
  g.restore();
}

// Corrección de color: exposición, contraste, saturación y matiz con filtros; temperatura y viñeta encima
const COLOR_KEYS = ['exp', 'con', 'sat', 'temp', 'hue', 'vig'];
const LOOKS = {
  podcast: { exp: 0.05, con: 0.15, sat: 0.1, temp: 0.1, hue: 0, vig: 0.15 },
  interiores: { exp: 0.15, con: 0.1, sat: 0.05, temp: -0.05, hue: 0, vig: 0 },
  calida: { exp: 0.03, con: 0.1, sat: 0.15, temp: 0.35, hue: 0, vig: 0.1 },
  fria: { exp: 0, con: 0.12, sat: -0.05, temp: -0.3, hue: 0, vig: 0.1 },
  cine: { exp: -0.03, con: 0.25, sat: -0.15, temp: -0.1, hue: 0, vig: 0.5 },
  neutro: { exp: 0, con: 0, sat: 0, temp: 0, hue: 0, vig: 0 }
};
const colorFilter = c => c.exp || c.con || c.sat || c.hue ? `brightness(${1 + c.exp * 0.5}) contrast(${1 + c.con * 0.6}) saturate(${1 + c.sat}) hue-rotate(${c.hue}deg)` : '';
const GRADE_KEYS = ['exp', 'con', 'sat', 'temp', 'tint', 'hue', 'vib', 'hl', 'sh', 'wh', 'bl'];
const needsGrade = c => !!c.lut || GRADE_KEYS.some(k => c[k]);
// LUTs: los de la biblioteca propia y los importados al proyecto (.cube)
const lutCache = new Map();
function lutOf(c) {
  if (!c.lut) return null;
  if (lutCache.has(c.lut)) return lutCache.get(c.lut);
  let l = null;
  if (Assets.LUTS[c.lut]) l = { size: Assets.LUT_SIZE, data: Assets.lutData(Assets.LUTS[c.lut].f) };
  else if (P.luts?.[c.lut]) l = P.luts[c.lut];
  if (l) lutCache.set(c.lut, l);
  return l;
}
// Fotogramas clave: x, y, zoom, rotación y opacidad pueden cambiar en el tiempo (tiempos desde el inicio del clip)
const KF_KEYS = ['x', 'y', 'scale', 'rot', 'opacity'];
function valAt(c, k, tt) {
  const l = c.kf?.[k];
  if (!l?.length) return c[k];
  if (tt <= l[0][0]) return l[0][1];
  for (let i = 1; i < l.length; i++) if (tt <= l[i][0]) { const [a, va] = l[i - 1], [b, vb] = l[i]; return va + (vb - va) * ease((tt - a) / (b - a || 1)); }
  return l.at(-1)[1];
}
const shiftKf = (kf, d) => kf ? Object.fromEntries(Object.entries(kf).map(([k, l]) => [k, l.map(([t, v]) => [t - d, v])])) : null;
let grainTile = null;
function grain(g, w, h, amt, t) { // grano de película: ruido que cambia 24 veces por segundo
  if (!grainTile) {
    grainTile = new OffscreenCanvas(256, 256);
    const gg = grainTile.getContext('2d'), im = gg.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    gg.putImageData(im, 0, 0);
  }
  const f = Math.floor(t * 24), ox = (f * 97) % 256, oy = (f * 57) % 256, pat = g.createPattern(grainTile, 'repeat');
  g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = amt * 0.45;
  g.translate(-w / 2 - ox, -h / 2 - oy); g.fillStyle = pat; g.fillRect(ox, oy, w, h);
  g.restore();
}
function drawVisual(g, c, s, fx = {}, t = T) {
  const W = g.canvas.width, H = g.canvas.height, tt = t - c.start, v = k => valAt(c, k, tt);
  const kb = c.kb ? 1 + c.kb * clamp(tt / Math.max(len(c), 0.1), 0, 1) : 1; // zoom lento a lo largo del clip
  const k = (c.fit === 'contain' ? Math.min(W / s.w, H / s.h) : Math.max(W / s.w, H / s.h)) * v('scale') * kb * (fx.k || 1), w = s.w * k, h = s.h * k;
  const alpha = v('opacity') * (fx.alpha ?? 1);
  g.save();
  if (fx.clip) { g.beginPath(); g.rect(...fx.clip); g.clip(); }
  if (c.bg === 'blur' && (w < W - 1 || h < H - 1)) { // fondo con la misma imagen desenfocada, en vez de bordes
    const kc = Math.max(W / s.w, H / s.h) * 1.15;
    g.save(); g.globalAlpha = alpha; g.filter = `blur(${Math.round(W / 28)}px) brightness(0.7)`;
    s.paint(g, (W - s.w * kc) / 2, (H - s.h * kc) / 2, s.w * kc, s.h * kc); g.restore();
  }
  g.globalAlpha = alpha;
  g.translate(W / 2 + (v('x') + (fx.dx || 0)) * W, H / 2 + (v('y') + (fx.dy || 0)) * H);
  const rot = v('rot') + (fx.rot || 0);
  if (rot) g.rotate(rot * Math.PI / 180);
  let paint = s.paint, graded = false;
  if (!colorOff && needsGrade(c)) { // color con la placa de video (luces, sombras, LUT…); si no hay, filtros simples
    const gw = Math.max(2, Math.min(s.w, Math.ceil(Math.abs(w)))), gh = Math.max(2, Math.round(gw * s.h / s.w));
    const out = GL.grade((gg, ww, hh) => s.paint(gg, 0, 0, ww, hh), gw, gh, c, lutOf(c), c.lut);
    if (out) { paint = (gg, x, y, ww, hh) => gg.drawImage(out, x, y, ww, hh); graded = true; }
  }
  const f = ((!graded && !colorOff ? colorFilter(c) : '') + (fx.blur ? ` blur(${(fx.blur * W / 1080).toFixed(1)}px)` : '')).trim();
  if (f) g.filter = f;
  paint(g, -w / 2, -h / 2, w, h);
  g.filter = 'none';
  if (!graded && !colorOff && c.temp) {
    g.globalCompositeOperation = 'soft-light'; g.globalAlpha *= Math.min(1, Math.abs(c.temp) * 0.8);
    g.fillStyle = c.temp > 0 ? '#ff9a3c' : '#3c8cff'; g.fillRect(-w / 2, -h / 2, w, h);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = alpha;
  }
  if (c.grain && !colorOff) grain(g, w, h, c.grain, t);
  if (!colorOff && c.vig) {
    const r = Math.hypot(Math.min(w, W), Math.min(h, H)) / 2, gr = g.createRadialGradient(0, 0, r * 0.45, 0, 0, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.85 * c.vig})`);
    g.fillStyle = gr; g.fillRect(-w / 2, -h / 2, w, h);
  }
  g.restore();
}
function wrap(g, text, max) {
  const out = [];
  for (const par of String(text).split('\n')) {
    let line = '';
    for (const w of par.split(/\s+/).filter(Boolean)) {
      const tryL = line ? line + ' ' + w : w;
      if (line && g.measureText(tryL).width > max) { out.push(line); line = w; } else line = tryL;
    }
    out.push(line);
  }
  return out;
}
const ANIMS = { ninguna: 'Sin animación', aparecer: 'Aparecer', subir: 'Subir', pop: 'Pop', maquina: 'Máquina de escribir' };
function drawText(g, c, t) {
  const W = g.canvas.width, H = g.canvas.height, fs = c.size * H, lh = fs * 1.2;
  const p = clamp((t - c.start) / 0.35, 0, 1), e = 1 - (1 - p) ** 3;
  let text = c.text;
  if (c.anim === 'maquina') text = text.slice(0, Math.ceil(text.length * clamp((t - c.start) / Math.max(0.6, text.length * 0.04), 0, 1)));
  g.save();
  g.font = `${c.weight} ${fs}px ${FONTS[c.font] || FONTS.montserrat}, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const full = wrap(g, c.text, W * 0.88), ls = c.anim === 'maquina' ? wrap(g, text, W * 0.88) : full;
  const cx = W / 2 + c.x * W, cy = H / 2 + c.y * H, y0 = cy - (full.length - 1) * lh / 2;
  if (c.anim === 'aparecer' || c.anim === 'subir') g.globalAlpha = e;
  if (c.anim === 'subir') g.translate(0, (1 - e) * fs);
  if (c.anim === 'pop') { const s = popEase(clamp((t - c.start) / 0.25, 0, 1)); g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy); }
  ls.forEach((l, i) => {
    const y = y0 + i * lh;
    if (c.box !== 'none' && l) {
      const w = g.measureText(full[i] || l).width + fs * 0.7, a = g.globalAlpha;
      g.globalAlpha = a * (c.box === 'semi' ? 0.6 : 1); g.fillStyle = c.boxColor;
      g.beginPath(); g.roundRect(cx - w / 2, y - lh / 2, w, lh, fs * 0.2); g.fill();
      g.globalAlpha = a;
    }
    if (c.stroke) { g.lineWidth = fs * 0.16; g.strokeStyle = '#000'; g.strokeText(l, cx, y); }
    g.fillStyle = c.color; g.fillText(l, cx, y);
  });
  g.restore();
}

// Subtítulos: todos usan el estilo del proyecto; la palabra que se está diciendo se destaca
const SUBSTYLES = {
  amarillo: { label: 'Palabra activa en amarillo', font: 'montserrat', weight: 900, color: '#ffffff', hi: '#ffd400', stroke: true },
  dinamico: { label: 'Dinámico de redes', font: 'anton', weight: 400, color: '#ffffff', hi: '#ffd400', stroke: true, upper: true, pop: true, grow: 1.15 },
  destacadas: { label: 'Frases destacadas', font: 'montserrat', weight: 900, color: '#ffffff', hiBox: '#ffd400', hiText: '#0a0a0a', stroke: true, upper: true },
  pro: { label: 'Podcast profesional', font: 'jakarta', weight: 700, color: '#ffffff', box: 'rgba(0,0,0,.62)' },
  contorno: { label: 'Blanco con contorno negro', font: 'montserrat', weight: 800, color: '#ffffff', stroke: true },
  periodistico: { label: 'Periodístico', font: 'jakarta', weight: 700, color: '#ffffff', box: '#111111', scale: 0.85 },
  documental: { label: 'Documental', font: 'playfair', weight: 400, color: '#ffffff', shadow: true, scale: 0.85 },
  minimal: { label: 'Minimalista', font: 'jakarta', weight: 500, color: '#ffffff', shadow: true, scale: 0.8 }
};
const SUBDEF = { style: 'amarillo', size: 0.055, y: 0.22, words: 3, upper: false };
const wordsOf = c => c.text.split(/\s+/).filter(Boolean);
const timesOf = c => { const w = wordsOf(c); return c.words?.length === w.length ? c.words : w.map((_, i) => [i * len(c) / w.length, (i + 1) * len(c) / w.length]); };
function drawSub(g, c, t) {
  const st = SUBSTYLES[P.sub.style] || SUBSTYLES.amarillo, W = g.canvas.width, H = g.canvas.height;
  const fs = P.sub.size * H * (st.scale || 1), lh = fs * 1.25, tt = t - c.start;
  const words = wordsOf(c).map(w => st.upper || P.sub.upper ? w.toLocaleUpperCase('es') : w), tm = timesOf(c);
  let act = -1;
  tm.forEach(([a], i) => { if (a <= tt + 0.02) act = i; });
  g.save();
  g.font = `${st.weight} ${fs}px ${FONTS[st.font]}, sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round';
  const sp = g.measureText(' ').width + fs * ((st.stroke ? 0.18 : 0.06) + (st.grow ? 0.15 : 0)), ws = words.map(w => g.measureText(w).width), lines = [[]];
  let lw = 0;
  words.forEach((_, i) => {
    if (lines.at(-1).length && lw + sp + ws[i] > W * 0.86) { lines.push([]); lw = 0; }
    lw += (lines.at(-1).length ? sp : 0) + ws[i]; lines.at(-1).push(i);
  });
  const cy = H / 2 + P.sub.y * H, y0 = cy - (lines.length - 1) * lh / 2;
  if (st.pop) { const s = popEase(clamp(tt / 0.18, 0, 1)); g.translate(W / 2, cy); g.scale(s, s); g.translate(-W / 2, -cy); }
  if (st.shadow) { g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = fs * 0.3; g.shadowOffsetY = fs * 0.06; }
  lines.forEach((ids, li) => {
    const y = y0 + li * lh, total = ids.reduce((s, i) => s + ws[i], 0) + sp * (ids.length - 1);
    let x = W / 2 - total / 2;
    if (st.box) { g.fillStyle = st.box; g.beginPath(); g.roundRect(x - fs * 0.35, y - lh / 2, total + fs * 0.7, lh, fs * 0.18); g.fill(); }
    for (const i of ids) {
      const on = i === act, cx = x + ws[i] / 2;
      g.save();
      if (on && st.grow) { g.translate(cx, y); g.scale(st.grow, st.grow); g.translate(-cx, -y); }
      if (on && st.hiBox) { g.fillStyle = P.sub.hi || st.hiBox; g.beginPath(); g.roundRect(x - fs * 0.15, y - lh * 0.48, ws[i] + fs * 0.3, lh * 0.96, fs * 0.15); g.fill(); }
      if (st.stroke) { g.lineWidth = fs * 0.16; g.strokeStyle = '#000'; g.strokeText(words[i], x, y); }
      g.fillStyle = on ? st.hiText || (st.hi && (P.sub.hi || st.hi)) || st.color : st.color;
      g.fillText(words[i], x, y);
      g.restore();
      x += ws[i] + sp;
    }
  });
  g.restore();
}
function guides(g) { // zona segura de Reels/TikTok/Shorts: ahí no tapa la interfaz de la app
  if (!P.safe || P.aspect !== '9:16') return;
  const W = g.canvas.width, H = g.canvas.height;
  g.save(); g.setLineDash([6, 6]); g.strokeStyle = '#ffd40099'; g.lineWidth = Math.max(1, W / 360);
  g.strokeRect(W * 0.06, H * 0.12, W * 0.8, H * 0.66);
  g.restore();
}
// ¿Algún video visible todavía está buscando su cuadro? Entonces se espera, así no parpadea en negro
function waiting() {
  for (const t of P.tracks) if (t.kind === 'video' && !t.hidden) for (const c of t.clips) {
    if (T < c.start || T >= end(c) || media.get(c.media)?.type !== 'video') continue;
    const el = els.get(c.id);
    if (!el || el.seeking || el.readyState < 2) return true;
  }
  return false;
}
// Medidor de nivel: muestra el pico y avisa si el sonido se satura
let peakUntil = 0;
const meterBuf = new Float32Array(2048);
function readMeter() {
  if (!meter || !playing) { $('meter').style.setProperty('--lv', 0); return; }
  meter.getFloatTimeDomainData(meterBuf);
  let pk = 0;
  for (const x of meterBuf) pk = Math.max(pk, Math.abs(x));
  const db = 20 * Math.log10(Math.max(pk, 1e-5));
  $('meter').style.setProperty('--lv', clamp((db + 48) / 48, 0, 1));
  if (pk >= 0.99) peakUntil = performance.now() + 1500;
  voiceMeter.getFloatTimeDomainData(meterBuf.subarray(0, 1024));
  let vs = 0; for (let i = 0; i < 1024; i++) vs += meterBuf[i] * meterBuf[i];
  duckNow += ((Math.sqrt(vs / 1024) > 0.01 ? 0.28 : 1) - duckNow) * 0.15;
  $('peak').hidden = performance.now() > peakUntil;
}
let waitFrom = 0;
function draw() {
  const D = dur();
  $('clock').firstChild.nodeValue = fmt(T) + ' ';
  $('clock').lastChild.textContent = '/ ' + fmt(D);
  $('head').style.left = HW + T * pps + 'px';
  if (playing) { // la línea de tiempo sigue al cursor
    const tl = $('tl'), x = HW + T * pps;
    if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft + HW) tl.scrollLeft = x - HW - 30;
  }
  if (waiting()) { waitFrom ||= performance.now(); if (performance.now() - waitFrom < 500) return false; }
  waitFrom = 0;
  compose(sg, T, previewSrc); guides(sg); markWord(); refreshKf();
  return true;
}
function loop(now) {
  if (playing) {
    T = p0 + (now - t0) / 1000;
    if (T >= dur() || (stopAt != null && T >= stopAt)) { T = Math.min(T, dur()); pause(); }
    dirty = true;
  }
  if (P) { syncMedia(); readMeter(); if (dirty && draw()) dirty = false; }
  requestAnimationFrame(loop);
}
function play() {
  if (!dur()) return say('Importá un video para empezar.');
  if (audioCtx()?.state === 'suspended') actx.resume();
  if (T >= dur() - 0.05) T = 0;
  playing = true; t0 = performance.now(); p0 = T;
  $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pausar (Espacio)');
}
function pause() {
  playing = false; stopAt = null;
  for (const el of els.values()) el.pause();
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Reproducir (Espacio)');
  dirty = true;
}
const toggle = () => playing ? pause() : play();
function seek(t) { T = clamp(t, 0, Math.max(dur(), 0)); if (playing) { p0 = T; t0 = performance.now(); } dirty = true; }

// ---------- Línea de tiempo ----------
const tl = $('tl'), tlIn = $('tlIn');
const zoomToPps = v => 2 * Math.pow(250, v / 100);            // 2 a 500 píxeles por segundo
const ppsToZoom = p => 100 * Math.log(p / 2) / Math.log(250);
function setPps(p, anchorT = T) {
  const x = HW + anchorT * pps - tl.scrollLeft;
  pps = clamp(p, 2, 500); $('zoom').value = ppsToZoom(pps);
  renderTimeline();
  tl.scrollLeft = HW + anchorT * pps - x;
}
const fitZoom = () => setPps((tl.clientWidth - 160) / Math.max(dur(), 10), 0);
const fitIfNeeded = () => { if (HW + dur() * pps > tl.scrollLeft + tl.clientWidth) fitZoom(); };

function clipLabel(c, t) {
  if (t.kind === 'text') return c.text.replace(/\s+/g, ' ') || 'Texto';
  return media.get(c.media)?.name || 'Archivo que falta';
}
function renderTimeline() {
  const W = (Math.max(dur(), 10) + 20) * pps;
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * pps >= 70) || 600;
  const ruler = Object.assign(document.createElement('div'), { id: 'ruler' });
  ruler.style.width = W + 'px';
  ruler.setAttribute('aria-hidden', 'true');
  for (let s = 0; s * pps < W; s += step) {
    const sp = document.createElement('span');
    sp.style.left = s * pps + 'px'; sp.textContent = step < 1 ? fmt(s) : fmt(s).replace(/\.0$/, '');
    ruler.append(sp);
  }
  for (const [a, b] of silMarks) { const i = document.createElement('i'); i.style.left = a * pps + 'px'; i.style.width = Math.max(2, (b - a) * pps) + 'px'; ruler.append(i); }
  const rows = [Object.assign(document.createElement('div'), { className: 'corner' }), ruler];
  for (const t of P.tracks) {
    const th = document.createElement('div');
    th.className = 'th';
    th.append(Object.assign(document.createElement('span'), { textContent: t.name, title: t.name }));
    const tb = (txt, label, pressed, fn) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: txt, title: label, onclick: fn });
      b.setAttribute('aria-label', `${label}: ${t.name}`);
      if (pressed !== null) b.setAttribute('aria-pressed', pressed);
      return b;
    };
    if (t.kind !== 'audio') th.append(tb(t.hidden ? '◌' : '◉', 'Ocultar pista', t.hidden, () => edit(() => { t.hidden = !t.hidden; })));
    if (t.kind !== 'text') th.append(tb(t.muted ? '🔇' : '🔊', 'Silenciar pista', t.muted, () => edit(() => { t.muted = !t.muted; })));
    th.append(tb('✕', 'Borrar pista', null, () => {
      if (t.clips.length && !confirm(`¿Borrar la pista «${t.name}» y sus ${t.clips.length} clip(s)?`)) return;
      edit(() => { P.tracks = P.tracks.filter(x => x !== t); if (sel && !find(sel)) sel = null; });
    }));
    const lane = document.createElement('div');
    lane.className = 'lane k-' + t.kind; lane.dataset.track = t.id; lane.style.width = W + 'px';
    th.style.height = t.kind === 'text' ? '38px' : '52px';
    for (const c of t.clips) {
      const m = media.get(c.media), el = document.createElement('div'), label = clipLabel(c, t);
      el.className = `clip k-${t.kind}${sel === c.id ? ' sel' : ''}${t.kind !== 'text' && (c.mute || t.muted) ? ' muted' : ''}${c.tr && c.tr !== 'none' ? ' tr' : ''}${c.voz?.p ? ' voz' : ''}`;
      if (c.tr && c.tr !== 'none') el.title = 'Transición: ' + TRANS[c.tr];
      el.dataset.id = c.id; el.tabIndex = 0;
      el.style.left = c.start * pps + 'px'; el.style.width = Math.max(6, len(c) * pps) + 'px';
      if (m?.thumb && t.kind === 'video') el.style.backgroundImage = `url(${m.thumb})`;
      el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', sel === c.id);
      el.setAttribute('aria-label', `${NAMES[t.kind]}: ${label}, de ${fmt(c.start)} a ${fmt(end(c))}`);
      el.innerHTML = '<i class="h l" aria-hidden="true"></i><span></span><i class="h r" aria-hidden="true"></i>';
      el.querySelector('span').textContent = label;
      if (c.kf) for (const tk of new Set(Object.values(c.kf).flat().map(([k]) => +k.toFixed(2)))) if (tk >= 0 && tk <= len(c)) { const d = document.createElement('b'); d.className = 'kfm'; d.style.left = tk * pps + 'px'; el.append(d); }
      lane.append(el);
    }
    rows.push(th, lane);
  }
  const head = Object.assign(document.createElement('div'), { id: 'head' });
  head.style.left = HW + T * pps + 'px';
  tlIn.replaceChildren(...rows, head);
  $('split').disabled = $('dup').disabled = $('del').disabled = !sel;
  $('detach').disabled = !(sel && find(sel)?.t.kind === 'video' && media.get(find(sel).c.media)?.type === 'video');
}

// Arrastrar: mover clips (también entre pistas), recortar bordes y mover el cursor
let drag = null;
const timeAt = x => Math.max(0, (x - tlIn.getBoundingClientRect().left - HW) / pps);
function snapPts(except) {
  const pts = [0, T];
  for (const t of P.tracks) for (const c of t.clips) if (c !== except) pts.push(c.start, end(c));
  return pts;
}
const snapTo = (v, pts) => { for (const p of pts) if (Math.abs(p - v) * pps < 8) return p; return null; };

tlIn.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const clipEl = e.target.closest('.clip');
  if (e.target.closest('#ruler') || (!clipEl && e.target.closest('.lane'))) {
    if (!clipEl && e.target.closest('.lane') && sel) { sel = null; renderTimeline(); renderProps(); }
    drag = { mode: 'scrub' }; seek(timeAt(e.clientX));
  } else if (clipEl) {
    const f = find(clipEl.dataset.id);
    if (!f) return;
    if (sel !== f.c.id) { sel = f.c.id; renderProps(); }
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const others = f.t.clips.filter(o => o !== f.c);
    drag = {
      mode, f, x0: e.clientX, before: snap(), c0: { ...f.c }, pts: snapPts(f.c), moved: false,
      prevEnd: Math.max(0, ...others.filter(o => end(o) <= f.c.start + 1e-6).map(end)),
      nextStart: Math.min(Infinity, ...others.filter(o => o.start >= end(f.c) - 1e-6).map(o => o.start))
    };
    renderTimeline();
    tlIn.querySelector(`[data-id="${f.c.id}"]`)?.focus({ preventScroll: true });
  } else return;
  tlIn.setPointerCapture(e.pointerId);
  e.preventDefault();
});
tlIn.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.mode === 'scrub') return seek(timeAt(e.clientX));
  const { f, c0 } = drag, c = f.c, dx = (e.clientX - drag.x0) / pps;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
  drag.moved = true;
  const av = isAV(c, f.t), m = media.get(c.media);
  if (drag.mode === 'move') {
    let s = Math.max(0, c0.start + dx);
    const a = snapTo(s, drag.pts), b = snapTo(s + len(c), drag.pts);
    s = a ?? (b !== null ? b - len(c) : s);
    c.start = Math.max(0, s);
    // pasar a otra pista del mismo tipo
    const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lane');
    const to = lane && P.tracks.find(t => t.id === lane.dataset.track);
    if (to && to !== f.t && to.kind === f.t.kind) { f.t.clips = f.t.clips.filter(x => x !== c); to.clips.push(c); f.t = to; }
  } else if (drag.mode === 'l') {
    let s = clamp(c0.start + dx, drag.prevEnd, end(c0) - MIN);
    s = snapTo(s, drag.pts) ?? s;
    if (av) s = Math.max(s, c0.start - c0.in / sp(c0)); // no se puede estirar antes del principio del archivo
    if (av) c.in = c0.in + (s - c0.start) * sp(c0); else c.out = c0.out - (s - c0.start);
    c.kf = shiftKf(c0.kf, s - c0.start);
    c.start = s;
  } else {
    let e2 = clamp(end(c0) + dx, c0.start + MIN, drag.nextStart);
    e2 = snapTo(e2, drag.pts) ?? e2;
    if (av && m) e2 = Math.min(e2, c0.start + (m.duration - c0.in) / sp(c0));
    c.out = c.in + (e2 - c.start) * sp(c);
  }
  renderTimeline(); dirty = true;
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'scrub' || !d.moved) return;
  if (d.mode === 'move') fitFree(d.f.t, d.f.c);
  if (remember(d.before)) changed(); else renderTimeline();
};
tlIn.addEventListener('pointerup', endDrag);
tlIn.addEventListener('pointercancel', endDrag);
tl.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setPps(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), timeAt(e.clientX));
}, { passive: false });
tlIn.addEventListener('focusin', e => {
  const c = e.target.closest('.clip');
  if (c && sel !== c.dataset.id && !drag) { sel = c.dataset.id; renderProps(); renderTimeline(); tlIn.querySelector(`[data-id="${sel}"]`)?.focus(); }
});

// Soltar archivos de la lista en una pista
tlIn.addEventListener('dragover', e => {
  const lane = e.target.closest('.lane');
  if (!lane || !e.dataTransfer.types.includes('text/x-clipcreate')) return;
  e.preventDefault();
  tlIn.querySelectorAll('.lane.over').forEach(l => l.classList.remove('over'));
  lane.classList.add('over');
});
tlIn.addEventListener('dragleave', e => e.target.closest?.('.lane')?.classList.remove('over'));
tlIn.addEventListener('drop', e => {
  const lane = e.target.closest('.lane'), mid = e.dataTransfer.getData('text/x-clipcreate');
  tlIn.querySelectorAll('.lane.over').forEach(l => l.classList.remove('over'));
  if (!lane || !media.has(mid)) return;
  e.preventDefault(); e.stopPropagation();
  const t = P.tracks.find(x => x.id === lane.dataset.track);
  edit(() => addMedia(mid, timeAt(e.clientX), t));
  fitIfNeeded();
});

// ---------- Lista de archivos ----------
function renderBin() {
  const used = new Set(P.tracks.flatMap(t => t.clips.map(c => c.media)));
  $('bin').replaceChildren(...P.media.map(id => {
    const m = media.get(id), li = document.createElement('li');
    if (!m) { li.innerHTML = '<span class="ph">?</span><div><b class="miss">Archivo que falta</b></div>'; return li; }
    li.draggable = true;
    li.ondragstart = e => { e.dataTransfer.setData('text/x-clipcreate', id); e.dataTransfer.effectAllowed = 'copy'; };
    const pic = m.thumb ? Object.assign(new Image(), { src: m.thumb, alt: '' }) : Object.assign(document.createElement('span'), { className: 'ph', textContent: m.type === 'audio' ? '♪' : '▣' });
    const info = document.createElement('div');
    info.append(Object.assign(document.createElement('b'), { textContent: m.name, title: m.name }),
      Object.assign(document.createElement('small'), { textContent: `${{ video: 'Video', audio: 'Audio', image: 'Imagen' }[m.type]} · ${fmt(m.duration)}${used.has(id) ? '' : ' · sin usar'}` }));
    const add = Object.assign(document.createElement('button'), { type: 'button', className: 'ico', textContent: '+', onclick: () => { edit(() => addMedia(id)); fitIfNeeded(); } });
    add.setAttribute('aria-label', `Agregar «${m.name}» en el cursor`);
    li.append(pic, info, add);
    return li;
  }));
}

// ---------- Textos predeterminados ----------
const PRESETS = [
  { label: 'Título', desc: 'Grande, amarillo, arriba', text: 'TÍTULO', font: 'anton', weight: 400, size: 0.085, color: '#ffd400', y: -0.3 },
  { label: 'Subtítulo', desc: 'Blanco con contorno negro', text: 'Escribí tu texto', font: 'montserrat', weight: 800, size: 0.05, y: 0.22 },
  { label: 'Nombre y cargo', desc: 'Para presentar al invitado', text: 'Nombre Apellido\nCargo o profesión', font: 'montserrat', weight: 700, size: 0.036, color: '#0a0a0a', stroke: false, box: 'solid', boxColor: '#ffd400', y: 0.3, out: 5 },
  { label: 'Etiqueta de redes', desc: 'Tu @ en una caja', text: '@tucuenta', font: 'jakarta', weight: 700, size: 0.034, stroke: false, box: 'semi', boxColor: '#000000', y: -0.38, out: 5 },
  { label: 'Frase destacada', desc: 'Para la idea fuerte del clip', text: '“Una frase que pegue”', font: 'playfair', weight: 700, size: 0.055, stroke: false, box: 'solid', boxColor: '#000000', y: 0 },
  { label: 'Emoji', desc: 'Grande, con animación pop', text: '🔥', font: 'jakarta', weight: 400, size: 0.12, stroke: false, y: -0.15, anim: 'pop', out: 2 },
  { label: 'Pregunta al público', desc: 'Para que comenten', text: '¿Vos qué pensás?\nDejalo en los comentarios 👇', font: 'montserrat', weight: 800, size: 0.04, stroke: false, box: 'solid', boxColor: '#ffffff', color: '#0a0a0a', y: 0.3, anim: 'subir', out: 4 }
];
$('presets').replaceChildren(...PRESETS.map(p => {
  const b = Object.assign(document.createElement('button'), { type: 'button', onclick: () => addText(p) });
  b.append(p.label, Object.assign(document.createElement('span'), { textContent: p.desc }));
  return b;
}));

// ---------- Subtítulos ----------
const subClips = () => P.tracks.filter(t => t.kind === 'text').flatMap(t => t.clips.filter(c => c.sub)).sort((a, b) => a.start - b.start);
function subTrack() {
  let t = P.tracks.find(t => t.kind === 'text' && t.clips.some(c => c.sub)) || P.tracks.find(t => t.kind === 'text' && t.name === 'Subtítulos');
  if (!t) { t = newTrack('text'); t.name = 'Subtítulos'; }
  return t;
}
const dropSubs = () => { for (const t of P.tracks) if (t.kind === 'text') t.clips = t.clips.filter(c => !c.sub); };
// Arma las líneas: hasta N palabras, cortando también al final de cada frase; cada línea queda hasta que empieza la siguiente
function linesFrom(ws, n) {
  const out = [];
  for (let i = 0, j = 0; i < ws.length; i++) {
    const group = ws.slice(j, i + 1), last = i === ws.length - 1, text = group.map(w => w.w).join(' ');
    if (!last && group.length < n && text.length <= n * 7 && !/[.?!…]$/.test(ws[i].w)) continue;
    const a = group[0].a, nx = ws[i + 1], b = nx && nx.a - ws[i].b < 0.6 ? nx.a : ws[i].b + 0.2;
    out.push({ ...DEF.text, id: S.uid(), sub: true, start: a, in: 0, out: Math.max(MIN, Math.min(b, nx ? nx.a : b) - a), text, words: group.map(w => [w.a - a, w.b - a]) });
    j = i + 1;
  }
  return out;
}
const wordList = () => subClips().flatMap(c => { const tm = timesOf(c); return wordsOf(c).map((w, i) => ({ w, a: c.start + tm[i][0], b: c.start + tm[i][1] })); });
function regroup() { const ws = wordList(); if (ws.length) { dropSubs(); subTrack().clips.push(...linesFrom(ws, P.sub.words)); } }
// La misma huella que usa ClipCreate: así un video que ya se transcribió allá no cuenta dos veces en el plan
function videoId() {
  const m = [...media.values()].filter(x => x.type === 'video').sort((a, b) => b.duration - a.duration)[0];
  if (!m) return 'editor-' + P.id;
  let h = 2166136261;
  for (const ch of m.name) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `${m.blob.size}-${h.toString(36)}`;
}
// El sonido de todo el proyecto (con la voz mejorada, si está activa) a 16 kHz mono: para transcribir y medir silencios
async function voicePcm() { // solo las voces: la música marcada "Bajar cuando hablan" no entra
  const D = dur(), M = await mb(), pcm = new Float32Array(Math.ceil(D * 16000) + 16000);
  let w = 0;
  const mix = mixer(M, async (L, R) => {
    for (let i = 0; i + 2 < L.length; i += 3) pcm[w++] = (L[i] + R[i] + L[i + 1] + R[i + 1] + L[i + 2] + R[i + 2]) / 6;
    say(`Preparando el audio… ${Math.round(w / 16000 / D * 100)} %`);
  }, { voiceOnly: true });
  try { await mix.until(D); } finally { mix.close(); inputs.clear(); }
  return { M, pcm: pcm.subarray(0, w) };
}
let subBusy = false;
async function genSubs() {
  if (subBusy) { job.cancel = true; Sub.stopLocal(); return; }
  const D = dur();
  if (!soundClips().length) return say('No hay audio para transcribir: importá un video o un audio.');
  if (subClips().length && !confirm('Ya hay subtítulos. ¿Reemplazarlos por unos nuevos?')) return;
  subBusy = true; job.cancel = false; pause();
  $('subGen').textContent = 'Cancelar'; $('subGen').classList.remove('go');
  try {
    const { M, pcm } = await voicePcm();
    if (job.cancel) return say('Cancelado.');
    const segs = await Sub.transcribe(M, pcm, {
      videoId: videoId(), model: $('subModel').value, cancelled: () => job.cancel,
      onLoad: p => say(`Descargando el modelo de voz (solo la primera vez)… ${Math.round(p)} %`),
      onProgress: (p, where) => say(`Transcribiendo en ${where === 'servidor' ? 'el servidor' : 'la compu'}… ${Math.round(p * 100)} %`)
    });
    if (!segs) return say('Cancelado.');
    if (!segs.length) return say('No se encontró voz para transcribir.');
    const ws = segs.flatMap(sg => sg.text.split(' ').map((x, i) => ({ w: x, a: sg.w[i][0], b: sg.w[i][1] })));
    edit(() => { dropSubs(); subTrack().clips.push(...linesFrom(ws, P.sub.words)); });
    say(`Listo: ${subClips().length} subtítulos. Revisalos en la lista y corregí nombres o palabras.${segs.every(x => x.exact) ? '' : ' Los tiempos de cada palabra son aproximados (con tu cuenta de ClipCreate salen exactos).'}`);
  } catch (e) { say(e.message || String(e)); }
  finally { subBusy = false; job.cancel = false; $('subGen').textContent = 'Generar subtítulos'; $('subGen').classList.add('go'); }
}
function renderSubs() {
  if ($('pSubs').hidden) return;
  const on = !!Sub.session();
  $('subWhere').textContent = on ? 'Con tu cuenta de ClipCreate: el audio se manda al servidor para transcribirlo (rápido y con el tiempo exacto de cada palabra). No queda guardado.'
    : 'Sin cuenta: se transcribe en esta compu y no se sube nada. Tarda más y los tiempos de cada palabra son aproximados.';
  $('subModelL').hidden = on;
  $('subStyle').value = P.sub.style; $('subWords').value = P.sub.words; $('subSize').value = P.sub.size; $('subY').value = P.sub.y; $('subUpper').checked = P.sub.upper;
  $('subWordsO').textContent = P.sub.words; $('subSizeO').textContent = Math.round(P.sub.size * 1000) / 10 + ' %'; $('subYO').textContent = P.sub.y.toFixed(2);
  const list = subClips();
  $('subList').replaceChildren(...list.map(c => {
    const li = document.createElement('li'), b = Object.assign(document.createElement('button'), { type: 'button', textContent: fmt(c.start), onclick: () => { seek(c.start); sel = c.id; renderTimeline(); renderProps(); } });
    const inp = Object.assign(document.createElement('input'), { type: 'text', value: c.text });
    b.setAttribute('aria-label', `Ir a ${fmt(c.start)}`); inp.setAttribute('aria-label', `Subtítulo de ${fmt(c.start)}`);
    inp.onchange = () => { const v = inp.value.replace(/\s+/g, ' ').trim(); if (v && v !== c.text) edit(() => { c.text = v; }); };
    li.classList.toggle('on', T >= c.start && T < end(c));
    li.append(b, inp);
    return li;
  }));
  if (!list.length) $('subList').innerHTML = '<li class="hint" style="display:block">Todavía no hay subtítulos.</li>';
}
$('subStyle').innerHTML = Object.entries(SUBSTYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
let subPending = null;
for (const id of ['subStyle', 'subWords', 'subSize', 'subY', 'subUpper']) {
  $(id).addEventListener('input', () => {
    subPending ??= snap();
    const k = { subStyle: 'style', subWords: 'words', subSize: 'size', subY: 'y', subUpper: 'upper' }[id], el = $(id);
    P.sub[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    if (k === 'words') regroup();
    dirty = true; renderSubs();
  });
  $(id).addEventListener('change', () => { const s = subPending; subPending = null; if (s && remember(s)) changed(); });
}
$('subGen').onclick = genSubs;
$('subExport').onclick = () => exportSubs('srt').then(() => say($('xMsg').textContent));
$('subImport').onclick = () => $('subFile').click();
$('subFile').onchange = async () => {
  const f = $('subFile').files[0]; $('subFile').value = '';
  if (!f) return;
  const items = Sub.parseSubs(await f.text());
  if (!items.length) return say('Ese archivo no tiene subtítulos que se puedan leer (tiene que ser .srt o .vtt).');
  if (subClips().length && !confirm('Ya hay subtítulos. ¿Reemplazarlos por los del archivo?')) return;
  edit(() => { dropSubs(); subTrack().clips.push(...items.map(x => ({ ...DEF.text, id: S.uid(), sub: true, start: x.a, in: 0, out: x.b - x.a, text: x.text }))); });
  say(`Listo: ${items.length} subtítulos importados.`);
};

// ---------- Biblioteca propia ----------
const brand = () => { try { return JSON.parse(localStorage.getItem('clipcreate.marca') || '{}'); } catch { return {}; } };
function namedTrack(kind, name) {
  let t = P.tracks.find(x => x.kind === kind && x.name === name);
  if (!t) { t = newTrack(kind); t.name = name; }
  return t;
}
// Reusa el archivo si ya está en el proyecto (así no se duplica en la lista)
async function libMedia(file) {
  const have = [...media.values()].find(m => m.name === file.name && P.media.includes(m.id));
  return have || importOne(file);
}
async function addLib(make, trackName, kind, props = {}) {
  try {
    const m = await libMedia(await make());
    const D = dur();
    edit(() => {
      const c = addMedia(m.id, T, namedTrack(kind, trackName));
      Object.assign(c, props);
      if (props.duck && D - c.start > 1) c.out = Math.min(c.out, c.in + D - c.start); // la música no estira el video
      fitFree(find(c.id).t, c);
    });
    fitIfNeeded();
    say(`Agregado: ${m.name.replace(' (ClipCreate)', '')}.`);
  } catch (e) { say('No se pudo agregar: ' + (e.message || e)); }
}
let previewAudio = null;
async function listen(lib, id) {
  previewAudio?.pause();
  const url = URL.createObjectURL(await Assets.sound(lib, id));
  previewAudio = new Audio(url); previewAudio.onended = () => URL.revokeObjectURL(url); previewAudio.play().catch(() => {});
}
function libButtons(box, lib, trackName, props) {
  $(box).replaceChildren(...Object.entries(lib).map(([id, x]) => {
    const d = document.createElement('div');
    const play = Object.assign(document.createElement('button'), { type: 'button', className: 'ico', textContent: '▶', onclick: () => listen(lib, id) });
    const add = Object.assign(document.createElement('button'), { type: 'button', textContent: x.label, title: `Agregar «${x.label}» en el cursor`, onclick: () => addLib(() => Assets.sound(lib, id), trackName, 'audio', props) });
    play.setAttribute('aria-label', `Escuchar ${x.label}`);
    d.append(play, add);
    return d;
  }));
}
libButtons('libSfx', Assets.SFX, 'Efectos', {});
libButtons('libMusic', Assets.MUSIC, 'Música', { vol: 0.35, duck: true, fadeIn: 1, fadeOut: 2 });
function renderGfx() {
  const b = brand();
  $('libGfx').replaceChildren(...Object.entries(Assets.GRAPHICS).map(([id, g]) => {
    const btn = Object.assign(document.createElement('button'), { type: 'button', title: g.label, onclick: () => addLib(() => Assets.graphic(id, b), 'Gráficos', 'video', { fit: 'contain', scale: 0.45, out: 3, bg: 'color' }) });
    btn.append(Object.assign(new Image(), { src: Assets.graphicPreview(id, b), alt: g.label }));
    return btn;
  }));
}
renderGfx();

// Marca del canal: se guarda en este navegador y se usa en los gráficos, la plantilla y los subtítulos
function renderBrand() {
  const b = brand();
  $('bName').value = b.name || ''; $('bHandle').value = b.handle || ''; $('bColor').value = b.color || '#ffd400'; $('bDark').value = b.dark || '#0a0a0a';
  $('bLogoPrev').hidden = !b.logo; if (b.logo) $('bLogoPrev').src = b.logo;
}
const saveBrand = patch => { try { localStorage.setItem('clipcreate.marca', JSON.stringify({ ...brand(), ...patch })); } catch { say('No hay lugar en el navegador para guardar la marca (probá con un logo más liviano).'); } renderGfx(); };
for (const [id, k] of [['bName', 'name'], ['bHandle', 'handle'], ['bColor', 'color'], ['bDark', 'dark']]) $(id).onchange = () => {
  let v = $(id).value.trim();
  if (k === 'handle' && v && !v.startsWith('@')) v = '@' + v;
  saveBrand({ [k]: v }); renderBrand();
};
$('bLogo').onchange = async () => {
  const f = $('bLogo').files[0]; $('bLogo').value = '';
  if (!f) return;
  try { // se achica a 512 px para que entre en el navegador
    const bm = await createImageBitmap(f), k = Math.min(1, 512 / Math.max(bm.width, bm.height)), cv = document.createElement('canvas');
    cv.width = Math.round(bm.width * k); cv.height = Math.round(bm.height * k); cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
    saveBrand({ logo: cv.toDataURL('image/png') }); renderBrand(); say('Logo guardado.');
  } catch { say('No se pudo abrir esa imagen.'); }
};
renderBrand();
async function applyTemplate() {
  const b = brand(), D = dur();
  if (!D) return say('Primero poné el video en la línea de tiempo.');
  let logo = null;
  if (b.logo) logo = await libMedia(new File([await (await fetch(b.logo)).blob()], 'Logo del canal.png', { type: 'image/png' })).catch(() => null);
  const color = b.color || '#ffd400', dark = b.dark || '#0a0a0a', at = Math.min(3, D * 0.2);
  edit(() => {
    if (logo) {
      const [A, B] = ASPECTS[P.aspect], W = A / B, kc = Math.min(W / logo.w, 1 / logo.h), scale = 0.2 * W / (logo.w * kc), hf = logo.h * kc * scale;
      namedTrack('video', 'Logo').clips = [{ ...DEF.video, id: S.uid(), media: logo.id, start: 0, in: 0, out: D, fit: 'contain', scale, x: 0.5 - 0.1 - 0.04, y: -0.5 + hf / 2 + 0.04, opacity: 0.9 }];
    }
    const t = namedTrack('text', 'Plantilla');
    t.clips = [
      { ...DEF.text, id: S.uid(), start: 0, in: 0, out: Math.min(2.5, D), text: (b.name || P.name).toUpperCase(), font: 'anton', weight: 400, size: 0.08, color, y: -0.28, anim: 'pop' },
      { ...DEF.text, id: S.uid(), start: at, in: 0, out: Math.min(5, D - at), text: 'Nombre Apellido\nCargo o profesión', font: 'montserrat', weight: 700, size: 0.036, color: dark, stroke: false, box: 'solid', boxColor: color, y: 0.3, anim: 'subir' },
      { ...DEF.text, id: S.uid(), start: Math.max(0, D - 3), in: 0, out: Math.min(3, D), text: `Seguinos en ${b.handle || '@tucuenta'}`, font: 'montserrat', weight: 800, size: 0.045, color: '#ffffff', stroke: false, box: 'solid', boxColor: dark, y: 0.3, anim: 'subir' }
    ];
    t.clips.forEach(c => fitFree(t, c));
    P.sub.hi = color;
  });
  say('Plantilla aplicada: tocá el nombre del invitado en la línea de tiempo para escribirlo.');
}
$('bApply').onclick = applyTemplate;

// ---------- IA: editar con el texto ----------
let trWords = [], trOn = -1;
function renderTranscript() {
  if ($('pAI').hidden) return;
  trWords = wordList(); trOn = -1;
  if (!trWords.length) { $('trText').innerHTML = '<p class="hint">Primero generá los subtítulos (pestaña Subtítulos): la transcripción sale de ahí.</p>'; return; }
  const frag = document.createDocumentFragment();
  trWords.forEach((w, i) => { const sp = document.createElement('span'); sp.dataset.i = i; sp.textContent = w.w; frag.append(sp, ' '); });
  $('trText').replaceChildren(frag);
}
function markWord() { // resalta la palabra que se está diciendo
  if ($('pAI').hidden || !trWords.length) return;
  const i = trWords.findIndex(w => T >= w.a && T < w.b + 0.05);
  if (i === trOn) return;
  $('trText').querySelector(`span[data-i="${trOn}"]`)?.classList.remove('on');
  const el = $('trText').querySelector(`span[data-i="${i}"]`);
  el?.classList.add('on'); trOn = i;
  if (el && playing) el.scrollIntoView({ block: 'nearest' });
}
$('trText').onclick = e => { const i = e.target.dataset?.i; if (i != null && getSelection().isCollapsed) seek(trWords[i].a); };
function cutSelection() {
  const r = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
  const spans = r && !r.collapsed ? [...$('trText').querySelectorAll('span')].filter(sp => r.intersectsNode(sp)) : [];
  if (!spans.length) return say('Seleccioná con el mouse las palabras que querés sacar del video.');
  const i0 = +spans[0].dataset.i, i1 = +spans.at(-1).dataset.i, ws = trWords;
  const a = i0 > 0 ? Math.max(ws[i0 - 1].b, ws[i0].a - 0.08) : Math.max(0, ws[i0].a - 0.08);
  const b = i1 < ws.length - 1 ? Math.min(ws[i1 + 1].a, ws[i1].b + 0.08) : ws[i1].b + 0.08;
  const txt = ws.slice(i0, i1 + 1).map(w => w.w).join(' ');
  edit(() => cutRange(a, b));
  getSelection().removeAllRanges();
  say(`Cortado: «${txt.length > 60 ? txt.slice(0, 60) + '…' : txt}» (${(b - a).toFixed(1)} s). Ctrl+Z lo vuelve a poner.`);
}
$('trCut').onclick = cutSelection;
$('trText').addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); cutSelection(); } });

// ---------- IA: silencios ----------
let silMarks = [];
const showSil = () => { $('silMinO').textContent = (+$('silMin').value).toFixed(1) + ' s'; $('silSensO').textContent = Math.round($('silSens').value * 100) + ' %'; };
$('silMin').oninput = $('silSens').oninput = showSil; showSil();
$('silFind').onclick = async () => {
  if (!soundClips().length) return say('No hay audio en el proyecto.');
  job.cancel = false; $('silFind').disabled = true;
  try {
    const { pcm } = await voicePcm();
    silMarks = Smart.silences(Sub.rmsOf(pcm), { min: +$('silMin').value, sens: +$('silSens').value }).filter(([, b]) => b <= dur());
    const tot = silMarks.reduce((s, [a, b]) => s + b - a, 0);
    $('silInfo').textContent = silMarks.length ? `Encontré ${silMarks.length} silencios: ${tot.toFixed(1)} s en total. Están marcados en rojo arriba de la línea de tiempo.` : 'No encontré silencios de ese largo.';
    say($('silInfo').textContent);
  } catch (e) { say(e.message || String(e)); }
  finally { $('silFind').disabled = false; $('silCut').disabled = !silMarks.length; renderTimeline(); }
};
$('silCut').onclick = () => {
  const marks = silMarks, tot = marks.reduce((s, [a, b]) => s + b - a, 0);
  edit(() => { for (const [a, b] of [...marks].reverse()) cutRange(a, b); });
  say(`Listo: saqué ${marks.length} silencios (${tot.toFixed(1)} s). Si algo quedó cortado, deshacé con Ctrl+Z.`);
};

// ---------- IA: Clips inteligentes ----------
function sentences() {
  const out = [];
  let cur = null;
  for (const w of wordList()) {
    if (cur && w.a - cur.b > 1.2) { out.push(cur); cur = null; }
    cur = cur ? { a: cur.a, b: w.b, text: cur.text + ' ' + w.w } : { a: w.a, b: w.b, text: w.w };
    if (/[.?!…]["»”']?$/.test(w.w) || cur.b - cur.a > 25) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
let picks = [], stopAt = null;
$('aiFind').onclick = async () => {
  const sents = sentences();
  if (sents.length < 3) return say('Primero generá los subtítulos: la IA lee la transcripción para elegir los momentos.');
  if (!Smart.aiReady()) return say('Para usar la IA, entrá con tu cuenta en ClipCreate o cargá una clave de DeepSeek en sus Ajustes.');
  const [min, max] = $('aiLen').value.split('-').map(Number);
  $('aiFind').disabled = true; say('La IA está leyendo la entrevista…');
  try {
    picks = (await Smart.findClips(sents, { n: +$('aiN').value, min, max, videoId: videoId() })).map(p => ({ ...p, on: true }));
    renderPicks();
    say(picks.length ? `La IA propone ${picks.length} clips. Miralos con «Ver», destildá los que no quieras y creá los demás.` : 'La IA no encontró clips de ese largo. Probá con otro largo.');
  } catch (e) { say(e.message || String(e)); }
  finally { $('aiFind').disabled = false; }
};
function renderPicks() {
  $('aiList').replaceChildren(...picks.map(c => {
    const li = document.createElement('li'), top = document.createElement('label');
    top.className = 'check';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: c.on, onchange: e => { c.on = e.target.checked; } });
    top.append(cb, Object.assign(document.createElement('b'), { textContent: c.title || 'Clip' }));
    const info = Object.assign(document.createElement('small'), { textContent: `${fmt(c.a)} a ${fmt(c.b)} · ${Math.round(c.b - c.a)} s · ${c.kind || 'clip'} · ${c.score}/10${c.hook ? ' · con gancho' : ''}` });
    const txt = Object.assign(document.createElement('p'), { textContent: c.text });
    const row = document.createElement('div'); row.className = 'row';
    row.append(Object.assign(document.createElement('button'), { type: 'button', textContent: 'Ver', onclick: () => { seek(c.a); stopAt = c.b; play(); } }),
      Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copiar descripción', onclick: () => navigator.clipboard?.writeText(c.desc).then(() => say('Descripción copiada.'), () => say(c.desc)) }));
    li.append(top, info, txt, row);
    return li;
  }));
  $('aiOpts').hidden = !picks.length;
}
$('aiMake').onclick = async () => {
  const list = picks.filter(p => p.on);
  if (!list.length) return say('Tildá al menos un clip.');
  const o = { vert: $('aiVert').checked, rf: $('aiReframe').checked, hook: $('aiHook').checked, title: $('aiTitle').checked };
  await save();
  const home = P, made = [], color = brand().color || '#ffd400';
  job.cancel = false; $('aiMake').disabled = true;
  try {
    for (const [i, c] of list.entries()) {
      say(`Armando el clip ${i + 1} de ${list.length}…`);
      const np = { id: S.uid(), name: c.title || `Clip ${i + 1}`, updated: Date.now(), aspect: o.vert ? '9:16' : home.aspect, bg: home.bg, safe: true, sub: { ...home.sub },
        luts: home.luts, media: [...home.media], desc: c.desc, tracks: [] };
      P = home; np.tracks = rangeTracks(o.hook && c.hook ? [c.hook, [c.a, c.b]] : [[c.a, c.b]]);
      if (o.title && c.title) np.tracks.unshift({ id: S.uid(), kind: 'text', name: 'Título', muted: false, hidden: false,
        clips: [{ ...DEF.text, id: S.uid(), start: 0, in: 0, out: 3, text: c.title.toUpperCase(), font: 'anton', weight: 400, size: 0.065, color, y: -0.3, anim: 'pop' }] });
      P = np; // el reencuadre trabaja sobre el clip nuevo
      if (o.rf && np.aspect !== '16:9') for (const t of np.tracks.filter(t => t.kind === 'video')) for (const x of t.clips) { if (job.cancel) break; await reframeClip(x).catch(() => false); }
      P = home;
      await S.put('projects', np);
      made.push(np);
    }
  } catch (e) { say(e.message || String(e)); }
  finally { P = home; $('aiMake').disabled = false; }
  if (!made.length) return;
  say(`Listo: ${made.length} proyecto(s) nuevos. Abrilos desde Proyectos, o exportalos todos juntos con Exportar → cola.`);
  $('aiList').prepend(...made.map(np => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('b'), { textContent: '✓ ' + np.name }),
      Object.assign(document.createElement('button'), { type: 'button', textContent: 'Abrir', onclick: async () => { await save(); openProject(np.id); } }));
    return li;
  }));
};
$('rfAll').onclick = () => reframe(tracks('video').flatMap(t => t.clips).filter(c => media.get(c.media)?.type === 'video'));

// ---------- Exportar varios proyectos (cola) ----------
async function renderBatch() {
  let list = [];
  try { list = (await S.all('projects')).sort((a, b) => b.updated - a.updated); } catch {}
  $('xBatch').replaceChildren(...list.map(p => {
    const li = document.createElement('li'), l = document.createElement('label');
    l.className = 'check';
    l.append(Object.assign(document.createElement('input'), { type: 'checkbox', value: p.id }), ` ${p.name}`);
    li.append(l);
    return li;
  }));
}
$('xBatchBox').addEventListener('toggle', () => { if ($('xBatchBox').open) renderBatch(); });
$('xBatchGo').onclick = async () => {
  const ids = [...$('xBatch').querySelectorAll('input:checked')].map(i => i.value);
  if (!ids.length) return ($('xMsg').textContent = 'Elegí al menos un proyecto.');
  if ($('xKind').value !== 'video') $('xKind').value = 'video';
  let dir = null;
  if (window.showDirectoryPicker) { try { dir = await showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; } }
  const back = P.id, ext = $('xCodec').value === 'vp9' ? '.webm' : '.mp4', done = [];
  await save();
  job.cancel = false;
  for (const [i, id] of ids.entries()) {
    if (job.cancel) break;
    await openProject(id);
    $('xMsg').textContent = `Proyecto ${i + 1} de ${ids.length}: ${P.name}`;
    let writable = null;
    if (dir) { let n = safeName() + ext, k = 2; while (await dir.getFileHandle(n).then(() => true, () => false)) n = `${safeName()} (${k++})${ext}`; writable = await (await dir.getFileHandle(n, { create: true })).createWritable(); }
    await runExport({ writable });
    done.push(P.name);
  }
  await openProject(back);
  $('xMsg').textContent = `Cola terminada: ${done.length} de ${ids.length} proyectos exportados${dir ? ' en la carpeta elegida' : ''}.`;
};

// ---------- Propiedades ----------
const FMT = { x: v => (+v).toFixed(2) + '×', db: v => '+' + (+v).toFixed(1) + ' dB', pct: v => Math.round(v * 100) + ' %', s: v => (+v).toFixed(1) + ' s', deg: v => Math.round(v) + '°', num: v => (+v).toFixed(2) };
function field(k, label, html, f) {
  return `<label>${label}${f ? ` <output data-o="${k}"></output>` : ''}${html.replace('<input', `<input data-k="${k}"`).replace('<select', `<select data-k="${k}"`).replace('<textarea', `<textarea data-k="${k}"`)}</label>`;
}
const krange = (k, label, ...r) => `<div class="kfrow">${range(k, label, ...r)}<button type="button" data-kf="${k}" aria-pressed="false" aria-label="Fotograma clave de ${label}" title="Fotograma clave: guarda este valor en este momento">◆</button></div>`;
const range = (k, label, min, max, step, f) => field(k, label, `<input type="range" min="${min}" max="${max}" step="${step}" data-f="${f}">`, f);
const num = (k, label, min, step) => field(k, label, `<input type="number" min="${min}" step="${step}">`);
const opts = (k, label, o) => field(k, label, `<select>${Object.entries(o).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`);
const check = (k, label) => `<label class="check"><input type="checkbox" data-k="${k}"> ${label}</label>`;
const color = (k, label) => field(k, label, '<input type="color">');
const acts = (...a) => `<div class="row">${a.map(([act, t]) => `<button type="button" data-act="${act}">${t}</button>`).join('')}</div>`;

function renderProps() {
  const f = sel && find(sel), c = f?.c, t = f?.t, m = c && media.get(c.media);
  let h;
  if (!f) {
    h = `<h2>Proyecto</h2>
      ${opts('aspect', 'Formato', { '9:16': 'Vertical 9:16 (Reels, TikTok, Shorts)', '16:9': 'Horizontal 16:9 (YouTube)', '1:1': 'Cuadrado 1:1', '4:5': 'Retrato 4:5 (feed de Instagram)' })}
      ${color('bg', 'Color de fondo')}
      ${check('safe', 'Mostrar la zona segura (vertical)')}
      <p class="hint">Duración: ${fmt(dur())}. Tocá un clip de la línea de tiempo para editarlo.</p>
      ${P.desc ? `<h3>Para publicar</h3><label>Descripción sugerida por la IA<textarea readonly rows="5">${esc(P.desc)}</textarea></label>${acts(['copyDesc', 'Copiar descripción'])}` : ''}
      ${soundClips().length ? `<h3>Voz</h3>${acts(['vozEvery', '✨ Mejorar todas las voces'])}<p class="hint">Limpia y empareja el audio de todos los clips con el perfil Entrevista. Después podés ajustar cada uno.</p>` : ''}
      <h3>Atajos</h3>
      <p class="hint">Espacio: reproducir · S: dividir · Supr: borrar · Ctrl+D: duplicar · Ctrl+Z / Ctrl+Shift+Z: deshacer / rehacer · ← →: un cuadro (con Shift, 1 s) · Alt+← →: mover el clip · Ctrl+rueda: zoom</p>`;
  } else if (c.sub) {
    h = `<h2>Subtítulo</h2>
      ${field('text', 'Texto', '<textarea rows="3"></textarea>')}
      <p class="hint">El estilo, el tamaño y la altura de todos los subtítulos se cambian en la pestaña Subtítulos.</p>
      <div class="two">${num('start', 'Empieza (s)', 0, 0.1)}${num('out', 'Dura (s)', MIN, 0.1)}</div>`;
  } else if (t.kind === 'text') {
    h = `<h2>Texto</h2>
      ${field('text', 'Texto', '<textarea rows="3"></textarea>')}
      <div class="two">${opts('font', 'Letra', { montserrat: 'Montserrat', anton: 'Anton', jakarta: 'Jakarta', playfair: 'Playfair' })}
      ${opts('weight', 'Grosor', { 400: 'Normal', 600: 'Seminegrita', 700: 'Negrita', 800: 'Extra', 900: 'Black' })}</div>
      ${range('size', 'Tamaño', 0.02, 0.2, 0.002, 'pct')}
      <div class="two">${color('color', 'Color')}${opts('box', 'Fondo', { none: 'Sin fondo', solid: 'Caja', semi: 'Caja transparente' })}</div>
      ${c.box !== 'none' ? color('boxColor', 'Color de la caja') : ''}
      ${check('stroke', 'Contorno negro')}
      ${opts('anim', 'Animación de entrada', ANIMS)}
      <h3>Posición</h3>
      ${range('x', 'Horizontal', -0.5, 0.5, 0.005, 'num')}${range('y', 'Vertical', -0.5, 0.5, 0.005, 'num')}
      <h3>Tiempo</h3>
      <div class="two">${num('start', 'Empieza (s)', 0, 0.1)}${num('out', 'Dura (s)', MIN, 0.1)}</div>`;
  } else {
    const visual = t.kind === 'video', isImg = m?.type === 'image';
    h = `<h2>${isImg ? 'Imagen' : visual ? 'Video' : 'Audio'}</h2><p class="hint">${m ? esc(m.name) : 'Archivo que falta'}</p>`;
    if (visual) h += `<h3>Encuadre</h3>
      ${opts('fit', 'Ajuste', { cover: 'Llenar el cuadro (recorta)', contain: 'Entero (con bordes)' })}
      ${c.fit === 'contain' ? opts('bg', 'Fondo', { color: 'Color del proyecto', blur: 'La misma imagen desenfocada' }) : ''}
      ${krange('scale', 'Zoom', 0.1, 4, 0.01, 'pct')}
      ${krange('x', 'Horizontal', -1, 1, 0.005, 'num')}${krange('y', 'Vertical', -1, 1, 0.005, 'num')}
      ${krange('rot', 'Rotación', -180, 180, 1, 'deg')}${krange('opacity', 'Opacidad', 0, 1, 0.01, 'pct')}
      <p class="hint">◆ guarda el valor en este momento (fotograma clave): con dos o más, se anima entre ellos.${c.kf ? '' : ''}</p>
      ${c.kf ? acts(['kfClear', 'Borrar fotogramas clave']) : ''}
      ${range('kb', 'Zoom lento a lo largo del clip', 0, 0.3, 0.01, 'pct')}
      ${m?.type === 'video' && P.aspect !== '16:9' ? acts(['rf', '🎯 Seguir a quien habla']) : ''}
      <h3>Color</h3>
      <label>Perfil<select data-look><option value="">Elegí un perfil…</option><option value="podcast">Podcast</option><option value="interiores">Interiores</option><option value="calida">Luz cálida</option><option value="fria">Luz fría</option><option value="cine">Cinematográfico</option><option value="neutro">Sin corrección</option></select></label>
      ${opts('lut', 'LUT', { '': 'Ninguno', ...Object.fromEntries(Object.entries(Assets.LUTS).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(P.luts || {}).map(([k, v]) => [k, v.name])), __import: 'Importar un .cube…' })}
      ${c.lut ? range('lutMix', 'Intensidad del LUT', 0, 1, 0.01, 'pct') + acts(['lutDown', 'Bajar este LUT (.cube)']) : ''}
      ${range('exp', 'Exposición', -1, 1, 0.01, 'num')}${range('con', 'Contraste', -1, 1, 0.01, 'num')}
      ${range('hl', 'Luces', -1, 1, 0.01, 'num')}${range('sh', 'Sombras', -1, 1, 0.01, 'num')}
      ${range('wh', 'Blancos', -1, 1, 0.01, 'num')}${range('bl', 'Negros', -1, 1, 0.01, 'num')}
      ${range('temp', 'Temperatura', -1, 1, 0.01, 'num')}${range('tint', 'Tinte', -1, 1, 0.01, 'num')}
      ${range('sat', 'Saturación', -1, 1, 0.01, 'num')}${range('vib', 'Vibrance', -1, 1, 0.01, 'num')}
      ${range('hue', 'Matiz', -30, 30, 1, 'deg')}${range('vig', 'Viñeta', 0, 1, 0.01, 'pct')}
      ${range('grain', 'Grano de película', 0, 1, 0.01, 'pct')}
      ${GL.available() ? '' : '<p class="hint">Este navegador no tiene WebGL2: luces, sombras, blancos, negros, vibrance y LUTs no se aplican.</p>'}
      ${acts(['orig', colorOff ? 'Ver con color' : 'Ver original'])}
      <h3>Transición de entrada</h3>
      ${opts('tr', 'Tipo', TRANS)}
      ${c.tr !== 'none' ? `${range('trD', 'Duración', 0.1, 2, 0.05, 's')}
        ${['deslizar', 'barrido', 'giro'].includes(c.tr) ? opts('trDir', 'Dirección', { izq: 'Hacia la izquierda', der: 'Hacia la derecha', arriba: 'Hacia arriba', abajo: 'Hacia abajo' }) : ''}
        ${['blanco', 'zoom', 'desenfoque', 'giro', 'glitch'].includes(c.tr) ? range('trK', 'Intensidad', 0.2, 2, 0.05, 'pct') : ''}
        ${f && NEEDS_PREV.has(c.tr) && !prevOf(t, c) ? '<p class="hint">No hay un clip pegado antes: entra desde el fondo.</p>' : ''}
        ${acts(['trAll', 'Usar en todos los cortes'])}` : ''}`;
    if (!isImg && m?.hasAudio !== false && (!visual || m?.hasAudio)) {
      h += `<h3>Sonido</h3>
      ${range('vol', 'Volumen', 0, 2, 0.01, 'pct')}
      ${check('mute', 'Silenciar este clip')}
      ${t.kind === 'audio' ? check('duck', 'Bajar cuando hablan (para música)') : ''}
      <div class="two">${range('fadeIn', 'Fundido de entrada', 0, 5, 0.1, 's')}${range('fadeOut', 'Fundido de salida', 0, 5, 0.1, 's')}</div>
      <h3>Voz</h3>`;
      h += c.voz?.p ? `${opts('voz.p', 'Perfil', { '': 'Apagado', podcast: 'Podcast: cálida y presente', entrevista: 'Entrevista: natural y pareja', viral: 'Voz viral: fuerte, para el celular' })}
        ${range('voz.noise', 'Reducción de ruido', 0, 1, 0.01, 'pct')}${range('voz.clarity', 'Claridad', 0, 8, 0.1, 'db')}
        ${range('voz.level', 'Nivelado del volumen', 0, 1, 0.01, 'pct')}${check('voz.hum', 'Sacar zumbido eléctrico (50 Hz)')}
        <div class="row"><button type="button" data-act="ab" aria-pressed="${bypass}">${bypass ? 'Escuchar mejorado' : 'Escuchar original'}</button><button type="button" data-act="vozAll">Usar en todo este archivo</button></div>
        <p class="hint">Baja el ruido entre frases, el zumbido y las resonancias, y deja la voz pareja. No hace milagros con ruido fuerte encima de la voz: ajustalo a oído.</p>`
        : `${acts(['voz', '✨ Mejorar voz'])}<p class="hint">Analiza el audio y aplica el perfil Entrevista. Después lo podés cambiar.</p>`;
    }
    if (!isImg) h += `<h3>Velocidad</h3>${range('speed', 'Velocidad', 0.25, 4, 0.05, 'x')}<p class="hint">La voz mantiene su tono. Lo que sigue en la pista se corre solo.</p>`;
    const others = P.tracks.flatMap(x => x.clips.filter(o => o !== c && x !== t && o.media && media.get(o.media)?.hasAudio));
    if (!isImg && others.length) h += `<h3>Multicámara</h3><label>Sincronizar por el sonido con<select id="syncWith">${others.map(o => `<option value="${o.id}">${esc(media.get(o.media).name)} (${fmt(o.start)})</option>`).join('')}</select></label>${acts(['sync', 'Sincronizar'])}`;
    h += `<h3>Tiempo</h3><div class="two">${num('start', 'Empieza (s)', 0, 0.1)}${isImg ? num('out', 'Dura (s)', MIN, 0.1) : `<label>Dura<input type="text" value="${len(c).toFixed(2)} s" readonly></label>`}</div>`;
  }
  if (f) h += acts(['split', 'Dividir'], ['dup', 'Duplicar'], ['del', 'Borrar']) + acts(['copyA', 'Copiar ajustes'], ['pasteA', 'Pegar ajustes'])
    + (t.kind === 'video' && m?.type === 'video' ? acts(...[['freeze', 'Congelar cuadro'], !c.mute && m.hasAudio ? ['detach', 'Separar audio'] : null].filter(Boolean)) : '');
  $('props').innerHTML = h;
  const o = c || P;
  $('props').querySelectorAll('[data-k]').forEach(el => {
    const v = c && KF_KEYS.includes(el.dataset.k) ? valAt(c, el.dataset.k, T - c.start) : getK(o, el.dataset.k);
    if (el.type === 'checkbox') el.checked = el.dataset.k === 'voz.hum' ? v !== false : !!v;
    else el.value = el.type === 'number' ? +(+v).toFixed(2) : v ?? '';
    showOut(el);
  });
}
// Con fotogramas clave, los controles muestran el valor del momento actual (también mientras se reproduce)
function refreshKf() {
  const c = sel && find(sel)?.c;
  if (!c?.kf) return;
  for (const k of KF_KEYS) {
    const el = $('props').querySelector(`[data-k="${k}"]`), b = $('props').querySelector(`[data-kf="${k}"]`);
    if (!el) continue;
    if (document.activeElement !== el) { el.value = valAt(c, k, T - c.start); showOut(el); }
    b?.setAttribute('aria-pressed', !!c.kf[k]?.some(([x]) => Math.abs(x - (T - c.start)) < 0.02));
  }
}
const esc = x => String(x).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const getK = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
function setK(o, k, v) { const ps = k.split('.'), last = ps.pop(); ps.reduce((x, p) => (x[p] ??= {}), o)[last] = v; }
function showOut(el) { const out = $('props').querySelector(`[data-o="${el.dataset.k}"]`); if (out) out.textContent = FMT[el.dataset.f]?.(el.value) ?? ''; }

let pending = null;
$('props').addEventListener('input', e => {
  const el = e.target, k = el.dataset.k;
  if (!k) return;
  const f = sel && find(sel), o = f ? f.c : P;
  pending ??= snap();
  let v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' || k === 'weight' ? +el.value : el.value;
  if (el.type === 'number') { if (!isFinite(v) || el.value === '') return; v = Math.max(+el.min || 0, v); }
  if (k === 'out' && f) v = o.in + v; // "Dura" se guarda como punto final
  if (k === 'lut' && v === '__import') { el.value = o.lut; return lutFile.click(); }
  if (f && KF_KEYS.includes(k) && o.kf?.[k]?.length) { // con fotogramas clave: cambia (o crea) el del momento actual
    const tt = T - o.start, l = o.kf[k], i = l.findIndex(([x]) => Math.abs(x - tt) < 0.02);
    if (i >= 0) l[i][1] = v; else { l.push([tt, v]); l.sort((a, b) => a[0] - b[0]); }
    showOut(el); dirty = true; refreshKf();
    return;
  }
  if (k === 'speed' && f) { setSpeed(o, f.t, v); showOut(el); dirty = true; renderTimeline(); return; }
  if (k === 'voz.p') { // al cambiar de perfil, los controles vuelven a los valores del perfil
    if (!v) o.voz = null;
    else { const pr = Voz.PROFILES[v]; o.voz = { ...o.voz, p: v, noise: pr.noise, clarity: pr.pres, level: 0.5 }; }
  } else setK(o, k, v);
  if (k === 'start' && f) fitFree(f.t, o);
  if (k === 'aspect') sizeStage();
  showOut(el); dirty = true;
  if (['text', 'start', 'out'].includes(k)) renderTimeline();
});
$('props').addEventListener('change', e => {
  const look = e.target.dataset.look !== undefined && LOOKS[e.target.value];
  if (look) { const c = find(sel)?.c; if (c) edit(() => Object.assign(c, look)); return; }
  if (!pending) return;
  const s = pending; pending = null;
  if (remember(s)) changed();
  else if (['box', 'tr', 'voz.p', 'fit', 'lut'].includes(e.target.dataset.k)) renderProps();
});
$('props').addEventListener('click', e => {
  const kfb = e.target.closest('[data-kf]');
  if (kfb && sel) { // ◆: pone o saca un fotograma clave en el momento actual
    const c = find(sel).c, k = kfb.dataset.kf, tt = T - c.start;
    if (tt < 0 || tt > len(c)) return say('Poné el cursor dentro del clip para agregar un fotograma clave.');
    edit(() => {
      c.kf ??= {};
      const l = c.kf[k] ??= [], i = l.findIndex(([x]) => Math.abs(x - tt) < 0.02);
      if (i >= 0) l.splice(i, 1); else { l.push([tt, valAt(c, k, tt)]); l.sort((a, b) => a[0] - b[0]); }
      if (!l.length) delete c.kf[k];
      if (!Object.keys(c.kf).length) c.kf = null;
    });
    return;
  }
  const a = e.target.closest('[data-act]')?.dataset.act, f = sel && find(sel);
  const more = {
    orig() { colorOff = !colorOff; dirty = true; renderProps(); say(colorOff ? 'Viendo el video original, sin corrección de color.' : 'Viendo el color corregido.'); },
    ab() { bypass = !bypass; renderProps(); say(bypass ? 'Escuchando el audio original.' : 'Escuchando la voz mejorada.'); },
    trAll() {
      const c = f.c;
      edit(() => { for (const t of tracks('video')) for (const x of t.clips) if (prevOf(t, x)) Object.assign(x, { tr: c.tr, trD: c.trD, trDir: c.trDir, trK: c.trK }); });
      say(`Transición «${TRANS[c.tr]}» en todos los cortes.`);
    },
    voz: () => improve([f.c]),
    vozAll() { const c = f.c; edit(() => { for (const t of P.tracks) for (const x of t.clips) if (x.media === c.media && x !== c) x.voz = { ...c.voz }; }); say('Mismos ajustes de voz en todo este archivo.'); },
    vozEvery: () => improve(soundClips().map(x => x.c)),
    kfClear() { edit(() => { for (const k of KF_KEYS) if (f.c.kf?.[k]?.length) f.c[k] = valAt(f.c, k, T - f.c.start); f.c.kf = null; }); },
    rf: () => reframe([f.c]),
    sync: () => syncTo(f.c, $('syncWith').value),
    freeze, copyA: copyAttrs, pasteA: pasteAttrs,
    copyDesc() { navigator.clipboard?.writeText(P.desc).then(() => say('Descripción copiada.'), () => say(P.desc)); },
    lutDown() {
      const c = f.c, l = lutOf(c), name = Assets.LUTS[c.lut]?.label || P.luts?.[c.lut]?.name || 'LUT';
      if (l) download(new Blob([Assets.toCube(name, l.data, l.size)], { type: 'text/plain' }), name.replace(/[\\/:*?"<>|&]+/g, '') + '.cube');
    }
  };
  ({ split, dup: duplicate, del: remove, detach, ...more })[a]?.();
});

// Importar un LUT .cube al proyecto (queda guardado con el proyecto)
const lutFile = Object.assign(document.createElement('input'), { type: 'file', accept: '.cube', hidden: true });
document.body.append(lutFile);
lutFile.onchange = async () => {
  const fl = lutFile.files[0]; lutFile.value = '';
  const c = sel && find(sel)?.c;
  if (!fl || !c) return;
  try {
    const l = Assets.parseCube(await fl.text()), id = 'u' + S.uid();
    P.luts = { ...P.luts, [id]: { name: fl.name.replace(/\.cube$/i, ''), ...l } };
    edit(() => { c.lut = id; c.lutMix = 1; });
    say(`LUT «${P.luts[id].name}» importado.`);
  } catch (e) { say(e.message || 'No se pudo leer ese .cube.'); }
};

// "Mejorar voz": mide cada archivo una vez (nivel de la voz y ruido de fondo) y aplica el perfil Entrevista
const levels = new Map();
let improving = false;
async function levelOf(m) {
  if (levels.has(m.id)) return levels.get(m.id);
  const M = await mb(), inp = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS }), at = await inp.getPrimaryAudioTrack();
  if (!at) return null;
  const used = P.tracks.flatMap(t => t.clips).filter(c => c.media === m.id);
  const r = await Voz.analyze(M, at, Math.min(...used.map(c => c.in)), Math.max(...used.map(c => c.out)), p => say(`Analizando la voz de «${m.name}»… ${Math.round(p * 100)} %`));
  levels.set(m.id, r);
  return r;
}
async function improve(list) {
  if (improving) return say('Ya se está analizando la voz, esperá un momento.');
  improving = true;
  try {
    const res = new Map();
    for (const c of list) if (!res.has(c.media) && media.has(c.media)) res.set(c.media, await levelOf(media.get(c.media)));
    const pr = Voz.PROFILES.entrevista;
    edit(() => { for (const c of list) { const r = res.get(c.media); c.voz = { p: 'entrevista', noise: pr.noise, clarity: pr.pres, level: 0.5, hum: true, gain: r?.gain ?? 0, floor: r?.floor ?? -60 }; } });
    const r = [...res.values()][0];
    say(`Voz mejorada${r ? ` (${r.gain >= 0 ? 'se subió' : 'se bajó'} ${Math.abs(r.gain).toFixed(1)} dB para emparejarla)` : ''}. Tocá play para escucharla y compará con «Escuchar original».`);
  } catch (e) { say('No se pudo analizar el audio: ' + (e.message || e)); }
  finally { improving = false; }
}

// ---------- Exportación ----------
// Recorre los cuadros de un clip en orden: at(t) devuelve el cuadro que se ve en el segundo t del archivo
class Frames {
  constructor(sink, a, b) { this.it = sink.samples(a, b); this.cur = null; this.next = null; this.done = false; }
  async pull() { const r = await this.it.next(); if (r.done) this.done = true; else this.next = r.value; }
  async at(t) {
    if (!this.next && !this.done) await this.pull();
    while (this.next && this.next.timestamp <= t + 1e-4) { this.cur?.close(); this.cur = this.next; this.next = null; if (!this.done) await this.pull(); }
    return this.cur ?? this.next;
  }
  close() { this.cur?.close(); this.next?.close(); this.it.return?.(); }
}
// Lee el audio de un clip de a pedazos de 30 s, lo pasa por "Mejorar voz" (con 1 s de colchón antes, así los filtros
// arrancan asentados y no se notan los empalmes) y lo suma a la mezcla con su volumen y fundidos
const CH = 30, PRE = 1;
class Sound {
  constructor(sink, c) { this.sink = sink; this.c = c; this.k = -1; }
  async chunk(k) {
    const c = this.c, a = c.in + k * CH, b = Math.min(c.out, a + CH), a0 = Math.max(0, a - PRE);
    const off = new OfflineAudioContext(2, Math.max(1, Math.round((b - a0) * RATE)), RATE);
    let input = off.destination;
    if (c.voz?.p) { const ch = Voz.buildChain(off, c.voz, await Voz.loadGate(off)); ch.output.connect(off.destination); input = ch.input; }
    for await (const w of this.sink.buffers(a0, b)) {
      const src = new AudioBufferSourceNode(off, { buffer: w.buffer }), when = w.timestamp - a0;
      src.connect(input);
      if (when >= 0) src.start(when); else src.start(0, -when);
    }
    const buf = await off.startRendering();
    const [l, r] = Smart.stretch([buf.getChannelData(0), buf.getChannelData(1)], sp(c), RATE); // más rápido o lento, sin cambiar el tono
    return { t0: a0, l, r };
  }
  async mix(L, R, s0, n) {
    const c = this.c;
    for (let i = 0; i < n; i++) {
      const tt = (s0 + i) / RATE;
      if (tt < c.start || tt >= end(c)) continue;
      const src = srcAt(c, tt), k = Math.floor((src - c.in) / CH);
      if (k !== this.k) { this.cur = await this.chunk(k); this.k = k; }
      const j = Math.round((src - this.cur.t0) / sp(c) * RATE);
      if (j < 0 || j >= this.cur.l.length) continue;
      const g = c.vol * fadeGain(c, tt - c.start);
      L[i] += this.cur.l[j] * g; R[i] += this.cur.r[j] * g;
    }
  }
  close() { this.cur = null; }
}

const job = { cancel: false };
const inputs = new Map();
async function trackOf(M, m, kind) {
  let inp = inputs.get(m.id);
  if (!inp) { inp = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS }); inputs.set(m.id, inp); }
  return kind === 'video' ? inp.getPrimaryVideoTrack() : inp.getPrimaryAudioTrack();
}
// Todo lo que suena: clips de audio y el sonido de los videos (salvo silenciados)
function soundClips() {
  const out = [];
  for (const t of P.tracks) {
    if (t.kind === 'text' || t.muted) continue;
    for (const c of t.clips) { const m = media.get(c.media); if (m && !c.mute && c.vol > 0 && (m.type === 'audio' || (m.type === 'video' && m.hasAudio))) out.push({ c, m }); }
  }
  return out;
}
// Mezcla en estéreo a 48 kHz, de a un segundo, y entrega cada pedazo a push(L, R).
// La música marcada con "Bajar cuando hablan" se baja sola mientras suenan las voces.
function mixer(M, push, { voiceOnly = false } = {}) {
  const items = soundClips().filter(x => !(voiceOnly && x.c.duck)), open = new Map();
  let done = 0, lvl = 0, dg = 1;
  const atk = 1 - Math.exp(-1 / (0.02 * RATE)), rel = 1 - Math.exp(-1 / (0.3 * RATE)), dsm = 1 - Math.exp(-1 / (0.15 * RATE));
  const add = async (list, L, R, s0, n, a, b) => {
    for (const { c, m } of list) {
      if (end(c) <= a || c.start >= b) { if (end(c) <= a && open.has(c.id)) { open.get(c.id).close(); open.delete(c.id); } continue; }
      let snd = open.get(c.id);
      if (!snd) { const at = await trackOf(M, m, 'audio'); if (!at) continue; snd = new Sound(new M.AudioBufferSink(at), c); open.set(c.id, snd); }
      await snd.mix(L, R, s0, n);
    }
  };
  const voices = items.filter(x => !x.c.duck), ducked = items.filter(x => x.c.duck);
  const api = {
    any: items.length > 0, peaks: 0,
    async until(t) {
      while (done < Math.round(t * RATE)) {
        if (job.cancel) return;
        const s0 = done, n = Math.min(RATE, Math.round(t * RATE) - s0), a = s0 / RATE, b = (s0 + n) / RATE;
        const L = new Float32Array(n), R = new Float32Array(n);
        await add(voices, L, R, s0, n, a, b);
        if (ducked.length) {
          const DL = new Float32Array(n), DR = new Float32Array(n);
          await add(ducked, DL, DR, s0, n, a, b);
          for (let i = 0; i < n; i++) {
            const x = Math.abs(L[i]) + Math.abs(R[i]);
            lvl += (x - lvl) * (x > lvl ? atk : rel);
            dg += ((lvl > 0.02 ? 0.28 : 1) - dg) * dsm; // con voz, la música baja a menos de un tercio
            L[i] += DL[i] * dg; R[i] += DR[i] * dg;
          }
        }
        for (const d of [L, R]) for (let i = 0; i < n; i++) {
          const y = d[i], v = Math.abs(y);
          if (v > 0.9) { if (v > 1) api.peaks++; d[i] = Math.sign(y) * (0.9 + 0.09 * Math.tanh((v - 0.9) / 0.09)); } // limitador suave
        }
        await push(L, R);
        done = s0 + n;
      }
    },
    close() { for (const s of open.values()) s.close(); }
  };
  return api;
}

function outSize(res) {
  const [a, b] = ASPECTS[P.aspect], even = x => Math.round(x / 2) * 2;
  return a <= b ? [res, even(res * b / a)] : [even(res * a / b), res];
}
const bitrateFor = (W, H, fps, q, codec) => Math.min(60e6, W * H * fps * 0.09 * q * (codec === 'hevc' ? 0.65 : 1));
let codecs = [];
async function prepareExport() {
  $('xMsg').textContent = ''; $('xProg').hidden = true; $('xGo').disabled = true;
  const M = await mb(), [W, H] = outSize(+$('xRes').value), list = [];
  for (const [v, t] of [['avc', 'H.264 en MP4 (el más compatible)'], ['hevc', 'H.265 en MP4 (más liviano)'], ['vp9', 'VP9 en WebM']]) {
    if (await M.canEncodeVideo(v, { width: W, height: H }).catch(() => false)) list.push([v, t]);
  }
  codecs = list.map(x => x[0]);
  const prev = $('xCodec').value;
  $('xCodec').innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  if (codecs.includes(prev)) $('xCodec').value = prev;
  expInfo();
}
function expInfo() {
  const D = dur(), video = $('xKind').value === 'video';
  $('xVideo').hidden = !video;
  if (!D) { $('xInfo').textContent = 'La línea de tiempo está vacía.'; $('xGo').disabled = true; return; }
  if (video && !codecs.length) { $('xInfo').textContent = 'Este navegador no puede codificar video. Usá Chrome o Edge actualizados en una compu.'; $('xGo').disabled = true; return; }
  $('xGo').disabled = false;
  const kind = $('xKind').value;
  if (kind === 'srt' || kind === 'vtt') { $('xInfo').textContent = `${subItems().length} subtítulos.`; return; }
  if (!video) { $('xInfo').textContent = `WAV estéreo 48 kHz · ${fmt(D)} · unos ${Math.ceil(D * RATE * 4 / 1e6)} MB`; return; }
  const [W, H] = outSize(+$('xRes').value), fps = +$('xFps').value;
  const br = bitrateFor(W, H, fps, +$('xQ').value, $('xCodec').value), mbs = Math.ceil((br + 192e3) * D / 8 / 1e6);
  $('xInfo').textContent = `${W} × ${H} · ${fps} cuadros/s · ${fmt(D)} · unos ${mbs} MB`;
}
['xKind', 'xRes', 'xFps', 'xQ', 'xCodec'].forEach(id => $(id).addEventListener('change', () => id === 'xRes' ? prepareExport() : expInfo()));

// Dónde se guarda: si el navegador deja, se escribe directo en el disco (sirve para videos largos); si no, se descarga al final
async function pickTarget(name, ext, mime) {
  if (!window.showSaveFilePicker) return null;
  const h = await showSaveFilePicker({ suggestedName: name + ext, types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }] });
  return h.createWritable();
}
function download(blob, file) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
const safeName = () => (P.name || 'video').replace(/[\\/:*?"<>|]+/g, '').trim() || 'video';

const peakNote = mix => mix.peaks > RATE * 0.01 ? ' Ojo: el sonido llegaba a saturarse y se suavizó; si se oye áspero, bajá el volumen de algún clip.' : '';
// Subtítulos en archivo aparte (para subirlos a YouTube o a otro editor)
function subItems() {
  return P.tracks.filter(t => t.kind === 'text').flatMap(t => t.clips.filter(c => c.sub)).sort((a, b) => a.start - b.start).map(c => ({ a: c.start, b: end(c), text: c.text.replace(/\s+/g, ' ').trim() }));
}
async function exportSubs(kind) {
  const items = subItems();
  if (!items.length) return ($('xMsg').textContent = 'No hay subtítulos: generalos en la pestaña Subtítulos.');
  download(new Blob([kind === 'srt' ? Sub.toSRT(items) : Sub.toVTT(items)], { type: 'text/plain;charset=utf-8' }), `${safeName()}.${kind}`);
  $('xMsg').textContent = `Listo: ${items.length} subtítulos en .${kind}.`;
}
async function runExport(preset = null) {
  const kind = $('xKind').value, video = kind === 'video', codec = $('xCodec').value, mp4 = codec !== 'vp9';
  if (kind === 'srt' || kind === 'vtt') return exportSubs(kind);
  const ext = !video ? '.wav' : mp4 ? '.mp4' : '.webm', mime = !video ? 'audio/wav' : mp4 ? 'video/mp4' : 'video/webm';
  let writable = preset?.writable || null;
  if (!preset) try { writable = await pickTarget(safeName(), ext, mime); } catch (e) { if (e.name === 'AbortError') return; writable = null; }
  pause();
  job.cancel = false;
  $('xGo').disabled = $('xClose').disabled = true; $('xStop').hidden = false; $('xProg').hidden = false; $('xProg').value = 0;
  const msg = t => { $('xMsg').textContent = t; }, wasOff = colorOff;
  colorOff = false; // el video sale siempre con el color corregido
  try {
    await fontsReady;
    const M = await mb(), D = dur();
    if (!video) {
      const parts = [];
      const mix = mixer(M, async (L, R) => {
        const pcm = new Int16Array(L.length * 2);
        for (let i = 0; i < L.length; i++) { pcm[2 * i] = clamp(L[i], -1, 1) * 32767; pcm[2 * i + 1] = clamp(R[i], -1, 1) * 32767; }
        parts.push(pcm); $('xProg').value = parts.length / Math.ceil(D);
        msg(`Mezclando el audio… ${Math.round(parts.length / Math.ceil(D) * 100)} %`);
      });
      await mix.until(D); mix.close();
      if (job.cancel) { await writable?.abort(); return msg('Exportación cancelada.'); }
      const bytes = parts.reduce((s, p) => s + p.byteLength, 0), hd = new DataView(new ArrayBuffer(44));
      [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']].forEach(([o, s]) => [...s].forEach((ch, i) => hd.setUint8(o + i, ch.charCodeAt(0))));
      hd.setUint32(4, 36 + bytes, true); hd.setUint32(16, 16, true); hd.setUint16(20, 1, true); hd.setUint16(22, 2, true);
      hd.setUint32(24, RATE, true); hd.setUint32(28, RATE * 4, true); hd.setUint16(32, 4, true); hd.setUint16(34, 16, true); hd.setUint32(40, bytes, true);
      const blob = new Blob([hd, ...parts], { type: 'audio/wav' });
      if (writable) { await writable.write(blob); await writable.close(); } else download(blob, safeName() + '.wav');
      return msg('Listo: audio exportado.' + peakNote(mix));
    }

    const [W, H] = outSize(+$('xRes').value), fps = +$('xFps').value;
    const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
    const target = writable ? new M.StreamTarget(writable, { chunked: true }) : new M.BufferTarget();
    const output = new M.Output({ format: mp4 ? new M.Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }) : new M.WebMOutputFormat(), target });
    const vsrc = new M.CanvasSource(cv, { codec, bitrate: bitrateFor(W, H, fps, +$('xQ').value, codec), keyFrameInterval: 2 });
    output.addVideoTrack(vsrc, { frameRate: fps });
    let asrc = null;
    const mix = mixer(M, async (L, R) => {
      const ab = new AudioBuffer({ length: L.length, numberOfChannels: 2, sampleRate: RATE });
      ab.copyToChannel(L, 0); ab.copyToChannel(R, 1);
      await asrc.add(ab);
    });
    if (mix.any) {
      const ac = await M.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], { sampleRate: RATE, numberOfChannels: 2 });
      if (ac) { asrc = new M.AudioBufferSource({ codec: ac, bitrate: 192e3 }); output.addAudioTrack(asrc); }
      else msg('Aviso: este navegador no puede codificar el audio; el video sale sin sonido.');
    }
    await output.start();

    const visual = P.tracks.filter(t => t.kind === 'video' && !t.hidden).flatMap(t => t.clips.filter(c => media.has(c.media)).map(c => ({ c, t, shown: end(c) + tail(t, c) })));
    const cursors = new Map(), N = Math.max(1, Math.round(D * fps)), t0x = performance.now();
    for (let f = 0; f < N && !job.cancel; f++) {
      const t = f / fps, frames = new Map();
      for (const { c, shown } of visual) {
        if (t >= shown) { cursors.get(c.id)?.close(); cursors.delete(c.id); continue; }
        if (t < c.start) continue;
        const m = media.get(c.media);
        if (m.type === 'image') {
          const b = m.bmp || await (m.loading ??= createImageBitmap(m.blob).then(x => (m.bmp = x)));
          frames.set(c.id, { w: b.width, h: b.height, paint: (gg, ...r) => gg.drawImage(b, ...r) });
          continue;
        }
        let cur = cursors.get(c.id);
        if (!cur) { const vt = await trackOf(M, m, 'video'); if (!vt) continue; cur = new Frames(new M.VideoSampleSink(vt), c.in, Math.min(m.duration, srcAt(c, shown))); cursors.set(c.id, cur); }
        const s = await cur.at(srcAt(c, t));
        if (s) frames.set(c.id, { w: s.displayWidth, h: s.displayHeight, paint: (gg, x, y, w, h) => s.draw(gg, x, y, w, h) });
      }
      compose(g, t, c => frames.get(c.id));
      await vsrc.add(t, 1 / fps);
      if (asrc && (f + 1) % fps === 0) await mix.until((f + 1) / fps);
      if (f % 10 === 0) {
        const p = f / N, el = (performance.now() - t0x) / 1000, left = p > 0.02 ? el / p - el : 0;
        $('xProg').value = p;
        msg(`Exportando… ${Math.round(p * 100)} %${left ? ` · faltan unos ${fmt(left).replace(/\.\d$/, '')}` : ''}`);
      }
    }
    if (asrc && !job.cancel) await mix.until(D);
    for (const c of cursors.values()) c.close();
    mix.close();
    if (job.cancel) { await output.cancel(); return msg('Exportación cancelada.' + (writable ? ' El archivo quedó incompleto: borralo.' : '')); }
    msg('Terminando el archivo…');
    await output.finalize();
    if (!writable) download(new Blob([target.buffer], { type: mime }), safeName() + ext);
    $('xProg').value = 1;
    msg(`Listo: ${W} × ${H}, ${fmt(D)}${asrc ? '' : ', sin sonido'}. ${writable ? 'Se guardó donde elegiste.' : 'Se descargó.'}${peakNote(mix)}`);
    say('Video exportado.');
  } catch (e) {
    console.error(e);
    msg('No se pudo exportar: ' + (e.message || e) + '. Probá con 1080p o con otro códec.');
  } finally {
    inputs.clear(); colorOff = wasOff;
    $('xGo').disabled = $('xClose').disabled = false; $('xStop').hidden = true;
  }
}

// ---------- Proyectos ----------
async function renderProjects() {
  let list = [];
  try { list = (await S.all('projects')).sort((a, b) => b.updated - a.updated); } catch (e) { say(e.message); }
  $('plist').replaceChildren(...list.map(p => {
    const li = document.createElement('li'), info = document.createElement('div');
    info.append(Object.assign(document.createElement('b'), { textContent: p.name + (p.id === P.id ? ' (abierto)' : '') }),
      Object.assign(document.createElement('small'), { textContent: new Date(p.updated).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) }));
    const open = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Abrir', onclick: async () => { $('projs').close(); await save(); openProject(p.id); } });
    const del = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Borrar', onclick: () => deleteProject(p, list) });
    open.setAttribute('aria-label', `Abrir ${p.name}`); del.setAttribute('aria-label', `Borrar ${p.name}`);
    li.append(info, open, del);
    return li;
  }));
}
async function deleteProject(p, list) {
  if (!confirm(`¿Borrar «${p.name}»? Se borran también sus archivos guardados en este navegador.`)) return;
  const keep = new Set(list.filter(x => x.id !== p.id).flatMap(x => x.media));
  try {
    for (const mid of p.media) if (!keep.has(mid)) await S.del('media', mid);
    await S.del('projects', p.id);
  } catch (e) { return say('No se pudo borrar: ' + e.message); }
  if (p.id === P.id) { clearTimeout(saveT); saveT = null; P = null; await openProject(list.find(x => x.id !== p.id)?.id); }
  renderProjects();
}

// ---------- Botones y atajos ----------
const pickFiles = () => $('file').click();
$('importBtn').onclick = $('importBtn2').onclick = pickFiles;
$('file').onchange = () => { const f = [...$('file').files]; $('file').value = ''; importFiles(f); };
$('undo').onclick = undo; $('redo').onclick = redo;
$('play').onclick = toggle; $('split').onclick = split; $('dup').onclick = duplicate; $('del').onclick = remove; $('detach').onclick = detach;
$('addV').onclick = () => edit(() => newTrack('video'));
$('addA').onclick = () => edit(() => newTrack('audio'));
$('addT').onclick = () => edit(() => newTrack('text'));
$('zoom').oninput = () => setPps(zoomToPps(+$('zoom').value));
$('fit').onclick = fitZoom;
$('pname').onchange = () => edit(() => { P.name = $('pname').value.trim() || 'Proyecto sin título'; });
$('openProjs').onclick = () => { renderProjects(); $('projs').showModal(); };
$('newProj').onclick = async () => { $('projs').close(); await save(); P = null; openProject(null); };
$('openExp').onclick = () => { $('exp').showModal(); prepareExport(); };
$('xGo').onclick = runExport;
$('xStop').onclick = () => { job.cancel = true; };
$('exp').addEventListener('cancel', e => { if (!$('xStop').hidden) e.preventDefault(); });
const TABS = [['tabFiles', 'pFiles'], ['tabTexts', 'pTexts'], ['tabSubs', 'pSubs'], ['tabAI', 'pAI']];
for (const [a] of TABS) $(a).onclick = () => {
  for (const [x, y] of TABS) { const on = x === a; $(x).setAttribute('aria-selected', on); $(x).tabIndex = on ? 0 : -1; $(y).hidden = !on; }
  if (a === 'tabSubs') renderSubs();
  if (a === 'tabAI') renderTranscript();
};

// Archivos soltados desde la compu en cualquier parte de la página
addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dragging'); } });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', e => {
  document.body.classList.remove('dragging');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault(); importFiles([...e.dataTransfer.files]);
});

addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select') || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  const step = e.shiftKey ? 1 : 1 / 30;
  if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.altKey && k === 'c') { e.preventDefault(); copyAttrs(); }
  else if (mod && e.altKey && k === 'v') { e.preventDefault(); pasteAttrs(); }
  else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
  else if (!mod && e.shiftKey && k === 'f') freeze();
  else if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod) return;
  else if (k === 's') split();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(); }
  else if (e.altKey && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); moveSel(k === 'arrowleft' ? -step * 3 : step * 3); }
  else if (k === 'arrowleft') { e.preventDefault(); seek(T - step); }
  else if (k === 'arrowright') { e.preventDefault(); seek(T + step); }
  else if (k === 'home') seek(0);
  else if (k === 'end') seek(dur());
  else if (k === '+' || k === '=') setPps(pps * 1.3);
  else if (k === '-') setPps(pps / 1.3);
  else if (k === 'escape' && sel) { sel = null; renderTimeline(); renderProps(); }
});

// Las letras de los textos se cargan antes de dibujar (el lienzo no las pide solo)
const fontsReady = Promise.all(Object.values(FONTS).flatMap(f => [400, 600, 700, 800, 900].map(w => document.fonts.load(`${w} 40px ${f}`).catch(() => {}))))
  .then(() => { dirty = true; });

// ---------- Inicio: abre el proyecto pedido, o recupera el último ----------
(async () => {
  let id = new URLSearchParams(location.search).get('p');
  try { id ||= localStorage.getItem('clipcreate.editor.ultimo'); } catch {}
  if (!window.indexedDB) say('Este navegador no permite guardar proyectos: se pierden al cerrar la pestaña.');
  await openProject(id);
  if (id && P.id === id && dur()) say(`Se abrió «${P.name}». Se guarda solo mientras trabajás.`);
  else say('Importá un video, un audio o una imagen para empezar.');
  requestAnimationFrame(loop);
})();
