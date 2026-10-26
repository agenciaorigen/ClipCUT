// ClipCreate Editor v5.8 (si un archivo no entra en el navegador se edita igual, y los archivos perdidos se reconectan al importarlos de nuevo); v5.7 (panel de transiciones y volumen de la vista previa; los archivos llevan ?v= para que el navegador no use versiones viejas); v5.6 (Mejorar voz: tarda segundos en videos largos y muestra el avance en el botón); v5.5 (arreglo: a veces la vista previa no tenía sonido); v5.4: exportar en 1440p; v5.3 (interfaz pro: números que se arrastran, menú del clic derecho, J/K/L, atajos, avisos flotantes, íconos); v5.2 (multicámara a mano: barra de cámaras en vivo, teclas 1 a 9); v5.1 (multicámara automática, muletillas, voz en off, volumen con puntos, mezcla automática, capítulos y varios formatos); v5.0: página de Color, herramientas pro, placa final, barra de progreso y planes; v4.0: diseño profesional — editor de video multipista que corre entero en el navegador.
// Vista previa con <video>/<audio> + canvas; exportación real con WebCodecs (mediabunny). Proyectos y archivos en IndexedDB.
// v2.0: Mejorar voz, subtítulos automáticos con estilos, transiciones, corrección de color y animación de textos.
import * as S from './store.js';
import * as Voz from './audio.js?v=5.8';
import * as Sub from './subs.js';
import * as Assets from './assets.js?v=5.8';
import * as GL from './gl.js?v=5.8';
import * as Smart from './smart.js?v=5.8';

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
    cw: null, curves: null, crop: null, box: null, ramp: null,
    tr: 'none', trD: 0.5, trDir: 'izq', trK: 1 },
  audio: { vol: 1, mute: false, fadeIn: 0, fadeOut: 0, voz: null, speed: 1, duck: false },
  text: { in: 0, text: 'Texto', font: 'montserrat', weight: 800, size: 0.06, color: '#ffffff', stroke: true, box: 'none', boxColor: '#000000', x: 0, y: 0.25, anim: 'ninguna' }
};
const HW = 150;   // ancho de los nombres de pista en la línea de tiempo
const MIN = 0.1;   // largo mínimo de un clip, en segundos
const RATE = 48000;

const say = t => {
  $('status').textContent = t;
  // lo importante también sale en un aviso flotante que se va solo
  if (/^(Listo|No se pudo|Deshecho|Rehecho|Video exportado|Exportación cancelada|Voz en off grabada|Multicámara|Mezcla lista|Capítulos copiados|Still |Voz mejorada)/.test(t) || /^(Llegaste|Tu sesión|No hay lugar)/.test(t)) toast(t);
};
function toast(t) {
  const box = $('toasts'), el = Object.assign(document.createElement('div'), { className: 'toast' + (/^(No se pudo|Llegaste|Tu sesión|No hay lugar)/.test(t) ? ' bad' : ''), textContent: t });
  el.onclick = () => el.remove();
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, /^No se pudo/.test(t) ? 7000 : 3800);
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const tc = s => { // código de tiempo HH:MM:SS:CC (cuadros a 30 por segundo)
  const f = Math.floor(Math.max(0, s) * 30 + 1e-6), p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(f / 108000))}:${p(Math.floor(f / 1800) % 60)}:${p(Math.floor(f / 30) % 60)}:${p(f % 30)}`;
};
const fmt = s => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));
// Velocidad: fija, o una rampa que va de ramp.a a ramp.b a lo largo del clip (sp = la velocidad promedio)
const sp = c => c.ramp ? (c.ramp.a + c.ramp.b) / 2 : c.speed || 1;
const len = c => (c.out - c.in) / sp(c);
const spAt = (c, tt) => c.ramp ? c.ramp.a + (c.ramp.b - c.ramp.a) * Math.min(1, Math.max(0, tt / len(c))) : sp(c);
const srcAt = (c, t) => { // segundo del archivo que se ve en el segundo t del proyecto
  const tt = t - c.start;
  return c.ramp ? c.in + c.ramp.a * tt + (c.ramp.b - c.ramp.a) * tt * tt / (2 * len(c)) : c.in + tt * sp(c);
};
const end = c => c.start + len(c);

let P = null;               // proyecto abierto
const media = new Map();    // id → registro del archivo + url
let T = 0, playing = false, t0 = 0, p0 = 0, sel = null, pps = 40, dirty = true;
const multi = new Set();    // selección de varios clips (Shift/Ctrl+clic o arrastrando un recuadro)
const picked = () => (multi.size ? [...multi] : sel ? [sel] : []).map(find).filter(Boolean);
const isSel = id => sel === id || multi.has(id);
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
const snap = () => JSON.stringify({ name: P.name, aspect: P.aspect, bg: P.bg, safe: P.safe, sub: P.sub, tracks: P.tracks, markers: P.markers || [], progress: P.progress || null, endCard: P.endCard || null, mc: P.mc || null });
function remember(before) {
  if (snap() === before) return false;
  past.push(before); if (past.length > 200) past.shift();
  future.length = 0;
  return true;
}
function edit(fn) { const s = snap(); fn(); if (remember(s)) changed(); }
function restore(s) { Object.assign(P, JSON.parse(s)); if (sel && !find(sel)) sel = null; for (const id of multi) if (!find(id)) multi.delete(id); changed(); sizeStage(); }
const undo = () => { if (!past.length) return; future.push(snap()); restore(past.pop()); say('Deshecho.'); };
const redo = () => { if (!future.length) return; past.push(snap()); restore(future.pop()); say('Rehecho.'); };
function changed() {
  silMarks = []; fillMarks = []; $('silCut').disabled = $('fillCut').disabled = true;
  dirty = true; saveSoon(); renderTimeline(); renderProps(); renderBin(); renderSubs(); renderTranscript();
  $('undo').disabled = !past.length; $('redo').disabled = !future.length;
  $('tSafe').setAttribute('aria-pressed', !!P.safe); $('tSafe').disabled = P.aspect !== '9:16';
  $('pname').value = P.name;
  if (page === 'color') { if (!vClips().length) setPage('edit'); else renderColor(); }
  if (mcOpen && (!P.mc || $('mcTiles').children.length !== camTracks().length)) P.mc ? renderMc() : mcShow(false);
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
  past.length = future.length = 0; sel = null; multi.clear(); T = 0; P.markers ??= []; P.io ??= {}; P.mc ??= null;
  if (mcOpen) mcShow(false);
  try { localStorage.setItem('clipcreate.editor.ultimo', P.id); } catch {}
  history.replaceState(null, '', '?p=' + P.id);
  $('backClips').hidden = P.from !== 'clipcreate';
  if (!p) await save();
  sizeStage(); fitZoom(); changed(); $('saved').textContent = 'Guardado';
  for (const [id, m] of media) (P.files ??= {})[id] ??= { name: m.name, size: m.blob?.size };
  const lost = [...new Set(P.tracks.flatMap(t => t.clips).filter(c => c.media && !media.has(c.media)).map(c => c.media))];
  if (lost.length) { const names = lost.map(id => P.files?.[id]?.name).filter(Boolean); say(`Faltan ${lost.length} archivo(s) de este proyecto${names.length ? ': «' + names.join('», «') + '»' : ''}. Importalos de nuevo${names.length ? ' (los mismos archivos) y se reconectan solos' : ''}.`); }
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
  // si es un archivo del proyecto que se perdió del navegador, vuelve con el mismo id y los clips se reconectan solos
  const lost = Object.entries(P.files || {}).find(([id, x]) => !media.has(id) && x.name === f.name && x.size === f.size)?.[0];
  const rec = { id: lost || S.uid(), name: f.name, type, blob: f, ...info };
  let kept = true;
  navigator.storage?.persist?.().catch(() => {}); // que el navegador no borre los archivos si falta lugar
  try { await S.put('media', rec); } catch (e) { kept = false; console.warn(e); }
  if (!P.media.includes(rec.id)) P.media.push(rec.id);
  P.files = { ...P.files, [rec.id]: { name: f.name, size: f.size } };
  media.set(rec.id, { ...rec, url: URL.createObjectURL(f), unsaved: !kept });
  if (!kept) toast(`«${f.name}» se abrió, pero no entró en el navegador (falta lugar en el disco o es muy pesado). Se edita y se exporta igual; si cerrás la pestaña, vas a tener que volver a importarlo.`);
  if (lost) toast(`«${f.name}» se volvió a conectar con sus clips.`);
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
  else { save(); renderBin(); renderTimeline(); dirty = true; }
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
      if (c.ramp) { const s1 = spAt(c, T - c.start); b.ramp = { a: s1, b: c.ramp.b }; c.ramp = { a: c.ramp.a, b: s1 }; }
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
// Borrar (con ripple: cierra el hueco que deja en su pista)
function remove(ripple = false) {
  const l = picked();
  if (!l.length) return say('Elegí un clip para borrarlo.');
  edit(() => {
    for (const { c, t } of l) {
      t.clips = t.clips.filter(x => x !== c);
      if (ripple) { const e = end(c), d = len(c); for (const o of t.clips) if (o.start >= e - 1e-6) o.start -= d; }
    }
    sel = null; multi.clear();
  });
  if (ripple) say(l.length > 1 ? `${l.length} clips borrados y huecos cerrados.` : 'Clip borrado y hueco cerrado.');
}
const ripple = () => remove(true);
// Partir todas las pistas en el cursor (como la cuchilla con Shift)
function splitAll() { sel = null; multi.clear(); split(); }
// Marcas de entrada y salida (I / O): Extraer saca el tramo y cierra el hueco; Levantar lo saca y deja el hueco
const ioOk = () => P.io?.i != null && P.io?.o != null && P.io.o - P.io.i > 0.02;
function mark(k) {
  P.io = { ...P.io, [k]: T };
  if (P.io.i != null && P.io.o != null && P.io.o < P.io.i) P.io = k === 'i' ? { i: T } : { o: T };
  saveSoon(); renderTimeline();
  say(k === 'i' ? `Entrada marcada en ${tc(T)}.` : `Salida marcada en ${tc(T)}.`);
}
function clearIO() { P.io = {}; saveSoon(); renderTimeline(); say('Marcas de entrada y salida borradas.'); }
function extract() {
  if (!ioOk()) return say('Marcá la entrada (I) y la salida (O) primero.');
  const { i, o } = P.io;
  edit(() => { cutRange(i, o); sel = null; multi.clear(); });
  P.io = {}; seek(i); renderTimeline();
  say(`Tramo extraído (${fmt(o - i)}): lo que seguía se corrió.`);
}
function lift() {
  if (!ioOk()) return say('Marcá la entrada (I) y la salida (O) primero.');
  const { i, o } = P.io;
  edit(() => { cutRange(i, o, false); sel = null; multi.clear(); });
  P.io = {}; renderTimeline();
  say(`Tramo levantado (${fmt(o - i)}): quedó el hueco.`);
}
// Marcadores (M): notas en la regla para volver a un momento
const MCOL = ['#ff5a1f', '#3fa7ff', '#3ddc84', '#ffd400', '#c86bff'];
function toggleMarker() {
  edit(() => {
    P.markers ??= [];
    const i = P.markers.findIndex(m => Math.abs(m.t - T) < 0.05);
    if (i >= 0) P.markers.splice(i, 1);
    else { P.markers.push({ t: T, label: '', color: MCOL[P.markers.length % MCOL.length] }); P.markers.sort((a, b) => a.t - b.t); }
  });
}
function jump(list, dir) {
  const pts = [...new Set(list.map(x => +x.toFixed(3)))].sort((a, b) => a - b);
  const to = dir > 0 ? pts.find(x => x > T + 0.01) : pts.reverse().find(x => x < T - 0.01);
  if (to != null) seek(to);
}
const editPts = () => P.tracks.flatMap(t => t.clips.flatMap(c => [c.start, end(c)]));
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
  edit(() => detachClip(f.c));
  say('Audio separado: ahora está en su propia pista.');
}
function detachClip(c, name = null) { // el sonido del clip pasa a una pista de audio (con su velocidad, voz y volumen)
  const a = { ...DEF.audio, id: S.uid(), media: c.media, start: c.start, in: c.in, out: c.out, vol: c.vol, fadeIn: c.fadeIn, fadeOut: c.fadeOut,
    speed: c.speed, ramp: structuredClone(c.ramp), voz: structuredClone(c.voz), kf: c.kf?.vol ? { vol: structuredClone(c.kf.vol) } : null };
  let t = name ? namedTrack('audio', name) : tracks('audio').find(t => t.clips.every(o => end(a) <= o.start || a.start >= end(o)));
  if (name && t.clips.some(o => end(a) > o.start && a.start < end(o))) t = null;
  t ??= newTrack('audio');
  t.clips.push(a); c.mute = true;
  return a;
}
// ---------- Cortar tramos (edición por texto, silencios) y copiar tramos (Clips inteligentes) ----------
const timed = c => !!c.media && media.get(c.media)?.type !== 'image';
function trimTail(c, t) { // deja el clip hasta el segundo t del proyecto
  if (c.sub) { const tm = timesOf(c), w = wordsOf(c), k = Math.max(1, tm.filter(([x]) => x < t - c.start).length); c.text = w.slice(0, k).join(' '); c.words = tm.slice(0, k); }
  const s1 = c.ramp && spAt(c, t - c.start);
  c.out = timed(c) ? srcAt(c, t) : c.in + (t - c.start); c.fadeOut = 0;
  if (c.ramp) c.ramp = { a: c.ramp.a, b: s1 };
  return c;
}
function trimHead(c, t) { // deja el clip desde el segundo t del proyecto
  const dt = t - c.start;
  if (c.sub) { const tm = timesOf(c), w = wordsOf(c); let k = tm.findIndex(([x]) => x >= dt); if (k < 0) k = w.length - 1; c.text = w.slice(k).join(' '); c.words = tm.slice(k).map(([x, y]) => [Math.max(0, x - dt), y - dt]); }
  const s0 = c.ramp && spAt(c, dt);
  if (timed(c)) c.in = srcAt(c, t); else c.out -= dt;
  if (c.ramp) c.ramp = { a: s0, b: c.ramp.b };
  c.kf = shiftKf(c.kf, dt); c.start = t; c.fadeIn = 0;
  return c;
}
// Saca el tramo [a, b] de todas las pistas y corre lo que sigue para cerrar el hueco
function cutRange(a, b, close = true, only = null) {
  const d = close ? b - a : 0;
  if (b - a <= 0) return;
  if (d && !only && P.markers?.length) P.markers = P.markers.filter(m => m.t <= a || m.t >= b).map(m => m.t >= b ? { ...m, t: m.t - d } : m);
  for (const t of only || P.tracks) {
    const out = [];
    for (const c of t.clips) {
      const e = end(c);
      if (e <= a + 1e-6) out.push(c);
      else if (c.start >= b - 1e-6) { c.start -= d; out.push(c); }
      else if (c.start >= a - 1e-6 && e <= b + 1e-6) continue;
      else if (c.start < a && e > b) { const tl = trimHead({ ...c, id: S.uid(), tr: 'none' }, b); tl.start = b - d; out.push(trimTail(c, a), tl); }
      else if (c.start < a) out.push(trimTail(c, a));
      else { trimHead(c, b); c.start = b - d; out.push(c); }
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
  video: ['fit', 'bg', 'kb', 'x', 'y', 'scale', 'rot', 'opacity', 'crop', 'box', 'exp', 'con', 'sat', 'temp', 'tint', 'hue', 'vib', 'hl', 'sh', 'wh', 'bl', 'vig', 'grain', 'lut', 'lutMix', 'cw', 'curves', 'tr', 'trD', 'trDir', 'trK'],
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
  const l = picked();
  if (!l.length || !clipboard) return say(clipboard ? 'Elegí un clip para pegarle los ajustes.' : 'Primero copiá los ajustes de un clip.');
  edit(() => { for (const f of l) { const ok = Object.keys(DEF[f.t.kind]); for (const [k, v] of Object.entries(clipboard.v)) if (ok.includes(k)) f.c[k] = structuredClone(v); } });
  say(l.length > 1 ? `Ajustes pegados en ${l.length} clips.` : 'Ajustes pegados.');
}

// Cambiar la velocidad estira o acorta el clip: lo que sigue en la pista se corre para no pisarse
function setSpeed(c, t, v) {
  const old = end(c);
  c.speed = clamp(v, 0.25, 4);
  shiftAfter(t, c, old);
}
function shiftAfter(t, c, old) { const d = end(c) - old; for (const o of t.clips) if (o !== c && o.start >= old - 1e-6) o.start += d; }
// Marcos para pantalla dividida o imagen en imagen: dónde se ve el clip dentro del cuadro
const BOXES = {
  full: { label: 'Todo el cuadro', v: null },
  top: { label: 'Mitad de arriba', v: [0, 0, 1, 0.5] }, bottom: { label: 'Mitad de abajo', v: [0, 0.5, 1, 0.5] },
  left: { label: 'Mitad izquierda', v: [0, 0, 0.5, 1] }, right: { label: 'Mitad derecha', v: [0.5, 0, 0.5, 1] },
  t1: { label: 'Tercio de arriba', v: [0, 0, 1, 1 / 3] }, t2: { label: 'Tercio del medio', v: [0, 1 / 3, 1, 1 / 3] }, t3: { label: 'Tercio de abajo', v: [0, 2 / 3, 1, 1 / 3] },
  main: { label: 'Principal (65 % arriba)', v: [0, 0, 1, 0.65] }, sec: { label: 'Secundario (35 % abajo)', v: [0, 0.65, 1, 0.35] },
  pipTR: { label: 'Recuadro arriba a la derecha', v: [0.6, 0.05, 0.35, 0.25] }, pipBR: { label: 'Recuadro abajo a la derecha', v: [0.6, 0.66, 0.35, 0.25] }
};

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
  if (needPro('Seguir a quien habla')) return;
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
  $('aspectBadge').textContent = { '9:16': '9:16 vertical', '16:9': '16:9 horizontal', '1:1': '1:1 cuadrado', '4:5': '4:5 retrato' }[P.aspect];
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
  master = new GainNode(actx, { gain: monVol() }); meter = new AnalyserNode(actx, { fftSize: 2048 });
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
    const pr = Math.round(spAt(c, clamp(T - c.start, 0, len(c))) * rate * 100) / 100;
    if (el.playbackRate !== pr) { el.playbackRate = pr; el.preservesPitch = !c.ramp; }
    const audible = T >= c.start && T < end(c) && playing && !t.muted && !c.mute, v = audible ? valAt(c, 'vol', T - c.start) * fadeGain(c, T - c.start) * (c.duck ? duckNow : 1) : 0;
    if (el.cc) { route(el, c); el.cc.out.gain.setTargetAtTime(v, actx.currentTime, 0.012); el.muted = false; if (el.volume !== 1) el.volume = 1; } // el volumen va por la mezcla: el del elemento queda al máximo (si quedó en 0 de antes, no se oía nada)
    else { el.muted = !audible; el.volume = clamp(v * monVol(), 0, 1); }
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
  endCard(g, t); progressBar(g, t); watermark(g);
  g.restore();
}
// Barra de progreso arriba (cuánto falta del video), placa final y marca del plan Gratis
function progressBar(g, t) {
  const pr = P.progress, D = dur();
  if (!pr?.on || !D) return;
  const W = g.canvas.width, h = Math.max(4, Math.round(g.canvas.height * 0.006));
  g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, 0, W, h);
  g.fillStyle = pr.color || '#ff5a1f'; g.fillRect(0, 0, W * clamp(t / D, 0, 1), h);
}
function endCard(g, t) {
  const ec = P.endCard, D = dur(), logo = ec?.logo && media.get(ec.logo), im = logo && bitmapOf(logo), text = (ec?.text || '').trim();
  if (!ec?.on || !D || (!im && !text)) return;
  const al = clamp((t - (D - (ec.sec || 3))) / 0.4, 0, 1);
  if (!al) return;
  const W = g.canvas.width, H = g.canvas.height, e = ease(al), s = 0.85 + 0.15 * e;
  g.save();
  g.fillStyle = `rgba(0,0,0,${0.72 * al})`; g.fillRect(0, 0, W, H);
  g.globalAlpha = al;
  const m = Math.min(W, H);
  let y = H * (text ? 0.42 : 0.5);
  if (im) {
    let w = m * 0.45 * s, h = w * im.height / im.width;
    if (h > H * 0.28) { w *= H * 0.28 / h; h = H * 0.28; }
    g.drawImage(im, (W - w) / 2, y - h / 2, w, h);
    y += h / 2 + m * 0.12;
  } else y = H * 0.5;
  if (text) { // en renglones; las palabras con @ o # van en el color destacado
    const fs = m * 0.065;
    g.font = `900 ${fs}px Montserrat, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    wrap(g, text, W * 0.84).forEach((row, r) => {
      const ry = y + r * fs * 1.25 + (1 - e) * fs * 0.6, sp = g.measureText(' ').width;
      let x = (W - g.measureText(row).width) / 2;
      g.textAlign = 'left';
      for (const w of row.split(' ')) {
        g.lineWidth = fs * 0.16; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(w, x, ry);
        g.fillStyle = /^[@#]/.test(w) ? ec.color || '#ff5a1f' : '#fff'; g.fillText(w, x, ry);
        x += g.measureText(w).width + sp;
      }
    });
  }
  g.restore();
}
function watermark(g) {
  if (!marked()) return;
  const W = g.canvas.width, H = g.canvas.height, fs = Math.round(Math.min(W, H) * 0.032);
  g.save();
  g.font = `800 ${fs}px Montserrat, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.lineWidth = fs * 0.18; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.45)'; g.fillStyle = 'rgba(255,255,255,.85)';
  g.strokeText('Hecho con ClipCreate', W - fs, H - fs * 1.2); g.fillText('Hecho con ClipCreate', W - fs, H - fs * 1.2);
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
const cwOn = cw => !!cw && ['lift', 'gamma', 'gain', 'offset'].some(k => cw[k]?.some(v => Math.abs(v) > 1e-4));
const needsGrade = c => !!c.lut || GRADE_KEYS.some(k => c[k]) || cwOn(c.cw) || GL.curvesOn(c.curves);
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
const KF_KEYS = ['x', 'y', 'scale', 'rot', 'opacity', 'sat', 'vol']; // sat: para el blanco y negro de las frases fuertes
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
// Recorte (crop: izquierda, arriba, derecha, abajo, en fracciones) y marco (box: x, y, ancho, alto del cuadro)
function cropped(c, s) {
  const k = c.crop;
  if (!k || !k.some(v => v > 0)) return s;
  const sx = k[0] * s.w, sy = k[1] * s.h, sw = Math.max(2, s.w * (1 - k[0] - k[2])), sh = Math.max(2, s.h * (1 - k[1] - k[3]));
  return { w: sw, h: sh, paint: (g, x, y, w, h) => s.paint(g, sx, sy, sw, sh, x, y, w, h) };
}
function drawVisual(g, c, s0, fx = {}, t = T) {
  const W = g.canvas.width, H = g.canvas.height, tt = t - c.start, v = k => valAt(c, k, tt), s = cropped(c, s0);
  const bx = c.box ? { x: c.box[0] * W, y: c.box[1] * H, w: c.box[2] * W, h: c.box[3] * H } : { x: 0, y: 0, w: W, h: H };
  const kb = c.kb ? 1 + c.kb * clamp(tt / Math.max(len(c), 0.1), 0, 1) : 1; // zoom lento a lo largo del clip
  const k = (c.fit === 'contain' ? Math.min(bx.w / s.w, bx.h / s.h) : Math.max(bx.w / s.w, bx.h / s.h)) * v('scale') * kb * (fx.k || 1), w = s.w * k, h = s.h * k;
  const alpha = v('opacity') * (fx.alpha ?? 1), cc = c.kf?.sat ? { ...c, sat: v('sat') } : c;
  g.save();
  if (fx.clip) { g.beginPath(); g.rect(...fx.clip); g.clip(); }
  if (c.box) { g.beginPath(); g.rect(bx.x, bx.y, bx.w, bx.h); g.clip(); }
  if (c.bg === 'blur' && (w < bx.w - 1 || h < bx.h - 1)) { // fondo con la misma imagen desenfocada, en vez de bordes
    const kc = Math.max(bx.w / s.w, bx.h / s.h) * 1.15;
    g.save(); g.globalAlpha = alpha; g.filter = `blur(${Math.round(W / 28)}px) brightness(0.7)`;
    s.paint(g, bx.x + (bx.w - s.w * kc) / 2, bx.y + (bx.h - s.h * kc) / 2, s.w * kc, s.h * kc); g.restore();
  }
  g.globalAlpha = alpha;
  g.translate(bx.x + bx.w / 2 + (v('x') + (fx.dx || 0)) * bx.w, bx.y + bx.h / 2 + (v('y') + (fx.dy || 0)) * bx.h);
  const rot = v('rot') + (fx.rot || 0);
  if (rot) g.rotate(rot * Math.PI / 180);
  let paint = s.paint, graded = false;
  if (!colorOff && needsGrade(cc)) { // color con la placa de video (luces, sombras, ruedas, curvas, LUT…); si no hay, filtros simples
    const gw = Math.max(2, Math.min(s.w, Math.ceil(Math.abs(w)))), gh = Math.max(2, Math.round(gw * s.h / s.w));
    const out = GL.grade((gg, ww, hh) => s.paint(gg, 0, 0, ww, hh), gw, gh, cc, lutOf(c), c.lut);
    if (out) { paint = (gg, x, y, ww, hh) => gg.drawImage(out, x, y, ww, hh); graded = true; }
  }
  const f = ((!graded && !colorOff ? colorFilter(cc) : '') + (fx.blur ? ` blur(${(fx.blur * W / 1080).toFixed(1)}px)` : '')).trim();
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
    const r = Math.hypot(Math.min(w, bx.w), Math.min(h, bx.h)) / 2, gr = g.createRadialGradient(0, 0, r * 0.45, 0, 0, r);
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
  g.save(); g.setLineDash([6, 6]); g.strokeStyle = '#ff5a1f99'; g.lineWidth = Math.max(1, W / 360);
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
  $('clock').firstChild.nodeValue = tc(T) + ' ';
  $('clock').lastChild.textContent = '/ ' + tc(D);
  $('head').style.left = HW + T * pps + 'px';
  if (playing) { // la línea de tiempo sigue al cursor
    const tl = $('tl'), x = HW + T * pps;
    if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft + HW) tl.scrollLeft = x - HW - 30;
  }
  if (waiting()) { waitFrom ||= performance.now(); if (performance.now() - waitFrom < 500) return false; }
  waitFrom = 0;
  compose(sg, T, previewSrc);
  if (page === 'color') { colorFollow(); scopeDirty = true; } else guides(sg);
  drawTiles();
  markWord(); refreshKf();
  return true;
}
let rate = 1, rev = 0, lastNow = 0; // velocidad con J y L (rev: hacia atrás)
function loop(now) {
  if (rev && !playing) { T = Math.max(0, T - (now - lastNow) / 1000 * rev); dirty = true; if (!T) shuttleStop(); }
  lastNow = now;
  if (playing) {
    T = p0 + (now - t0) / 1000 * rate;
    if (T >= dur() || (stopAt != null && T >= stopAt)) { T = Math.min(T, dur()); pause(); }
    dirty = true;
  }
  if (P) {
    syncMedia(); readMeter(); if (dirty && draw()) dirty = false;
    if (page === 'color' && scopeDirty && now - lastScope > 150) { scopeDirty = false; lastScope = now; updateScopes(); }
  }
  requestAnimationFrame(loop);
}
function play(r = 1) {
  if (!dur()) return say('Importá un video para empezar.');
  rate = r; rev = 0; shuttleShow();
  if (audioCtx()?.state === 'suspended') actx.resume();
  if (T >= dur() - 0.05) T = 0;
  playing = true; t0 = performance.now(); p0 = T;
  $('play').innerHTML = '<svg class="i"><use href="#i-pause"/></svg>'; $('play').setAttribute('aria-label', 'Pausar (Espacio)');
}
function pause() {
  if (rec?.state === 'recording') rec.stop();
  rate = 1; rev = 0; shuttleShow();
  playing = false; stopAt = null;
  for (const el of els.values()) el.pause();
  $('play').innerHTML = '<svg class="i"><use href="#i-play"/></svg>'; $('play').setAttribute('aria-label', 'Reproducir (Espacio)');
  dirty = true;
}
const toggle = () => playing || rev ? pause() : play();
// J, K y L: atrás, pausa y adelante; cada toque más dobla la velocidad (hasta 8×)
function shuttle(dir) {
  if (dir > 0) { const r = playing && rate > 0 ? Math.min(8, rate * 2) : 1; if (playing) { p0 = T; t0 = performance.now(); rate = r; shuttleShow(); } else play(r); }
  else { const r = rev ? Math.min(8, rev * 2) : 1; if (playing) pause(); rev = r; shuttleShow(); }
}
const shuttleStop = () => { rev = 0; shuttleShow(); dirty = true; };
function shuttleShow() { const b = $('shuttle'); const r = rev ? -rev : playing && rate !== 1 ? rate : 0; b.hidden = !r; b.textContent = r < 0 ? `◀◀ ${-r}×` : `▶▶ ${r}×`; }
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
  ruler.style.setProperty('--tick', step * pps / 5 + 'px');
  for (let s = 0; s * pps < W; s += step) {
    const sp = document.createElement('span');
    sp.style.left = s * pps + 'px'; sp.textContent = step < 1 ? fmt(s) : fmt(s).replace(/\.0$/, '');
    ruler.append(sp);
  }
  for (const [a, b] of silMarks) { const i = document.createElement('i'); i.style.left = a * pps + 'px'; i.style.width = Math.max(2, (b - a) * pps) + 'px'; ruler.append(i); }
  for (const [a, b] of fillMarks) { const i = document.createElement('i'); i.className = 'fill'; i.style.left = a * pps + 'px'; i.style.width = Math.max(2, (b - a) * pps) + 'px'; ruler.append(i); }
  for (const m of P.markers || []) { const b = document.createElement('b'); b.className = 'mk'; b.style.left = m.t * pps + 'px'; b.style.setProperty('--mc', m.color); b.title = (m.label || 'Marcador') + ' · ' + tc(m.t); ruler.append(b); }
  const rows = [Object.assign(document.createElement('div'), { className: 'corner' }), ruler];
  const io = P.io || {};
  if (io.i != null || io.o != null) { // entrada y salida: franja sobre todas las pistas
    const a = io.i ?? 0, b = io.o ?? Math.max(dur(), a), band = Object.assign(document.createElement('div'), { className: 'ioband' });
    band.style.left = HW + a * pps + 'px'; band.style.width = Math.max(1, (b - a) * pps) + 'px';
    band.classList.toggle('open', io.i == null || io.o == null);
    rows.push(band);
  }
  for (const t of P.tracks) {
    const th = document.createElement('div');
    th.className = 'th k-' + t.kind;
    th.append(Object.assign(document.createElement('span'), { textContent: t.name, title: t.name }));
    const tb = (icon, label, pressed, fn) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', innerHTML: `<svg class="i"><use href="#i-${icon}"/></svg>`, title: label, onclick: fn });
      b.setAttribute('aria-label', `${label}: ${t.name}`);
      if (pressed !== null) b.setAttribute('aria-pressed', pressed);
      return b;
    };
    if (t.kind !== 'audio') th.append(tb(t.hidden ? 'eyeoff' : 'eye', 'Ocultar pista', t.hidden, () => edit(() => { t.hidden = !t.hidden; })));
    if (t.kind !== 'text') th.append(tb(t.muted ? 'mute' : 'vol', 'Silenciar pista', t.muted, () => edit(() => { t.muted = !t.muted; })));
    th.append(tb('x', 'Borrar pista', null, () => {
      if (t.clips.length && !confirm(`¿Borrar la pista «${t.name}» y sus ${t.clips.length} clip(s)?`)) return;
      edit(() => { P.tracks = P.tracks.filter(x => x !== t); if (sel && !find(sel)) sel = null; });
    }));
    const lane = document.createElement('div');
    lane.className = 'lane k-' + t.kind; lane.dataset.track = t.id; lane.style.width = W + 'px';
    th.style.height = LANE_H[t.kind] + 'px';
    for (const c of t.clips) {
      const m = media.get(c.media), el = document.createElement('div'), label = clipLabel(c, t);
      el.className = `clip k-${t.kind}${c.sub ? ' sub' : ''}${isSel(c.id) ? ' sel' : ''}${t.kind !== 'text' && (c.mute || t.muted) ? ' muted' : ''}${c.tr && c.tr !== 'none' ? ' tr' : ''}${c.voz?.p ? ' voz' : ''}`;
      if (c.tr && c.tr !== 'none') el.title = 'Transición: ' + TRANS[c.tr];
      el.dataset.id = c.id; el.tabIndex = 0;
      if (c.lc) el.style.setProperty('--kc', c.lc);
      el.style.left = c.start * pps + 'px'; el.style.width = Math.max(6, len(c) * pps) + 'px';
      el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', isSel(c.id));
      el.setAttribute('aria-label', `${NAMES[t.kind]}: ${label}, de ${fmt(c.start)} a ${fmt(end(c))}`);
      el.innerHTML = '<i class="h l" aria-hidden="true"></i><span></span><i class="h r" aria-hidden="true"></i>';
      el.querySelector('span').textContent = label;
      if (m && t.kind !== 'text') { loadVisuals(m); const cv = clipCanvas(c, t, m, Math.max(6, len(c) * pps), LANE_H[t.kind] - 6); if (cv) el.prepend(cv); }
      if (t.kind !== 'text' && (t.kind === 'audio' || isSel(c.id) || c.kf?.vol) && (t.kind === 'audio' || m?.hasAudio) && !c.mute) el.append(volLine(c, Math.max(6, len(c) * pps), LANE_H[t.kind] - 6));
      const kts = c.kf ? [...new Set(Object.entries(c.kf).filter(([k]) => k !== 'vol').flatMap(([, l]) => l).map(([k]) => +k.toFixed(2)))] : [];
      if (kts.length <= 16) for (const tk of kts) if (tk >= 0 && tk <= len(c)) { /* con muchos (zoom automático) no se marcan uno por uno */ const d = document.createElement('b'); d.className = 'kfm'; d.style.left = tk * pps + 'px'; el.append(d); }
      lane.append(el);
    }
    rows.push(th, lane);
  }
  const head = Object.assign(document.createElement('div'), { id: 'head' });
  head.style.left = HW + T * pps + 'px';
  tlIn.replaceChildren(...rows, head);
  $('split').disabled = $('dup').disabled = !sel; $('del').disabled = $('rippleDel').disabled = !picked().length;
  $('extract').disabled = $('lift').disabled = !ioOk();
  $('detach').disabled = !(sel && find(sel)?.t.kind === 'video' && media.get(find(sel).c.media)?.type === 'video');
}

// Línea del volumen sobre el clip (0 abajo, 200 % arriba): con puntos si tiene fotogramas clave de volumen
const NS = 'http://www.w3.org/2000/svg';
function volLine(c, w, h) {
  const svg = document.createElementNS(NS, 'svg'), y = v => (1 - clamp(v, 0, 2) / 2) * (h - 6) + 3;
  svg.setAttribute('class', 'vol'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('aria-hidden', 'true');
  const l = c.kf?.vol?.length ? c.kf.vol : null;
  const pts = l ? [[0, l[0][1]], ...l, [len(c), l.at(-1)[1]]] : [[0, c.vol], [len(c), c.vol]];
  const pl = document.createElementNS(NS, 'polyline');
  pl.setAttribute('points', pts.map(([tt, v]) => `${clamp(tt, 0, len(c)) * pps},${y(v)}`).join(' '));
  const hit = pl.cloneNode(); hit.setAttribute('class', 'vhit'); // franja más ancha para agarrar la línea
  svg.append(hit, pl);
  if (l) l.forEach(([tt, v], i) => { const k = document.createElementNS(NS, 'circle'); k.setAttribute('class', 'vk'); k.dataset.i = i; k.setAttribute('cx', tt * pps); k.setAttribute('cy', y(v)); k.setAttribute('r', 4); svg.append(k); });
  return svg;
}
const volFromY = (el, cy) => { const r = el.getBoundingClientRect(); return clamp(2 * (1 - (cy - r.top - 3) / (r.height - 6)), 0, 2); };

// Arrastrar: mover clips (también entre pistas), recortar bordes y mover el cursor
let drag = null;
const timeAt = x => Math.max(0, (x - tlIn.getBoundingClientRect().left - HW) / pps);
function snapPts(except) {
  const pts = [0, T];
  for (const t of P.tracks) for (const c of t.clips) if (c !== except) pts.push(c.start, end(c));
  return pts;
}
const snapTo = (v, pts) => { if (!snapOn) return null; for (const p of pts) if (Math.abs(p - v) * pps < 8) return p; return null; };

tlIn.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const clipEl = e.target.closest('.clip'), add = e.shiftKey || e.ctrlKey || e.metaKey;
  if (e.target.closest('#ruler')) { drag = { mode: 'scrub' }; seek(timeAt(e.clientX)); }
  else if (!clipEl && e.target.closest('.lane')) { // espacio vacío: clic = ir ahí; arrastrar = recuadro para elegir varios
    drag = { mode: 'marq', x0: e.clientX, y0: e.clientY, base: new Set(add ? picked().map(f => f.c.id) : []), moved: false };
  } else if (clipEl && (e.target.closest('.vk') || (e.target.closest('.vhit') && !find(clipEl.dataset.id)?.c.kf?.vol) || (e.altKey && clipEl.querySelector('svg.vol')))) { // volumen
    const f = find(clipEl.dataset.id);
    if (!f) return;
    const before = snap(), tt = clamp(timeAt(e.clientX) - f.c.start, 0, len(f.c)), v = volFromY(clipEl, e.clientY);
    sel = f.c.id; multi.clear();
    let i = e.target.closest('.vk') ? +e.target.closest('.vk').dataset.i : -1;
    if (e.altKey && i < 0) { // Alt+clic: punto nuevo
      f.c.kf ??= {}; const l = f.c.kf.vol ??= [];
      l.push([tt, l.length ? valAt(f.c, 'vol', tt) : f.c.vol]); l.sort((a, b) => a[0] - b[0]); i = l.findIndex(p => p[0] === tt);
    }
    drag = { mode: i >= 0 ? 'vk' : 'vflat', f, i, before, moved: e.altKey };
    renderTimeline(); renderProps();
  } else if (clipEl && tool === 'blade') { // cuchilla: corta ese clip (con Shift, todas las pistas) donde hiciste clic
    seek(Math.round(timeAt(e.clientX) * 30) / 30);
    if (e.shiftKey) splitAll(); else { sel = clipEl.dataset.id; multi.clear(); split(); }
    e.preventDefault(); return;
  } else if (clipEl) {
    const f = find(clipEl.dataset.id);
    if (!f) return;
    if (add) { // Shift o Ctrl + clic: suma o saca el clip de la selección
      if (!multi.size && sel) multi.add(sel);
      if (multi.has(f.c.id)) { multi.delete(f.c.id); if (sel === f.c.id) sel = [...multi].at(-1) ?? null; }
      else { multi.add(f.c.id); sel = f.c.id; }
      if (multi.size <= 1) { sel = [...multi][0] ?? sel; multi.clear(); }
      renderTimeline(); renderProps(); e.preventDefault(); return;
    }
    if (!multi.has(f.c.id)) multi.clear();
    if (sel !== f.c.id) { sel = f.c.id; renderProps(); }
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const others = f.t.clips.filter(o => o !== f.c);
    const group = mode === 'move' ? picked().filter(g => g.c !== f.c).map(g => ({ g, s0: g.c.start })) : [];
    drag = {
      mode, f, x0: e.clientX, before: snap(), c0: { ...f.c }, pts: snapPts(f.c), moved: false, group,
      prevEnd: Math.max(0, ...others.filter(o => end(o) <= f.c.start + 1e-6).map(end)),
      nextStart: Math.min(Infinity, ...others.filter(o => o.start >= end(f.c) - 1e-6).map(o => o.start))
    };
    renderTimeline();
    tlIn.querySelector(`[data-id="${f.c.id}"]`)?.focus({ preventScroll: true });
  } else return;
  tlIn.setPointerCapture(e.pointerId);
  e.preventDefault();
});
function marquee(e) {
  const d = drag, r0 = tlIn.getBoundingClientRect();
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
  d.moved = true;
  const x1 = Math.min(d.x0, e.clientX), x2 = Math.max(d.x0, e.clientX), y1 = Math.min(d.y0, e.clientY), y2 = Math.max(d.y0, e.clientY);
  let box = $('marq');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'marq' }); tlIn.append(box); }
  Object.assign(box.style, { left: x1 - r0.left + 'px', top: y1 - r0.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
  d.hits = new Set(d.base);
  for (const el of tlIn.querySelectorAll('.clip')) {
    const r = el.getBoundingClientRect(), hit = r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2;
    if (hit) d.hits.add(el.dataset.id);
    el.classList.toggle('sel', d.hits.has(el.dataset.id));
  }
}
tlIn.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.mode === 'scrub') return seek(timeAt(e.clientX));
  if (drag.mode === 'marq') return marquee(e);
  if (drag.mode === 'vk' || drag.mode === 'vflat') {
    const c = drag.f.c, el = tlIn.querySelector(`[data-id="${c.id}"]`), v = +volFromY(el, e.clientY).toFixed(3);
    drag.moved = true;
    if (drag.mode === 'vflat') c.vol = v;
    else {
      const l = c.kf.vol, i = drag.i, tt = clamp(timeAt(e.clientX) - c.start, i > 0 ? l[i - 1][0] + 0.02 : 0, i < l.length - 1 ? l[i + 1][0] - 0.02 : len(c));
      l[i] = [+tt.toFixed(3), v];
    }
    say(`Volumen: ${Math.round(v * 100)} %`);
    renderTimeline(); return;
  }
  const { f, c0 } = drag, c = f.c, dx = (e.clientX - drag.x0) / pps;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
  drag.moved = true;
  const av = isAV(c, f.t), m = media.get(c.media);
  if (drag.mode === 'move') {
    let s = Math.max(0, c0.start + dx);
    const a = snapTo(s, drag.pts), b = snapTo(s + len(c), drag.pts);
    s = a ?? (b !== null ? b - len(c) : s);
    c.start = Math.max(0, s);
    if (drag.group.length) { // varios clips: se mueven juntos, cada uno en su pista
      const dd = Math.max(c.start - c0.start, -Math.min(c0.start, ...drag.group.map(x => x.s0)));
      c.start = c0.start + dd;
      for (const x of drag.group) x.g.c.start = x.s0 + dd;
    } else { // pasar a otra pista del mismo tipo
      const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lane');
      const to = lane && P.tracks.find(t => t.id === lane.dataset.track);
      if (to && to !== f.t && to.kind === f.t.kind) { f.t.clips = f.t.clips.filter(x => x !== c); to.clips.push(c); f.t = to; }
    }
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
const endDrag = e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'marq') {
    $('marq')?.remove();
    if (!d.moved) { seek(timeAt(e.clientX)); if (sel || multi.size) { sel = null; multi.clear(); renderTimeline(); renderProps(); } return; }
    multi.clear(); for (const id of d.hits || []) multi.add(id);
    sel = [...multi].at(-1) ?? null;
    if (multi.size <= 1) multi.clear();
    renderTimeline(); renderProps();
    if (multi.size) say(`${multi.size} clips elegidos: podés moverlos juntos, borrarlos o pegarles ajustes.`);
    return;
  }
  if (d.mode === 'vk' || d.mode === 'vflat') { if (remember(d.before)) changed(); return; }
  if (d.mode === 'scrub' || !d.moved) return;
  if (d.mode === 'move') { fitFree(d.f.t, d.f.c); for (const x of d.group) fitFree(x.g.t, x.g.c); }
  if (remember(d.before)) changed(); else renderTimeline();
};
tlIn.addEventListener('pointerup', endDrag);
tlIn.addEventListener('dblclick', e => {
  const k = e.target.closest('.vk'), f = k && find(k.closest('.clip').dataset.id);
  if (!f) return;
  edit(() => { const l = f.c.kf.vol; l.splice(+k.dataset.i, 1); if (!l.length) { f.c.vol = valAt(f.c, 'vol', 0); delete f.c.kf.vol; } if (!Object.keys(f.c.kf).length) f.c.kf = null; });
});
tlIn.addEventListener('pointercancel', endDrag);
tl.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setPps(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), timeAt(e.clientX));
}, { passive: false });
tlIn.addEventListener('focusin', e => {
  const c = e.target.closest('.clip');
  if (c && sel !== c.dataset.id && !drag && !multi.size) { sel = c.dataset.id; renderProps(); renderTimeline(); tlIn.querySelector(`[data-id="${sel}"]`)?.focus(); }
});

// Soltar archivos de la lista en una pista
tlIn.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('text/x-clipcreate-tr')) { // transición: se suelta sobre un clip de video
    const c = e.target.closest('.clip.k-video');
    tlIn.querySelectorAll('.clip.over').forEach(x => x !== c && x.classList.remove('over'));
    if (c) { e.preventDefault(); c.classList.add('over'); }
    return;
  }
  const lane = e.target.closest('.lane');
  if (!lane || !e.dataTransfer.types.includes('text/x-clipcreate')) return;
  e.preventDefault();
  tlIn.querySelectorAll('.lane.over').forEach(l => l.classList.remove('over'));
  lane.classList.add('over');
});
tlIn.addEventListener('dragleave', e => e.target.closest?.('.lane')?.classList.remove('over'));
tlIn.addEventListener('drop', e => {
  const tr = e.dataTransfer.getData('text/x-clipcreate-tr');
  if (tr) { const c = e.target.closest('.clip.k-video'); tlIn.querySelectorAll('.clip.over').forEach(x => x.classList.remove('over')); if (c) { e.preventDefault(); e.stopPropagation(); applyTr(tr, find(c.dataset.id)); } return; }
  const lane = e.target.closest('.lane'), mid = e.dataTransfer.getData('text/x-clipcreate');
  tlIn.querySelectorAll('.lane.over').forEach(l => l.classList.remove('over'));
  if (!lane || !media.has(mid)) return;
  e.preventDefault(); e.stopPropagation();
  const t = P.tracks.find(x => x.id === lane.dataset.track);
  edit(() => addMedia(mid, timeAt(e.clientX), t));
  fitIfNeeded();
});

// ---------- Miniaturas y forma de onda (se preparan en segundo plano y quedan guardadas aparte) ----------
const LANE_H = { video: 56, audio: 48, text: 32 };
const vis = new Map(), visQueue = [], canv = new Map();
let visBusy = false, tlRaf = 0;
const dirtyTl = () => { if (!tlRaf) tlRaf = requestAnimationFrame(() => { tlRaf = 0; if (!drag) renderTimeline(); }); };
function loadVisuals(m) {
  if (vis.has(m.id)) return vis.get(m.id);
  const v = { strip: null, n: 0, tw: 0, peaks: null };
  vis.set(m.id, v);
  (async () => {
    try {
      const r = await S.get('visuals', m.id);
      if (r) { if (r.strip) v.strip = await createImageBitmap(r.strip); Object.assign(v, { n: r.n, tw: r.tw, peaks: r.peaks || null }); }
    } catch {}
    if (m.type === 'image') bitmapOf(m);
    if ((m.type === 'video' && !v.strip) || ((m.type === 'audio' || m.hasAudio) && !v.peaks)) { visQueue.push(m); pumpVis(); }
    dirtyTl();
  })();
  return v;
}
async function pumpVis() {
  if (visBusy) return;
  visBusy = true;
  try {
    while (visQueue.length) {
      const m = visQueue.shift(), v = vis.get(m.id);
      if (!media.has(m.id)) continue;
      try {
        const M = await mb(), inp = new M.Input({ source: new M.BlobSource(m.blob), formats: M.ALL_FORMATS }), rec = { id: m.id };
        if (m.type === 'video' && !v.strip) { // 24 cuadros a lo largo del video, en una sola imagen
          $('bgwork').textContent = `Miniaturas de «${m.name}»…`;
          const vt = await inp.getPrimaryVideoTrack();
          if (vt) {
            const N = 24, h = 72, w = Math.max(16, Math.round(h * (m.w || 16) / (m.h || 9))), sheet = new OffscreenCanvas(w * N, h), g = sheet.getContext('2d');
            const sink = new M.CanvasSink(vt, { width: w, height: h, fit: 'cover', poolSize: 1 });
            let i = 0;
            for await (const fr of sink.canvasesAtTimestamps(Array.from({ length: N }, (_, k) => (k + 0.5) * m.duration / N))) { if (fr) g.drawImage(fr.canvas, i * w, 0, w, h); i++; }
            v.strip = await createImageBitmap(sheet); v.n = N; v.tw = w;
            rec.strip = await sheet.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
          }
        }
        if ((m.type === 'audio' || m.hasAudio) && !v.peaks) { // el pico de cada 20 ms
          const at = await inp.getPrimaryAudioTrack();
          if (at) {
            const pk = new Uint8Array(Math.ceil(m.duration * 50) + 1);
            let last = 0;
            for await (const w of new M.AudioBufferSink(at).buffers()) {
              const b = w.buffer, d = b.getChannelData(0), sr = b.sampleRate;
              for (let i = 0; i < b.length; i += 4) { const k = Math.floor((w.timestamp + i / sr) * 50); if (k >= 0 && k < pk.length) { const a = Math.min(255, Math.abs(d[i]) * 255); if (a > pk[k]) pk[k] = a; } }
              if (w.timestamp - last > 30) { last = w.timestamp; $('bgwork').textContent = `Forma de onda de «${m.name}»… ${Math.round(w.timestamp / m.duration * 100)} %`; }
            }
            v.peaks = rec.peaks = pk;
          }
        }
        Object.assign(rec, { n: v.n, tw: v.tw, peaks: v.peaks });
        if (!rec.strip && v.strip) { const old = await S.get('visuals', m.id).catch(() => null); rec.strip = old?.strip; }
        await S.put('visuals', rec).catch(() => {});
        for (const [k, e] of canv) if (e.m === m.id) canv.delete(k);
        dirtyTl();
      } catch (e) { console.warn('Sin miniaturas para', m.name, e); }
    }
  } finally { visBusy = false; $('bgwork').textContent = ''; }
}
// Dibujo de cada clip: miniaturas a lo largo (según el tramo del archivo que muestra) y la forma de onda
function clipCanvas(c, t, m, w, h) {
  const v = vis.get(m.id), W = Math.min(Math.ceil(w), 8000), img = m.type === 'image' ? m.bmp : v?.strip;
  const audioH = t.kind === 'video' && v?.peaks && m.type === 'video' ? Math.round(h * 0.3) : 0;
  const key = [W, h, c.in, c.out, sp(c), pps, !!img, !!v?.peaks, c.vol].join('|');
  const e = canv.get(c.id);
  if (e?.key === key) return e.cv;
  if (!img && !v?.peaks) return null;
  const cv = e?.cv || document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(h * dpr); cv.style.width = W + 'px';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (t.kind === 'video' && img) {
    const th = h - audioH, tw = th * (m.w && m.h ? m.w / m.h : img.width / img.height);
    for (let x = 0; x < W; x += tw) {
      if (m.type === 'image') g.drawImage(img, x, 0, tw, th);
      else { const st = srcAt(c, c.start + (x + tw / 2) / pps), k = clamp(Math.round(st / m.duration * v.n - 0.5), 0, v.n - 1); g.drawImage(img, k * v.tw, 0, v.tw, img.height, x, 0, tw, th); }
    }
    g.fillStyle = '#00000030'; g.fillRect(0, 0, W, th);
  }
  if (v?.peaks && (t.kind === 'audio' || audioH)) {
    const y0 = t.kind === 'audio' ? 0 : h - audioH, hh = t.kind === 'audio' ? h : audioH, mid = y0 + hh / 2, gain = Math.min(2, c.vol ?? 1);
    if (audioH) { g.fillStyle = '#0d1b2e'; g.fillRect(0, y0, W, hh); }
    g.fillStyle = t.kind === 'audio' ? '#a6f0c9' : '#9ec3ff';
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(srcAt(c, c.start + x / pps) * 50), i1 = Math.floor(srcAt(c, c.start + (x + 1) / pps) * 50);
      let pk = 0;
      for (let i = i0; i <= i1 && i < v.peaks.length; i++) if (v.peaks[i] > pk) pk = v.peaks[i];
      const a = Math.min(1, Math.sqrt(pk / 255) * gain) * hh * 0.46;
      g.fillRect(x, mid - a, 1, Math.max(1, a * 2));
    }
  }
  canv.set(c.id, { key, cv, m: m.id });
  return cv;
}

// ---------- Herramientas, transporte y divisor ----------
let tool = 'select', snapOn = true;
function setTool(x) {
  tool = x;
  $('toolSel').setAttribute('aria-pressed', x === 'select'); $('toolBlade').setAttribute('aria-pressed', x === 'blade');
  tl.classList.toggle('blade', x === 'blade');
  say(x === 'blade' ? 'Cuchilla: hacé clic sobre un clip para cortarlo ahí. V vuelve a la selección.' : 'Selección.');
}
$('toolSel').onclick = () => setTool('select');
$('toolBlade').onclick = () => setTool('blade');
$('snapBtn').onclick = () => { snapOn = !snapOn; $('snapBtn').setAttribute('aria-pressed', snapOn); say(snapOn ? 'Imán prendido: los clips se pegan a los bordes y al cursor.' : 'Imán apagado.'); };
$('tStart').onclick = () => seek(0);
$('tEnd').onclick = () => seek(dur());
$('tPrev').onclick = () => seek(Math.round(T * 30 - 1) / 30);
$('tNext').onclick = () => seek(Math.round(T * 30 + 1) / 30);
$('tSafe').onclick = () => edit(() => { P.safe = !P.safe; });
$('tFull').onclick = () => { const v = $('stageWrap'); document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen?.().catch(() => {}); };
$('zIn').onclick = () => setPps(pps * 1.3);
$('zOut').onclick = () => setPps(pps / 1.3);
const split2 = $('split2');
const tlhNow = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tlh')) || 300;
function setTlh(h) {
  h = clamp(Math.round(h), 140, Math.max(160, innerHeight - 300));
  document.documentElement.style.setProperty('--tlh', h + 'px');
  try { localStorage.setItem('clipcreate.editor.tlh', h); } catch {}
}
try { const h = +localStorage.getItem('clipcreate.editor.tlh'); if (h) setTlh(h); } catch {}
split2.onpointerdown = e => {
  split2.setPointerCapture(e.pointerId);
  const y0 = e.clientY, h0 = tlhNow();
  split2.onpointermove = m => setTlh(h0 - (m.clientY - y0));
  split2.onpointerup = split2.onpointercancel = () => { split2.onpointermove = null; };
};
split2.onkeydown = e => { const d = { ArrowUp: 24, ArrowDown: -24 }[e.key]; if (d) { e.preventDefault(); setTlh(tlhNow() + d); } };

// Inspector: cada grupo de propiedades es una sección plegable (se recuerda cuáles cerraste)
let closedSecs = new Set();
try { closedSecs = new Set(JSON.parse(localStorage.getItem('clipcreate.editor.secciones') || '[]')); } catch {}
function sectionize() {
  const box = $('props');
  let body = null;
  for (const n of [...box.children]) {
    if (n.tagName === 'H3') {
      const title = n.textContent, d = document.createElement('details'), sm = document.createElement('summary');
      d.className = 'sec'; d.open = !closedSecs.has(title); sm.textContent = title;
      body = Object.assign(document.createElement('div'), { className: 'body' });
      d.append(sm, body);
      d.ontoggle = () => { d.open ? closedSecs.delete(title) : closedSecs.add(title); try { localStorage.setItem('clipcreate.editor.secciones', JSON.stringify([...closedSecs])); } catch {} };
      n.replaceWith(d);
    } else if (n.classList.contains('foot')) body = null;
    else if (body) body.append(n);
  }
}

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
  if (needPro('Clips inteligentes')) return;
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
const acts = (...a) => `<div class="row">${a.map(([act, t, ic]) => `<button type="button" data-act="${act}">${ic ? `<svg class="i"><use href="#i-${ic}"/></svg>` : ''}${t}</button>`).join('')}</div>`;

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
      ${soundClips().length ? `<h3>Voz</h3>${acts(['vozEvery', 'Mejorar todas las voces', 'spark'])}<p class="hint">Limpia y empareja el audio de todos los clips con el perfil Entrevista. Después podés ajustar cada uno.</p>
        ${acts(['autoMix', 'Mezcla automática', 'mix'])}<p class="hint">Deja todas las voces al mismo nivel y la música 16 dB por debajo, bajando sola cuando hablan.</p>` : ''}
      <h3>Final del video</h3>
      ${check('progress.on', 'Barra de progreso arriba')}
      ${P.progress?.on ? color('progress.color', 'Color de la barra') : ''}
      ${check('endCard.on', 'Placa final (logo y texto)')}
      ${P.endCard?.on ? `${field('endCard.text', 'Texto', '<input type="text" maxlength="80" placeholder="Seguinos en @tucuenta">')}
        ${opts('endCard.sec', 'Dura', { 2: '2 segundos', 3: '3 segundos', 4: '4 segundos', 5: '5 segundos' })}
        ${color('endCard.color', 'Color de @ y #')}
        <p class="hint">${P.endCard.logo && media.has(P.endCard.logo) ? 'Logo: ' + esc(media.get(P.endCard.logo).name) : 'Sin logo.'}</p>
        ${acts(['endLogo', P.endCard.logo ? 'Cambiar logo' : 'Elegir logo'], ...(P.endCard.logo ? [['endLogoOff', 'Sin logo']] : []))}` : ''}
      <h3>Marcadores</h3>
      ${(P.markers || []).length ? `<ul class="mlist">${P.markers.map((m, i) => `<li style="--mc:${m.color}"><button type="button" data-mgo="${i}" title="Ir a este marcador">${tc(m.t)}</button><input type="text" data-mlabel="${i}" value="${esc(m.label)}" maxlength="60" aria-label="Nota del marcador ${i + 1}" placeholder="Nota"><button type="button" class="ghost ico" data-mdel="${i}" aria-label="Borrar el marcador ${i + 1}"><svg class="i"><use href="#i-x"/></svg></button></li>`).join('')}</ul>` : '<p class="hint">Tocá M para marcar el momento actual. Shift+↑ ↓ salta entre marcadores.</p>'}
      ${(P.markers || []).length ? acts(['ytCh', 'Copiar capítulos para YouTube']) : ''}
      <h3>Atajos</h3>
      ${acts(['keys', 'Ver todos los atajos (?)', 'keys'])}`;
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
      <label>Marco<select data-boxp>${Object.entries(BOXES).map(([k2, b]) => `<option value="${k2}"${JSON.stringify(c.box) === JSON.stringify(b.v) ? ' selected' : ''}>${b.label}</option>`).join('')}</select></label>
      ${krange('scale', 'Zoom', 0.1, 4, 0.01, 'pct')}
      ${krange('x', 'Horizontal', -1, 1, 0.005, 'num')}${krange('y', 'Vertical', -1, 1, 0.005, 'num')}
      ${krange('rot', 'Rotación', -180, 180, 1, 'deg')}${krange('opacity', 'Opacidad', 0, 1, 0.01, 'pct')}
      <p class="hint">◆ guarda el valor en este momento (fotograma clave): con dos o más, se anima entre ellos.${c.kf ? '' : ''}</p>
      ${c.kf ? acts(['kfClear', 'Borrar fotogramas clave']) : ''}
      ${range('kb', 'Zoom lento a lo largo del clip', 0, 0.3, 0.01, 'pct')}
      ${m?.type === 'video' && P.aspect !== '16:9' ? acts(['rf', 'Seguir a quien habla', 'target']) : ''}
      <h3>Color</h3>
      <label>Perfil<select data-look><option value="">Elegí un perfil…</option><option value="podcast">Podcast</option><option value="interiores">Interiores</option><option value="calida">Luz cálida</option><option value="fria">Luz fría</option><option value="cine">Cinematográfico</option><option value="neutro">Sin corrección</option></select></label>
      ${opts('lut', 'LUT', { '': 'Ninguno', ...Object.fromEntries(Object.entries(Assets.LUTS).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(P.luts || {}).map(([k, v]) => [k, v.name])), __import: 'Importar un .cube…' })}
      ${c.lut ? range('lutMix', 'Intensidad del LUT', 0, 1, 0.01, 'pct') + acts(['lutDown', 'Bajar este LUT (.cube)']) : ''}
      ${range('exp', 'Exposición', -1, 1, 0.01, 'num')}${range('con', 'Contraste', -1, 1, 0.01, 'num')}
      ${range('hl', 'Luces', -1, 1, 0.01, 'num')}${range('sh', 'Sombras', -1, 1, 0.01, 'num')}
      ${range('wh', 'Blancos', -1, 1, 0.01, 'num')}${range('bl', 'Negros', -1, 1, 0.01, 'num')}
      ${range('temp', 'Temperatura', -1, 1, 0.01, 'num')}${range('tint', 'Tinte', -1, 1, 0.01, 'num')}
      ${krange('sat', 'Saturación', -1, 1, 0.01, 'num')}${range('vib', 'Vibrance', -1, 1, 0.01, 'num')}
      ${range('hue', 'Matiz', -30, 30, 1, 'deg')}${range('vig', 'Viñeta', 0, 1, 0.01, 'pct')}
      ${range('grain', 'Grano de película', 0, 1, 0.01, 'pct')}
      ${GL.available() ? '' : '<p class="hint">Este navegador no tiene WebGL2: luces, sombras, blancos, negros, vibrance y LUTs no se aplican.</p>'}
      ${acts(['orig', colorOff ? 'Ver con color' : 'Ver original'], ['colorPage', 'Página de Color', 'color'])}
      <h3>Transición de entrada</h3>
      ${opts('tr', 'Tipo', TRANS)}
      ${c.tr !== 'none' ? `${range('trD', 'Duración', 0.1, 2, 0.05, 's')}
        ${['deslizar', 'barrido', 'giro'].includes(c.tr) ? opts('trDir', 'Dirección', { izq: 'Hacia la izquierda', der: 'Hacia la derecha', arriba: 'Hacia arriba', abajo: 'Hacia abajo' }) : ''}
        ${['blanco', 'zoom', 'desenfoque', 'giro', 'glitch'].includes(c.tr) ? range('trK', 'Intensidad', 0.2, 2, 0.05, 'pct') : ''}
        ${f && NEEDS_PREV.has(c.tr) && !prevOf(t, c) ? '<p class="hint">No hay un clip pegado antes: entra desde el fondo.</p>' : ''}
        ${acts(['trAll', 'Usar en todos los cortes'])}` : ''}`;
    if (!isImg && m?.hasAudio !== false && (!visual || m?.hasAudio)) {
      h += `<h3>Sonido</h3>
      ${krange('vol', 'Volumen', 0, 2, 0.01, 'pct')}
      <p class="hint">En la línea de tiempo: Alt+clic sobre la línea del volumen agrega un punto; arrastrá los puntos; doble clic los saca.</p>
      ${check('mute', 'Silenciar este clip')}
      ${t.kind === 'audio' ? check('duck', 'Bajar cuando hablan (para música)') : ''}
      <div class="two">${range('fadeIn', 'Fundido de entrada', 0, 5, 0.1, 's')}${range('fadeOut', 'Fundido de salida', 0, 5, 0.1, 's')}</div>
      <h3>Voz</h3>`;
      h += c.voz?.p ? `${opts('voz.p', 'Perfil', { '': 'Apagado', podcast: 'Podcast: cálida y presente', entrevista: 'Entrevista: natural y pareja', viral: 'Voz viral: fuerte, para el celular' })}
        ${range('voz.noise', 'Reducción de ruido', 0, 1, 0.01, 'pct')}${range('voz.clarity', 'Claridad', 0, 8, 0.1, 'db')}
        ${range('voz.level', 'Nivelado del volumen', 0, 1, 0.01, 'pct')}${check('voz.hum', 'Sacar zumbido eléctrico (50 Hz)')}
        <div class="row"><button type="button" data-act="ab" aria-pressed="${bypass}">${bypass ? 'Escuchar mejorado' : 'Escuchar original'}</button><button type="button" data-act="vozAll">Usar en todo este archivo</button></div>
        <p class="hint">Baja el ruido entre frases, el zumbido y las resonancias, y deja la voz pareja. No hace milagros con ruido fuerte encima de la voz: ajustalo a oído.</p>`
        : `${acts(['voz', 'Mejorar voz', 'spark'])}<p class="hint">Analiza el audio y aplica el perfil Entrevista. Después lo podés cambiar.</p>`;
    }
    if (visual) h += `<h3>Recorte</h3>${range('crop.0', 'Izquierda', 0, 0.9, 0.005, 'pct')}${range('crop.2', 'Derecha', 0, 0.9, 0.005, 'pct')}${range('crop.1', 'Arriba', 0, 0.9, 0.005, 'pct')}${range('crop.3', 'Abajo', 0, 0.9, 0.005, 'pct')}${c.crop?.some(v => v > 0) ? acts(['cropReset', 'Sin recorte']) : ''}`;
    if (!isImg) h += c.ramp
      ? `<h3>Velocidad</h3>${range('ramp.a', 'Empieza a', 0.25, 4, 0.05, 'x')}${range('ramp.b', 'Termina a', 0.25, 4, 0.05, 'x')}<p class="hint">Rampa: acelera o frena a lo largo del clip. El sonido acompaña el cambio (cambia el tono).</p>${acts(['rampOff', 'Velocidad fija'])}`
      : `<h3>Velocidad</h3>${range('speed', 'Velocidad', 0.25, 4, 0.05, 'x')}<p class="hint">La voz mantiene su tono. Lo que sigue en la pista se corre solo.</p>${acts(['rampOn', 'Hacer una rampa'])}`;
    const others = P.tracks.flatMap(x => x.clips.filter(o => o !== c && x !== t && o.media && media.get(o.media)?.hasAudio));
    if (!isImg && others.length) h += `<h3>Multicámara</h3><label>Sincronizar por el sonido con<select id="syncWith">${others.map(o => `<option value="${o.id}">${esc(media.get(o.media).name)} (${fmt(o.start)})</option>`).join('')}</select></label>${acts(['sync', 'Sincronizar'])}`;
    h += `<h3>Tiempo</h3><div class="two">${num('start', 'Empieza (s)', 0, 0.1)}${isImg ? num('out', 'Dura (s)', MIN, 0.1) : `<label>Dura<input type="text" value="${len(c).toFixed(2)} s" readonly></label>`}</div>`;
  }
  if (f) h += '<div class="foot"></div>' + acts(['copyA', 'Copiar ajustes'], ['pasteA', 'Pegar ajustes'])
    + (t.kind === 'video' && m?.type === 'video' ? acts(...[['freeze', 'Congelar cuadro'], !c.mute && m.hasAudio ? ['detach', 'Separar audio'] : null].filter(Boolean)) : '')
    + acts(['split', 'Dividir'], ['dup', 'Duplicar'], ['del', 'Borrar']);
  if (multi.size > 1) h = `<p class="hint msel">${multi.size} clips elegidos. Lo de abajo cambia solo el último que tocaste; «Pegar ajustes» y Borrar van para todos.</p>` + h;
  $('props').innerHTML = h;
  sectionize();
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
  let v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' || k === 'weight' || k === 'endCard.sec' ? +el.value : el.value;
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
  if (k.startsWith('ramp.') && f) { const old = end(o); o.ramp = { ...o.ramp, [k[5]]: clamp(v, 0.25, 4) }; shiftAfter(f.t, o, old); showOut(el); dirty = true; renderTimeline(); return; }
  if (k.startsWith('crop.') && f) { o.crop = o.crop ? [...o.crop] : [0, 0, 0, 0]; o.crop[+k[5]] = v; if (o.crop[0] + o.crop[2] > 0.95 || o.crop[1] + o.crop[3] > 0.95) o.crop[+k[5]] -= 0.05; showOut(el); dirty = true; return; }
  if (k === 'voz.p') { // al cambiar de perfil, los controles vuelven a los valores del perfil
    if (!v) o.voz = null;
    else { const pr = Voz.PROFILES[v]; o.voz = { ...o.voz, p: v, noise: pr.noise, clarity: pr.pres, level: 0.5 }; }
  } else setK(o, k, v);
  if (k === 'progress.on' && v) P.progress.color ??= '#ff5a1f';
  if (k === 'endCard.on' && v) P.endCard = { sec: 3, text: brand().handle ? 'Seguinos en ' + brand().handle : '', color: brand().color || '#ff5a1f', ...P.endCard };
  if (k === 'start' && f) fitFree(f.t, o);
  if (k === 'aspect') sizeStage();
  showOut(el); dirty = true;
  if (['text', 'start', 'out'].includes(k)) renderTimeline();
});
$('props').addEventListener('change', e => {
  const ml = e.target.dataset.mlabel;
  if (ml !== undefined) { const m = P.markers[+ml]; if (m) edit(() => { m.label = e.target.value.trim(); }); return; }
  if (e.target.dataset.boxp !== undefined) { const c = find(sel)?.c; if (c) edit(() => { c.box = BOXES[e.target.value].v; }); return; }
  const look = e.target.dataset.look !== undefined && LOOKS[e.target.value];
  if (look) { const c = find(sel)?.c; if (c) edit(() => Object.assign(c, look)); return; }
  if (!pending) return;
  const s = pending; pending = null;
  if (remember(s)) changed();
  else if (['box', 'tr', 'voz.p', 'fit', 'lut', 'progress.on', 'endCard.on'].includes(e.target.dataset.k)) renderProps();
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
  const mk = e.target.closest('[data-mgo],[data-mdel]');
  if (mk) {
    if (mk.dataset.mgo !== undefined) seek(P.markers[+mk.dataset.mgo]?.t ?? T);
    else edit(() => P.markers.splice(+mk.dataset.mdel, 1));
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
    rampOn() { const c = f.c, old = end(c); edit(() => { c.ramp = { a: sp(c), b: Math.min(4, sp(c) * 2) }; shiftAfter(f.t, c, old); }); },
    rampOff() { const c = f.c, old = end(c); edit(() => { c.speed = sp(c); c.ramp = null; shiftAfter(f.t, c, old); }); },
    cropReset() { edit(() => { f.c.crop = null; }); },
    colorPage: () => setPage('color'),
    autoMix, ytCh: chapters, keys: () => $('keys').showModal(),
    endLogo: () => logoFile.click(),
    endLogoOff() { edit(() => { P.endCard.logo = null; }); },
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

// Logo de la placa final: se guarda con los archivos del proyecto
const logoFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(logoFile);
logoFile.onchange = async () => {
  const fl = logoFile.files[0]; logoFile.value = '';
  if (!fl) return;
  try { const rec = await importOne(fl, 'image'); edit(() => { P.endCard = { ...P.endCard, logo: rec.id }; }); renderBin(); say('Logo de la placa final listo.'); }
  catch (e) { say(e.message || 'No se pudo abrir esa imagen.'); }
};

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
  // con 4 minutos alcanza para medir el nivel y el ruido (en videos largos se toma la parte del medio: así tarda segundos, no minutos)
  let a = Math.min(...used.map(c => c.in)), b = Math.max(...used.map(c => c.out));
  if (b - a > 240) { a += (b - a - 240) / 2; b = a + 240; }
  const r = await Voz.analyze(M, at, a, b, p => { const t = `Analizando la voz… ${Math.round(p * 100)} %`; say(t + ` («${m.name}»)`); for (const x of $('props').querySelectorAll('[data-act=voz],[data-act=vozEvery]')) { x.disabled = true; x.lastChild.textContent = t; } });
  levels.set(m.id, r);
  return r;
}
async function improve(list) {
  if (needPro('Mejorar voz')) return;
  if (improving) return say('Ya se está analizando la voz, esperá un momento.');
  improving = true;
  try {
    const res = new Map();
    for (const c of list) if (!res.has(c.media) && media.has(c.media)) res.set(c.media, await levelOf(media.get(c.media)));
    const pr = Voz.PROFILES.entrevista;
    edit(() => { for (const c of list) { const r = res.get(c.media); c.voz = { p: 'entrevista', noise: pr.noise, clarity: pr.pres, level: 0.5, hum: true, gain: r?.gain ?? 0, floor: r?.floor ?? -60 }; } });
    const r = [...res.values()][0];
    say(`Voz mejorada${r ? ` (${r.gain >= 0 ? 'se subió' : 'se bajó'} ${Math.abs(r.gain).toFixed(1)} dB para emparejarla)` : ''}. Tocá play y compará con «Escuchar original» en la sección Voz.`);
  } catch (e) { say('No se pudo analizar el audio: ' + (e.message || e)); }
  finally { improving = false; renderProps(); }
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
    // velocidad fija: más rápido o lento sin cambiar el tono; con rampa, el sonido acompaña la aceleración (cambia el tono)
    const [l, r] = c.ramp ? [buf.getChannelData(0), buf.getChannelData(1)] : Smart.stretch([buf.getChannelData(0), buf.getChannelData(1)], sp(c), RATE);
    return { t0: a0, l, r };
  }
  async mix(L, R, s0, n) {
    const c = this.c;
    for (let i = 0; i < n; i++) {
      const tt = (s0 + i) / RATE;
      if (tt < c.start || tt >= end(c)) continue;
      const src = srcAt(c, tt), k = Math.floor((src - c.in) / CH);
      if (k !== this.k) { this.cur = await this.chunk(k); this.k = k; }
      const j = Math.round((src - this.cur.t0) / (c.ramp ? 1 : sp(c)) * RATE);
      if (j < 0 || j >= this.cur.l.length) continue;
      const g = (c.kf?.vol ? valAt(c, 'vol', tt - c.start) : c.vol) * fadeGain(c, tt - c.start);
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
  const outName = safeName() + (preset?.suffix || '');
  const kind = $('xKind').value, video = kind === 'video', codec = $('xCodec').value, mp4 = codec !== 'vp9';
  if (kind === 'srt' || kind === 'vtt') return exportSubs(kind);
  const ext = !video ? '.wav' : mp4 ? '.mp4' : '.webm', mime = !video ? 'audio/wav' : mp4 ? 'video/mp4' : 'video/webm';
  let writable = preset?.writable || null;
  if (!preset) try { writable = await pickTarget(outName, ext, mime); } catch (e) { if (e.name === 'AbortError') return; writable = null; }
  pause();
  job.cancel = false;
  $('xGo').disabled = $('xClose').disabled = true; $('xStop').hidden = false; $('xProg').hidden = false; $('xProg').value = 0;
  const msg = t => { $('xMsg').textContent = t; }, wasOff = colorOff;
  colorOff = false; // el video sale siempre con el color corregido
  try {
    await fontsReady;
    const lg = P.endCard?.on && media.get(P.endCard.logo);
    if (lg) { bitmapOf(lg); await lg.loading; }
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
      if (writable) { await writable.write(blob); await writable.close(); } else download(blob, outName + '.wav');
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
        if (s) frames.set(c.id, { w: s.displayWidth, h: s.displayHeight, paint: (gg, ...r) => s.draw(gg, ...r) });
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
    if (!writable) download(new Blob([target.buffer], { type: mime }), outName + ext);
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
$('play').onclick = toggle; $('split').onclick = split; $('dup').onclick = duplicate; $('del').onclick = () => remove(); $('detach').onclick = detach;
$('rippleDel').onclick = ripple; $('extract').onclick = extract; $('lift').onclick = lift;
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
  $('leftTitle').textContent = $(a).title; $('importBtn2').hidden = a !== 'tabFiles';
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
  if (page === 'color' && !mod && ['delete', 'backspace', 's', 'd', 'b', 'i', 'o'].includes(k)) return; // en Color no se corta ni se borra
  if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
  else if (e.key === '?' || (!mod && k === 'f1')) { e.preventDefault(); $('keys').showModal(); }
  else if (!mod && !e.altKey && k === 'l') shuttle(1);
  else if (!mod && !e.altKey && k === 'j') shuttle(-1);
  else if (!mod && !e.altKey && k === 'k') pause();
  else if (k === 'contextmenu' || (e.shiftKey && k === 'f10')) { const c = e.target.closest?.('.clip'); if (c) { e.preventDefault(); const r = c.getBoundingClientRect(); openCtx(r.left + 20, r.bottom - 4, c); } }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.altKey && k === 'c') { e.preventDefault(); copyAttrs(); }
  else if (mod && e.altKey && k === 'v') { e.preventDefault(); pasteAttrs(); }
  else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
  else if (!mod && e.shiftKey && k === 'f') freeze();
  else if (mod && k === 'a') { e.preventDefault(); multi.clear(); for (const t of P.tracks) for (const c of t.clips) multi.add(c.id); sel = [...multi].at(-1) ?? null; if (multi.size <= 1) multi.clear(); renderTimeline(); renderProps(); }
  else if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod) return;
  else if (k === 's') e.shiftKey ? splitAll() : split();
  else if (e.altKey && k === 'x') { e.preventDefault(); clearIO(); }
  else if (k === 'i') mark('i');
  else if (k === 'o') mark('o');
  else if (k === 'm') toggleMarker();
  else if (k === 'r') voiceOver();
  else if (P.mc && /^(Digit|Numpad)[1-9]$/.test(e.code)) { e.preventDefault(); if (!mcOpen) mcShow(true); mcSwitch(+e.code.slice(-1) - 1, e.shiftKey); }
  else if (k === 'arrowup' || k === 'arrowdown') { e.preventDefault(); jump(e.shiftKey ? (P.markers || []).map(m => m.t) : editPts(), k === 'arrowdown' ? 1 : -1); }
  else if (k === 'v') setTool('select');
  else if (k === 'b') setTool('blade');
  else if (k === 'n') $('snapBtn').click();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(e.shiftKey); }
  else if (e.altKey && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); moveSel(k === 'arrowleft' ? -step * 3 : step * 3); }
  else if (k === 'arrowleft') { e.preventDefault(); seek(T - step); }
  else if (k === 'arrowright') { e.preventDefault(); seek(T + step); }
  else if (k === 'home') seek(0);
  else if (k === 'end') seek(dur());
  else if (k === '+' || k === '=') setPps(pps * 1.3);
  else if (k === '-') setPps(pps / 1.3);
  else if (k === 'escape') { if (rev) shuttleStop(); else if (tool === 'blade') setTool('select'); else if (sel || multi.size) { sel = null; multi.clear(); renderTimeline(); renderProps(); } }
});

// ---------- IA: muletillas y palabras repetidas ----------
let fillMarks = [];
const normW = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const mergeR = rs => rs.sort((a, b) => a[0] - b[0]).reduce((o, r) => { const l = o.at(-1); if (l && r[0] <= l[1] + 0.01) l[1] = Math.max(l[1], r[1]); else o.push([...r]); return o; }, []);
$('fillFind').onclick = () => {
  const ws = wordList();
  if (!ws.length) return say('Primero generá los subtítulos: las muletillas se buscan en lo que se dice.');
  const phrases = $('fillWords').value.split(',').map(x => x.trim().split(/\s+/).map(normW).filter(Boolean)).filter(x => x.length);
  const hits = [];
  for (let i = 0; i < ws.length; i++) {
    const ph = phrases.find(p => p.every((x, k) => normW(ws[i + k]?.w || '') === x));
    if (ph) hits.push([i, i + ph.length - 1]);
    else if ($('fillRep').checked && i > 0 && normW(ws[i].w) && normW(ws[i].w) === normW(ws[i - 1].w) && ws[i].a - ws[i - 1].b < 0.6) hits.push([i - 1, i - 1]); // «que que»: sale la primera
  }
  // se corta solo la palabra (con un respiro de 40 ms), sin comerse las de al lado
  fillMarks = mergeR(hits.map(([i, j]) => [Math.max(ws[i - 1]?.b ?? 0, ws[i].a - 0.04), Math.min(ws[j + 1]?.a ?? ws[j].b + 0.1, ws[j].b + 0.04)]).filter(([a, b]) => b - a > 0.05));
  const tot = fillMarks.reduce((s, [a, b]) => s + b - a, 0);
  $('fillInfo').textContent = fillMarks.length ? `Encontré ${fillMarks.length} (${tot.toFixed(1)} s). Están en violeta arriba de la línea de tiempo: revisalas antes de quitarlas.` : 'No encontré muletillas con esa lista.';
  $('fillCut').disabled = !fillMarks.length; say($('fillInfo').textContent); renderTimeline();
};
$('fillCut').onclick = () => {
  const marks = fillMarks, n = marks.length;
  edit(() => { for (const [a, b] of [...marks].reverse()) cutRange(a, b); });
  say(`Listo: saqué ${n} muletillas. Si algo quedó raro, deshacé con Ctrl+Z.`);
};

// ---------- IA: multicámara automática (cambia de plano según quién habla) ----------
$('mcMinO').textContent = (+$('mcMin').value).toFixed(1) + ' s';
$('mcMin').oninput = () => { $('mcMinO').textContent = (+$('mcMin').value).toFixed(1) + ' s'; };
$('mcGo').onclick = async () => {
  if (needPro('La multicámara automática')) return;
  const cams = camTracks().filter(t => camClips(t).some(c => media.get(c.media)?.hasAudio));
  if (cams.length < 2) return say('Poné cada cámara en su pista de video, con su sonido y sincronizadas (Inspector → Multicámara), y probá de nuevo.');
  const all = cams.flatMap(camClips), A = Math.min(...all.map(c => c.start)), B = Math.max(...all.map(end)), N = Math.ceil((B - A) * 50);
  $('mcGo').disabled = true;
  try {
    const M = await mb(), env = [];
    for (const [k, t] of cams.entries()) {
      const e = new Float32Array(N);
      for (const c of camClips(t)) {
        const m = media.get(c.media);
        if (m?.type !== 'video' || !m.hasAudio) continue;
        say(`Escuchando la cámara ${k + 1} de ${cams.length}…`);
        const at = await trackOf(M, m, 'audio');
        if (!at) continue;
        const x = await Smart.envelope(M, at, c.in, c.out - c.in), o = Math.round((c.start - A) * 50), s = sp(c);
        for (let i = 0; i < len(c) * 50 && o + i < N; i++) { const j = Math.floor(i * s); if (j < x.length && o + i >= 0) e[o + i] = x[j]; }
      }
      env.push(e);
    }
    const plan = Smart.camPlan(env, { min: +$('mcMin').value, wide: $('mcWide').checked ? cams.length - 1 : -1 });
    edit(() => {
      const mc = P.mc && P.mc.cams.length === cams.length ? P.mc : mcEnter(cams);
      mc.cuts = plan.map(([a, , k]) => [A + a, mc.cams.indexOf(cams[k].id)]);
      mcBuild(); sel = null; multi.clear();
    });
    mcShow(true);
    say(`Listo: ${plan.length} planos, con al menos ${(+$('mcMin').value).toFixed(1)} s cada uno. Retocá con la barra de cámaras: tocá una (o 1, 2, 3…) donde quieras cambiar.`);
  } catch (e) { say('No se pudo armar la multicámara: ' + (e.message || e)); }
  finally { inputs.clear(); $('mcGo').disabled = false; }
};

// ---------- Multicámara a mano: las cámaras en una barra; tocás una (o 1, 2, 3…) y desde ahí se ve esa ----------
// P.mc = { cams: [ids de pista, de arriba hacia abajo], src: { id: clips originales }, cuts: [[segundo, cámara]] }.
// Las pistas de cámara se arman solas a partir de los cortes (no se pierde nada: los clips originales quedan guardados).
let mcOpen = false;
const tileEls = new Map();
const camTracks = () => P.mc ? P.mc.cams.map(id => P.tracks.find(t => t.id === id)).filter(Boolean) : tracks('video').filter(t => !t.hidden && t.clips.some(c => media.get(c.media)?.type === 'video'));
const camClips = t => P.mc?.src[t.id] || t.clips;
function mcEnter(cams) {
  // el sonido de cada cámara pasa a su pista de audio: así no se corta al cambiar de plano
  cams.forEach((t, k) => { for (const c of t.clips) if (!c.mute && media.get(c.media)?.hasAudio) detachClip(c, `Sonido cámara ${k + 1}`); });
  P.mc = { cams: cams.map(t => t.id), src: Object.fromEntries(cams.map(t => [t.id, structuredClone(t.clips)])), cuts: [] };
  return P.mc;
}
function mcBuild() {
  const mc = P.mc, tr = mc.cams.map(id => P.tracks.find(t => t.id === id));
  if (tr.some(t => !t)) { P.mc = null; return; } // se borró una pista de cámara: queda como está
  const cuts = [];
  for (const c of mc.cuts.sort((a, b) => a[0] - b[0])) if (c[1] !== (cuts.at(-1)?.[1] ?? 0) && c[1] < tr.length) cuts.push(c);
  mc.cuts = cuts;
  tr.forEach((t, i) => { t.clips = structuredClone(mc.src[mc.cams[i]]); });
  // en cada tramo se sacan las cámaras que están arriba de la elegida
  cuts.forEach(([a, k], j) => { const b = cuts[j + 1]?.[0] ?? 1e6; for (let i = 0; i < k; i++) cutRange(a, b, false, [tr[i]]); });
}
const mcActive = () => P.mc?.cuts.filter(([x]) => x <= T + 1e-3).at(-1)?.[1] ?? 0;
function mcSwitch(k, whole = false) {
  const mc = P.mc;
  if (!mc || k >= mc.cams.length) return;
  edit(() => {
    // con Shift (o con el video en pausa y «toda la toma»): cambia la toma entera donde está el cursor
    const t = whole ? mc.cuts.filter(([x]) => x <= T + 1e-3).at(-1)?.[0] ?? 0 : T;
    mc.cuts = mc.cuts.filter(([x]) => Math.abs(x - t) > 0.04);
    mc.cuts.push([t, k]); mcBuild();
  });
  say(`Cámara ${k + 1} desde ${tc(whole ? (mc.cuts.find(c => c[1] === k && c[0] <= T + 1e-3)?.[0] ?? 0) : T)}.`);
}
function mcToggle() {
  if (P.mc) return mcShow(!mcOpen);
  const cams = camTracks();
  if (cams.length < 2) return say('Para la multicámara poné cada toma en su propia pista de video (una arriba de la otra), al mismo tiempo. Si son de cámaras distintas, sincronizalas por el sonido (Inspector → Multicámara).');
  edit(() => mcEnter(cams));
  mcShow(true);
  say('Multicámara lista: reproducí y tocá la cámara que querés ver (o las teclas 1, 2, 3…). Con Shift cambiás la toma entera.');
}
function mcShow(on) {
  mcOpen = on && !!P.mc;
  $('mcBar').hidden = !mcOpen; $('mcBtn').setAttribute('aria-pressed', mcOpen);
  if (!mcOpen) { for (const v of tileEls.values()) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } tileEls.clear(); }
  renderMc(); sizeStage();
}
function renderMc() {
  if (!mcOpen || !P.mc) return;
  const tr = camTracks();
  $('mcTiles').replaceChildren(...tr.map((t, k) => {
    const b = document.createElement('button'), m = media.get(camClips(t)[0]?.media);
    b.type = 'button'; b.dataset.cam = k;
    b.setAttribute('aria-label', `Cámara ${k + 1}: ${t.name}${m ? ', ' + m.name : ''} (tecla ${k + 1})`);
    b.innerHTML = `<canvas width="192" height="108"></canvas><span>${k + 1}</span><small>${esc(t.name)}</small>`;
    return b;
  }));
  dirty = true;
}
$('mcTiles').onclick = e => { const b = e.target.closest('[data-cam]'); if (b) mcSwitch(+b.dataset.cam, e.shiftKey); };
$('mcBtn').onclick = mcToggle;
$('keysBtn').onclick = () => $('keys').showModal();
$('mcHide').onclick = () => mcShow(false);
$('mcEnd').onclick = () => {
  edit(() => { P.mc = null; });
  mcShow(false);
  say('Multicámara terminada: las pistas quedan como están y ya se pueden retocar a mano.');
};
function drawTiles() {
  if (!mcOpen || !P.mc) return;
  const act = mcActive();
  camTracks().forEach((t, k) => {
    const b = $('mcTiles').querySelector(`[data-cam="${k}"]`), cv = b?.firstElementChild;
    if (!cv) return;
    b.setAttribute('aria-pressed', k === act);
    const g = cv.getContext('2d'), c = camClips(t).find(x => T >= x.start && T < end(x)), m = c && media.get(c.media);
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    let src = null, w = 0, h = 0;
    if (m?.type === 'video') {
      let v = tileEls.get(k);
      if (!v) { v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' }); v.onseeked = v.onloadeddata = () => { dirty = true; }; $('pool').append(v); tileEls.set(k, v); }
      if (v.dataset.m !== m.id) { v.dataset.m = m.id; v.src = m.url; }
      const want = srcAt(c, T);
      if (playing) { v.playbackRate = sp(c) * rate; if (v.paused) { v.currentTime = want; v.play().catch(() => {}); } else if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want; }
      else { if (!v.paused) v.pause(); if (!v.seeking && Math.abs(v.currentTime - want) > 0.05) v.currentTime = want; }
      if (v.readyState >= 2) { src = v; w = v.videoWidth; h = v.videoHeight; }
    } else if (m?.type === 'image') { src = bitmapOf(m); w = src?.width; h = src?.height; }
    else { tileEls.get(k)?.pause(); }
    if (src && w) { const s = Math.max(cv.width / w, cv.height / h); g.drawImage(src, (cv.width - w * s) / 2, (cv.height - h * s) / 2, w * s, h * s); }
    else { g.fillStyle = '#666'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText('Sin imagen acá', cv.width / 2, cv.height / 2 + 5); }
  });
}

// ---------- Voz en off: graba del micrófono mientras se reproduce el proyecto ----------
let rec = null;
async function voiceOver() {
  if (rec) { if (rec.state === 'recording') rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return say('Este navegador no puede grabar del micrófono.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }); }
  catch { return say('No se pudo usar el micrófono: dale permiso al navegador (el candado al lado de la dirección).'); }
  const mr = new MediaRecorder(stream), parts = [], at = T;
  rec = mr;
  mr.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    rec = null; $('tRec').setAttribute('aria-pressed', 'false'); $('tRec').classList.remove('rec');
    if (playing) pause();
    const type = (mr.mimeType || 'audio/webm').split(';')[0], ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(parts, { type });
    if (blob.size < 2000) return say('La grabación quedó vacía.');
    try {
      const r = await importOne(new File([blob], `Voz en off ${fmt(at).replace(':', '.')}.${ext}`, { type }), 'audio');
      edit(() => { const t = namedTrack('audio', 'Voz en off'), c = { ...DEF.audio, id: S.uid(), media: r.id, start: at, in: 0, out: r.duration }; t.clips.push(c); fitFree(t, c); sel = c.id; });
      say(`Voz en off grabada (${fmt(r.duration)}) en la pista «Voz en off».`);
    } catch (e) { say(e.message || 'No se pudo guardar la grabación.'); }
  };
  mr.start(250);
  $('tRec').setAttribute('aria-pressed', 'true'); $('tRec').classList.add('rec');
  if (dur() && !playing) play();
  say('Grabando… Hablá con auriculares puestos. Tocá ● o Espacio para terminar.');
}
$('tRec').onclick = voiceOver;

// ---------- Mezcla automática: voces al mismo nivel y música por debajo ----------
async function autoMix() {
  const items = soundClips(), music = items.filter(x => x.c.duck || /m[uú]sica/i.test(find(x.c.id)?.t.name || '')), voices = items.filter(x => !music.includes(x));
  if (!items.length) return say('No hay sonido en el proyecto.');
  try {
    const lv = new Map();
    for (const { m } of items) if (!lv.has(m.id)) lv.set(m.id, await levelOf(m));
    edit(() => {
      for (const { c, m } of voices) { const r = lv.get(m.id); if (r && !c.voz?.p) c.vol = +clamp(10 ** (r.gain / 20), 0.25, 2).toFixed(2); }
      // la música, 16 dB debajo de la voz y bajando cuando hablan
      for (const { c, m } of music) { const r = lv.get(m.id); c.vol = +clamp(10 ** (((r?.gain ?? 0) - 16) / 20), 0.03, 1).toFixed(2); c.duck = true; }
    });
    say(`Mezcla lista: ${voices.length} voz/voces emparejadas${music.length ? ` y ${music.length} música(s) por debajo, bajando cuando hablan` : ''}.`);
  } catch (e) { say('No se pudo medir el audio: ' + (e.message || e)); }
}

// ---------- Capítulos de YouTube desde los marcadores ----------
function chapters() {
  const ts = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const l = (P.markers || []).filter(m => m.t < dur()).map(m => ({ t: m.t, l: m.label || 'Capítulo' }));
  if (!l.length || l[0].t >= 1) l.unshift({ t: 0, l: 'Inicio' }); else l[0].t = 0;
  const txt = l.map(x => `${ts(x.t)} ${x.l}`).join('\n'), warn = [];
  if (l.length < 3) warn.push('YouTube pide al menos 3 capítulos');
  if (l.some((x, i) => (l[i + 1]?.t ?? dur()) - x.t < 10)) warn.push('cada capítulo tiene que durar 10 s o más');
  navigator.clipboard?.writeText(txt).then(() => say(`Capítulos copiados: pegalos en la descripción de YouTube.${warn.length ? ' Ojo: ' + warn.join(' y ') + '.' : ''}`), () => say(txt));
}

// ---------- Exportar en varios formatos ----------
const FMTS = { '9:16': 'vertical', '16:9': 'horizontal', '1:1': 'cuadrado', '4:5': 'retrato' };
function renderFmts() {
  $('xFmts').innerHTML = Object.entries(FMTS).map(([a, n]) => `<label class="check"><input type="checkbox" value="${a}"${a === P.aspect ? ' checked' : ''}> ${a} ${n}</label>`).join('');
}
$('xFmtBox').addEventListener('toggle', () => { if ($('xFmtBox').open) renderFmts(); });
$('xFmtGo').onclick = async () => {
  const list = [...$('xFmts').querySelectorAll('input:checked')].map(i => i.value);
  if (!list.length) return ($('xMsg').textContent = 'Elegí al menos un formato.');
  $('xKind').value = 'video';
  let dir = null;
  if (window.showDirectoryPicker) { try { dir = await showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; } }
  const back = P.aspect, ext = $('xCodec').value === 'vp9' ? '.webm' : '.mp4', done = [];
  job.cancel = false;
  try {
    for (const a of list) {
      if (job.cancel) break;
      P.aspect = a; sizeStage();
      const suffix = ` (${a.replace(':', 'x')} ${FMTS[a]})`;
      let writable = null;
      if (dir) writable = await (await dir.getFileHandle(safeName() + suffix + ext, { create: true })).createWritable();
      await runExport({ writable, suffix });
      done.push(a);
    }
  } finally { P.aspect = back; sizeStage(); dirty = true; }
  $('xMsg').textContent = `Listo: ${done.length} formato(s) exportados${dir ? ' en la carpeta elegida' : ''} (${done.join(', ')}). Revisá que los textos y encuadres queden bien en cada uno.`;
};

// ---------- Menú del clic derecho en la línea de tiempo ----------
const CLIP_COLORS = [['', 'Por tipo'], ['#c0392b', 'Rojo'], ['#d35400', 'Naranja'], ['#b7950b', 'Amarillo'], ['#1e8449', 'Verde'], ['#148f77', 'Turquesa'], ['#2e86c1', 'Azul'], ['#7d3c98', 'Violeta'], ['#7b7d7d', 'Gris']];
function openCtx(x, y, clipEl) {
  const f = clipEl && find(clipEl.dataset.id), t0 = clipEl ? null : clamp(timeAt(x), 0, Math.max(dur(), 0));
  if (f && !isSel(f.c.id)) { sel = f.c.id; multi.clear(); renderTimeline(); renderProps(); }
  const isV = f?.t.kind === 'video' && media.get(f.c.media)?.type === 'video', n = picked().length;
  const items = f ? [
    ['split', 'Dividir en el cursor', 'S', T > f.c.start && T < end(f.c)],
    ['dup', 'Duplicar', 'Ctrl+D', n === 1],
    ['del', n > 1 ? `Borrar ${n} clips` : 'Borrar', 'Supr'],
    ['ripple', 'Borrar y cerrar el hueco', 'Shift+Supr'],
    '-',
    ['copyA', 'Copiar ajustes', 'Ctrl+Alt+C', n === 1],
    ['pasteA', 'Pegar ajustes', 'Ctrl+Alt+V', !!clipboard],
    '-',
    ['detach', 'Separar el audio', '', isV && !f.c.mute && media.get(f.c.media)?.hasAudio],
    ['freeze', 'Congelar este cuadro', 'Shift+F', isV && T > f.c.start && T < end(f.c)],
    ...(f.t.kind !== 'text' && !f.c.sub ? [['sp0.5', 'Velocidad 0,5×'], ['sp1', 'Velocidad normal'], ['sp2', 'Velocidad 2×']] : []),
    '-', 'colors'
  ] : [
    ['seekHere', 'Llevar el cursor acá'],
    ['markHere', 'Poner un marcador acá', 'M'],
    ['splitAll', 'Dividir todas las pistas en el cursor', 'Shift+S'],
    ['pasteA', 'Pegar ajustes en lo elegido', 'Ctrl+Alt+V', !!clipboard && n > 0]
  ];
  const m = $('ctx');
  m.innerHTML = items.map(it => it === '-' ? '<hr>' : it === 'colors'
    ? `<div class="sw" role="group" aria-label="Color del clip">${CLIP_COLORS.map(([c, l]) => `<button type="button" role="menuitem" data-lc="${c}" title="${l}" aria-label="Color del clip: ${l}" style="--sw:${c || 'var(--kc0)'}"></button>`).join('')}</div>`
    : `<button type="button" role="menuitem" data-c="${it[0]}"${it[3] === false ? ' disabled' : ''}><span>${it[1]}</span><kbd>${it[2] || ''}</kbd></button>`).join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  m.dataset.t = t0 ?? '';
  ctxReturn = document.activeElement;
  m.querySelector('button:not(:disabled)')?.focus();
}
let ctxReturn = null;
const closeCtx = () => { if ($('ctx').hidden) return; $('ctx').hidden = true; ctxReturn?.focus?.({ preventScroll: true }); };
tlIn.addEventListener('contextmenu', e => {
  const c = e.target.closest('.clip');
  if (!c && !e.target.closest('.lane, #ruler')) return;
  e.preventDefault(); openCtx(e.clientX, e.clientY, c);
});
$('ctx').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const m = $('ctx'), at = m.dataset.t === '' ? null : +m.dataset.t;
  closeCtx();
  if (b.dataset.lc !== undefined) return edit(() => { for (const { c } of picked()) c.lc = b.dataset.lc || null; });
  const sp = b.dataset.c.match(/^sp([\d.]+)$/);
  if (sp) return edit(() => { for (const { c, t } of picked()) if (t.kind !== 'text') { const old = end(c); c.ramp = null; c.speed = +sp[1]; shiftAfter(t, c, old); } });
  ({ split, dup: duplicate, del: () => remove(), ripple, copyA: copyAttrs, pasteA: pasteAttrs, detach, freeze, splitAll,
    seekHere: () => seek(at), markHere: () => { seek(at); toggleMarker(); } })[b.dataset.c]?.();
});
$('ctx').addEventListener('keydown', e => {
  const bs = [...$('ctx').querySelectorAll('button:not(:disabled)')], i = bs.indexOf(document.activeElement);
  if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeCtx(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
  e.stopPropagation();
});
addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) closeCtx(); }, true);
addEventListener('blur', closeCtx);

// ---------- Números que se arrastran: sobre el valor, arrastrar cambia; clic para escribirlo ----------
// Sirve para todos los controles con barra (inspector, página de Color). Shift: más rápido; Alt: más fino.
const rangeOf = o => o.closest('label')?.querySelector('input[type=range]');
const fire = (el, ev) => el.dispatchEvent(new Event(ev, { bubbles: true }));
let nDrag = null;
document.addEventListener('pointerdown', e => {
  const o = e.target.closest('label output'), r = o && rangeOf(o);
  if (!r || o.isContentEditable || r.disabled || e.button !== 0) return;
  nDrag = { o, r, x0: e.clientX, v0: +r.value, moved: false };
  o.setPointerCapture(e.pointerId); e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!nDrag) return;
  const { o, r, x0, v0 } = nDrag, dx = e.clientX - x0;
  if (!nDrag.moved && Math.abs(dx) < 3) return;
  nDrag.moved = true;
  const st = +r.step || 0.01, k = e.shiftKey ? 5 : e.altKey ? 0.2 : 1, span = (+r.max - +r.min) || 1;
  r.value = clamp(v0 + dx * Math.max(st, span / 250) * k, +r.min, +r.max); // unos 250 px recorren todo el rango
  fire(r, 'input');
  if (!o.textContent) o.textContent = r.value;
});
document.addEventListener('pointerup', () => {
  if (!nDrag) return;
  const { o, r, moved } = nDrag; nDrag = null;
  if (moved) return fire(r, 'change');
  o.dataset.old = o.textContent; o.contentEditable = 'plaintext-only'; o.focus();
  getSelection().selectAllChildren(o);
});
document.addEventListener('keydown', e => {
  const o = e.target.closest?.('label output[contenteditable]');
  if (!o) return;
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); o.blur(); }
  else if (e.key === 'Escape') { o.textContent = o.dataset.old; o.dataset.cancel = '1'; o.blur(); }
}, true);
document.addEventListener('focusout', e => {
  const o = e.target.closest?.('label output[contenteditable]'), r = o && rangeOf(o);
  if (!r) return;
  o.removeAttribute('contenteditable');
  if (o.dataset.cancel) { delete o.dataset.cancel; return; }
  // se escribe como se ve: 50 (o 50 %) es 0,5 si el control muestra porcentaje
  let v = parseFloat(o.textContent.replace(',', '.').replace(/[^\d.+-]/g, ''));
  if (!isFinite(v)) { o.textContent = o.dataset.old; return; }
  if (r.dataset.f === 'pct') v /= 100;
  r.value = clamp(v, +r.min, +r.max); fire(r, 'input'); fire(r, 'change');
});


// ---------- Volumen de lo que escuchás (solo la vista previa: no cambia el video exportado) ----------
let mon = { v: 1, mute: false };
try { mon = { ...mon, ...JSON.parse(localStorage.getItem('clipcreate.editor.monitor') || '{}') }; } catch {}
function monVol() { return mon.mute ? 0 : mon.v; }
function monShow() {
  $('monVol').value = mon.v; $('monMute').setAttribute('aria-pressed', mon.mute);
  $('monMute').innerHTML = `<svg class="i"><use href="#i-${mon.mute || !mon.v ? 'mute' : 'vol'}"/></svg>`;
  $('monVol').setAttribute('aria-valuetext', mon.mute ? 'Silenciado' : Math.round(mon.v * 100) + ' %');
  if (master) master.gain.setTargetAtTime(monVol(), actx.currentTime, 0.02);
  try { localStorage.setItem('clipcreate.editor.monitor', JSON.stringify(mon)); } catch {}
}
$('monVol').oninput = () => { mon.v = +$('monVol').value; mon.mute = false; monShow(); };
$('monMute').onclick = () => { mon.mute = !mon.mute; monShow(); };
monShow();

// ---------- Transiciones: tocá una para ponerla en el corte más cercano al cursor, o arrastrala a un clip ----------
function applyTr(kind, f = null) {
  if (!f) { // el corte más cercano al cursor (un clip que empieza justo donde termina otro)
    const all = tracks('video').flatMap(t => t.clips.map(c => ({ c, t })));
    const cuts = all.filter(({ c, t }) => prevOf(t, c));
    const pool = cuts.length ? cuts : (NEEDS_PREV.has(kind) ? [] : all);
    f = pool.sort((a, b) => Math.abs(a.c.start - T) - Math.abs(b.c.start - T))[0];
    if (!f) return say('Para una transición hace falta un corte entre dos clips: poné el cursor donde querés cambiar y tocá S (Dividir).');
  }
  const { c, t } = f;
  edit(() => { c.tr = kind; c.trD = Math.min(c.trD || 0.5, len(c) / 2); sel = c.id; multi.clear(); });
  seek(Math.max(0, c.start - 0.8));
  say(`Transición «${TRANS[kind]}» en ${tc(c.start)}${prevOf(t, c) ? '' : ' (entra desde el fondo: no hay un clip pegado antes)'}. La duración y la dirección se cambian en el panel de la derecha.`);
}
$('libTr').innerHTML = Object.entries(TRANS).filter(([k]) => k !== 'none').map(([k, l]) => `<button type="button" draggable="true" data-tr="${k}" title="Tocá para ponerla en el corte más cercano al cursor, o arrastrala a un clip"><i class="trp tr-${k}" aria-hidden="true"></i>${l}</button>`).join('');
$('libTr').onclick = e => { const b = e.target.closest('[data-tr]'); if (b) applyTr(b.dataset.tr); };
$('libTr').addEventListener('dragstart', e => { const b = e.target.closest('[data-tr]'); if (b) { e.dataTransfer.setData('text/x-clipcreate-tr', b.dataset.tr); e.dataTransfer.effectAllowed = 'copy'; } });
// ---------- Plan de la cuenta ----------
// Gratis: todo, con la marca «Hecho con ClipCreate». Básico: sin las herramientas Pro. Pro: todo, sin marca.
const Plan = { name: null };
const PLAN_NOMBRE = { gratis: 'Gratis', basico: 'Básico', pro: 'Pro' };
const marked = () => Plan.name !== 'basico' && Plan.name !== 'pro';
function showPlan() {
  const ch = $('planChip');
  ch.textContent = Plan.name ? 'Plan ' + (PLAN_NOMBRE[Plan.name] || Plan.name) : 'Entrar';
  ch.href = Plan.name ? 'index.html?planes=1' : 'index.html';
  ch.title = Plan.name ? 'Tu plan de ClipCreate' + (marked() ? ': los videos salen con la marca de ClipCreate' : '') : 'Entrá con tu cuenta de ClipCreate (sin cuenta, los videos salen con la marca de ClipCreate)';
  dirty = true;
}
async function loadPlan() {
  try { Plan.name = JSON.parse(localStorage.getItem('clipcreate.cuenta') || 'null')?.plan || null; } catch {}
  showPlan();
  try {
    const c = await Smart.cuenta();
    Plan.name = c?.plan || null;
    try { c ? localStorage.setItem('clipcreate.cuenta', JSON.stringify({ plan: c.plan })) : localStorage.removeItem('clipcreate.cuenta'); } catch {}
  } catch { /* sin conexión: queda lo último que se supo */ }
  showPlan();
}
function needPro(what) {
  if (Plan.name !== 'basico') return false;
  $('planMsg').textContent = `${what} es del plan Pro. Con el plan Pro tenés todas las herramientas del editor.`;
  $('planDlg').showModal();
  return true;
}

// ---------- Página de Color (estilo sala de color) ----------
let page = 'edit', scopeDirty = false, lastScope = 0, crvCh = 'y', crvDrag = null;
const EDIT_ONLY = ['.rail', '#left', '#right', '#split2', '.tlbox'];
const GRADE = ['exp', 'con', 'sat', 'temp', 'tint', 'hue', 'vib', 'hl', 'sh', 'wh', 'bl', 'vig', 'grain', 'lut', 'lutMix', 'cw', 'curves'];
const WHEELS = { lift: ['Sombras', 'Lift', 0.25, 0.5], gamma: ['Medios', 'Gamma', 0.25, 0.5], gain: ['Luces', 'Gain', 0.5, 1], offset: ['Todo', 'Offset', 0.25, 0.5] };
const PHASE = [0, 2 * Math.PI / 3, 4 * Math.PI / 3]; // rojo a la derecha, verde arriba a la izquierda, azul abajo a la izquierda
const PRIM = [['exp', 'Exposición', -1, 1, 0.01], ['con', 'Contraste', -1, 1, 0.01], ['sat', 'Saturación', -1, 1, 0.01], ['vib', 'Vibrance', -1, 1, 0.01],
  ['temp', 'Temperatura', -1, 1, 0.01], ['tint', 'Tinte', -1, 1, 0.01], ['hue', 'Matiz', -30, 30, 1], ['hl', 'Luces', -1, 1, 0.01], ['sh', 'Sombras', -1, 1, 0.01], ['vig', 'Viñeta', 0, 1, 0.01]];
const CURVES = { suave: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]], fuerte: [[0, 0], [0.25, 0.16], [0.75, 0.85], [1, 1]], mate: [[0, 0.08], [0.25, 0.26], [0.75, 0.76], [1, 0.95]],
  claro: [[0, 0], [0.5, 0.58], [1, 1]], oscuro: [[0, 0], [0.5, 0.42], [1, 1]], lineal: [[0, 0], [1, 1]] };
const CH_COL = { y: '#e8e8ec', r: '#ff5a5a', g: '#4ddc6a', b: '#4f8dff' };

const vClips = () => tracks('video').flatMap(t => t.clips.filter(c => media.has(c.media))).sort((a, b) => a.start - b.start);
const graded = c => needsGrade(c) || c.vig > 0 || c.grain > 0;
function gclip() { // el clip que se está corrigiendo
  const f = sel && find(sel);
  return f?.t.kind === 'video' && media.has(f.c.media) ? f.c : null;
}
function underHead() {
  for (const t of tracks('video')) if (!t.hidden) { const c = t.clips.find(x => T >= x.start && T < end(x) && media.has(x.media)); if (c) return c; }
  return null;
}
function setPage(p) {
  if (p === 'color' && needPro('La página de Color')) return;
  if (p === 'color' && !vClips().length) return say('Poné un video o una imagen en la línea de tiempo para corregir el color.');
  page = p;
  document.body.classList.toggle('color', p === 'color');
  for (const q of EDIT_ONLY) document.querySelector(q).hidden = p === 'color';
  for (const el of document.querySelectorAll('.cpage')) el.hidden = p !== 'color';
  $('pgEdit').setAttribute('aria-pressed', p === 'edit'); $('pgColor').setAttribute('aria-pressed', p === 'color');
  if (p === 'color') {
    multi.clear();
    if (!gclip()) { const c = underHead() || vClips()[0]; sel = c.id; if (T < c.start || T >= end(c)) seek(c.start + Math.min(0.5, len(c) / 2)); }
    renderColor(); say('Página de Color: corregí cada clip con las ruedas, las curvas y los scopes.');
  } else { renderTimeline(); renderProps(); }
  dirty = true;
}
$('pgEdit').onclick = () => setPage('edit');
$('pgColor').onclick = () => setPage('color');
// En la página de Color, el clip elegido sigue al cursor (como en una sala de color)
function colorFollow() {
  const c = underHead();
  if (c && c.id !== sel) { sel = c.id; renderColor(); }
}

function renderColor() {
  const c = gclip();
  const list = vClips();
  $('strip').replaceChildren(...list.map((x, i) => {
    const m = media.get(x.media), b = document.createElement('button');
    b.type = 'button'; b.dataset.id = x.id; b.setAttribute('aria-pressed', x.id === sel);
    b.setAttribute('aria-label', `Clip ${i + 1}: ${m.name}, en ${tc(x.start)}${graded(x) ? ', con color corregido' : ''}`);
    b.innerHTML = `${m.thumb ? `<img src="${m.thumb}" alt="">` : ''}<span>${String(i + 1).padStart(2, '0')}</span><small>${tc(x.start)}</small>${graded(x) ? '<i></i>' : ''}`;
    return b;
  }));
  $('strip').querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (!c) return;
  $('cName').textContent = media.get(c.media).name;
  $('cOrig').setAttribute('aria-pressed', colorOff); $('cOrig').textContent = colorOff ? 'Ver con color' : 'Ver original';
  $('cLut').innerHTML = Object.entries({ '': 'Sin LUT', ...Object.fromEntries(Object.entries(Assets.LUTS).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(P.luts || {}).map(([k, v]) => [k, v.name])) })
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('cLut').value = c.lut || ''; $('cLutMix').value = c.lutMix ?? 1; $('cLutMix').disabled = !c.lut;
  $('cLutMixO').textContent = Math.round((c.lutMix ?? 1) * 100) + ' %';
  for (const w of Object.keys(WHEELS)) wheelShow(c, w);
  for (const el of $('prim').querySelectorAll('[data-ck]')) { el.value = c[el.dataset.ck] || 0; el.previousElementSibling.textContent = fmtP(el); }
  drawCurve();
  renderStills();
}
const fmtP = el => el.dataset.ck === 'hue' ? (+el.value).toFixed(0) + '°' : (+el.value > 0 ? '+' : '') + (+el.value).toFixed(2);
$('strip').onclick = e => {
  const b = e.target.closest('button[data-id]'), f = b && find(b.dataset.id);
  if (!f) return;
  sel = f.c.id; seek(f.c.start + Math.min(0.5, len(f.c) / 2)); renderColor();
};

// Ruedas: el disco mueve el color (rojo, verde, azul) y la barra de abajo, el brillo
for (const [w, [name, en]] of Object.entries(WHEELS)) {
  const d = document.createElement('div');
  d.className = 'wheel';
  d.innerHTML = `<b>${name} <span class="sr-only">(${en})</span><span aria-hidden="true" style="color:var(--faint);font-weight:500"> · ${en}</span></b>
    <div class="wpad" data-w="${w}" tabindex="0" role="slider" aria-label="Color de ${name.toLowerCase()} (flechas para mover, Supr para volver al centro)" aria-valuemin="0" aria-valuemax="1"><i class="puck"></i></div>
    <input type="range" data-wm="${w}" min="-${WHEELS[w][3]}" max="${WHEELS[w][3]}" step="0.005" aria-label="Brillo de ${name.toLowerCase()}">
    <output data-wo="${w}"></output>`;
  $('wheels').append(d);
}
const cwOf = c => (c.cw ??= { lift: [0, 0, 0, 0], gamma: [0, 0, 0, 0], gain: [0, 0, 0, 0], offset: [0, 0, 0, 0] });
function wheelXY(v, R) { // de rojo, verde y azul a la posición en el disco
  return [2 / (3 * R) * PHASE.reduce((s, f, k) => s + v[k] * Math.cos(f), 0), 2 / (3 * R) * PHASE.reduce((s, f, k) => s + v[k] * Math.sin(f), 0)];
}
function wheelShow(c, w) {
  const v = c.cw?.[w] || [0, 0, 0, 0], [x, y] = wheelXY(v, WHEELS[w][2]);
  const pad = $('wheels').querySelector(`[data-w="${w}"]`), pk = pad.firstElementChild;
  pk.style.left = 50 + x * 46 + '%'; pk.style.top = 50 - y * 46 + '%';
  pad.setAttribute('aria-valuenow', Math.hypot(x, y).toFixed(2));
  const txt = `R ${v[0] >= 0 ? '+' : ''}${v[0].toFixed(2)}  G ${v[1] >= 0 ? '+' : ''}${v[1].toFixed(2)}  B ${v[2] >= 0 ? '+' : ''}${v[2].toFixed(2)}`;
  pad.setAttribute('aria-valuetext', txt);
  $('wheels').querySelector(`[data-wm="${w}"]`).value = v[3];
  $('wheels').querySelector(`[data-wo="${w}"]`).textContent = `${txt} · Y ${v[3] >= 0 ? '+' : ''}${v[3].toFixed(2)}`;
}
function wheelSet(c, w, x, y) {
  const r = Math.hypot(x, y);
  if (r > 1) { x /= r; y /= r; }
  const R = WHEELS[w][2], v = cwOf(c)[w];
  PHASE.forEach((f, k) => { v[k] = R * (x * Math.cos(f) + y * Math.sin(f)); });
  wheelShow(c, w); dirty = true;
}
let wDrag = null;
$('wheels').addEventListener('pointerdown', e => {
  const pad = e.target.closest('.wpad'), c = gclip();
  if (!pad || !c || e.button !== 0) return;
  wDrag = { w: pad.dataset.w, pad, before: snap() };
  pad.setPointerCapture(e.pointerId); pad.focus();
  wMove(e); e.preventDefault();
});
function wMove(e) {
  if (!wDrag) return;
  const r = wDrag.pad.getBoundingClientRect(), fine = e.shiftKey ? 0.25 : 1;
  wheelSet(gclip(), wDrag.w, fine * ((e.clientX - r.left) / r.width - 0.5) / 0.46, fine * (0.5 - (e.clientY - r.top) / r.height) / 0.46);
}
$('wheels').addEventListener('pointermove', wMove);
const wEnd = () => { if (!wDrag) return; const b = wDrag.before; wDrag = null; if (remember(b)) changed(); };
$('wheels').addEventListener('pointerup', wEnd);
$('wheels').addEventListener('pointercancel', wEnd);
$('wheels').addEventListener('dblclick', e => {
  const pad = e.target.closest('.wpad'), c = gclip();
  if (pad && c) edit(() => { const v = cwOf(c)[pad.dataset.w]; v[0] = v[1] = v[2] = 0; });
});
$('wheels').addEventListener('keydown', e => {
  const pad = e.target.closest('.wpad'), c = gclip();
  if (!pad || !c) return;
  const w = pad.dataset.w, st = e.shiftKey ? 0.1 : 0.02, [x, y] = wheelXY(c.cw?.[w] || [0, 0, 0, 0], WHEELS[w][2]);
  const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
  if (mv) { e.preventDefault(); e.stopPropagation(); edit(() => wheelSet(c, w, x + mv[0], y + mv[1])); }
  else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Home') { e.preventDefault(); e.stopPropagation(); edit(() => { const v = cwOf(c)[w]; v[0] = v[1] = v[2] = 0; }); }
});
let cPending = null;
$('wheels').addEventListener('input', e => {
  const w = e.target.dataset.wm, c = gclip();
  if (!w || !c) return;
  cPending ??= snap();
  cwOf(c)[w][3] = +e.target.value; wheelShow(c, w); dirty = true;
});
$('wheels').addEventListener('dblclick', e => { const w = e.target.dataset.wm, c = gclip(); if (w && c) edit(() => { cwOf(c)[w][3] = 0; }); });
const cCommit = () => { if (!cPending) return; const s = cPending; cPending = null; if (remember(s)) changed(); };
$('wheels').addEventListener('change', cCommit);

// Ajustes primarios
$('prim').innerHTML = PRIM.map(([k, l, a, b, st]) => `<label>${l} <output></output><input type="range" data-ck="${k}" min="${a}" max="${b}" step="${st}"></label>`).join('');
$('prim').addEventListener('input', e => {
  const k = e.target.dataset.ck, c = gclip();
  if (!k || !c) return;
  cPending ??= snap();
  c[k] = +e.target.value; e.target.previousElementSibling.textContent = fmtP(e.target); dirty = true;
});
$('prim').addEventListener('change', cCommit);
$('prim').addEventListener('dblclick', e => { const k = e.target.dataset.ck, c = gclip(); if (k && c) edit(() => { c[k] = 0; }); });
$('cLut').onchange = () => { const c = gclip(); if (c) edit(() => { c.lut = $('cLut').value; c.lutMix ??= 1; }); };
$('cLutMix').oninput = () => { const c = gclip(); if (!c) return; cPending ??= snap(); c.lutMix = +$('cLutMix').value; $('cLutMixO').textContent = Math.round(c.lutMix * 100) + ' %'; dirty = true; };
$('cLutMix').onchange = cCommit;
$('cOrig').onclick = () => { colorOff = !colorOff; dirty = true; renderColor(); };
const gradeOf = c => Object.fromEntries(GRADE.map(k => [k, structuredClone(c[k] ?? DEF.video[k])]));
$('cReset').onclick = () => { const c = gclip(); if (c) { edit(() => Object.assign(c, gradeOf(DEF.video))); say('Color del clip restablecido.'); } };
$('cPrev').onclick = () => {
  const c = gclip(), l = vClips(), i = l.indexOf(c);
  if (i < 1) return say('No hay un clip antes de este.');
  edit(() => Object.assign(c, gradeOf(l[i - 1]))); say('Mismo color que el clip anterior.');
};
$('cAll').onclick = () => {
  const c = gclip();
  if (!c) return;
  const g = gradeOf(c), l = vClips();
  edit(() => { for (const x of l) if (x !== c) Object.assign(x, structuredClone(g)); });
  say(`Color copiado a ${l.length - 1} clip(s).`);
};

// Curvas: Y (brillo) y por canal, con el histograma de la imagen atrás
const crv = $('crv'), cg = crv.getContext('2d');
let histo = null; // { y, r, g, b } de 256 valores, del último scope
const ptsOf = (c, ch) => c.curves?.[ch]?.length >= 2 ? c.curves[ch] : [[0, 0], [1, 1]];
function drawCurve() {
  const c = gclip(), W = crv.width, H = crv.height, pad = 8, S = W - pad * 2;
  cg.clearRect(0, 0, W, H);
  cg.strokeStyle = '#ffffff12'; cg.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const p = pad + S * i / 4; cg.beginPath(); cg.moveTo(p, pad); cg.lineTo(p, pad + S); cg.moveTo(pad, p); cg.lineTo(pad + S, p); cg.stroke(); }
  const hh = histo?.[crvCh];
  if (hh) {
    const mx = Math.max(1, ...hh.slice(2, 254));
    cg.fillStyle = CH_COL[crvCh] + '30'; cg.beginPath(); cg.moveTo(pad, pad + S);
    for (let i = 0; i < 256; i++) cg.lineTo(pad + S * i / 255, pad + S - S * 0.9 * Math.min(1, hh[i] / mx));
    cg.lineTo(pad + S, pad + S); cg.fill();
  }
  cg.strokeStyle = '#ffffff30'; cg.setLineDash([3, 3]); cg.beginPath(); cg.moveTo(pad, pad + S); cg.lineTo(pad + S, pad); cg.stroke(); cg.setLineDash([]);
  if (!c) return;
  const pts = ptsOf(c, crvCh), f = GL.curveFn(pts);
  cg.strokeStyle = CH_COL[crvCh]; cg.lineWidth = 2; cg.beginPath();
  for (let i = 0; i <= 128; i++) { const x = i / 128, y = clamp(f(x), 0, 1); cg[i ? 'lineTo' : 'moveTo'](pad + S * x, pad + S - S * y); }
  cg.stroke();
  for (const [x, y] of pts) { cg.fillStyle = '#111'; cg.strokeStyle = CH_COL[crvCh]; cg.beginPath(); cg.arc(pad + S * x, pad + S - S * y, 4.5, 0, 7); cg.fill(); cg.stroke(); }
}
function crvPos(e) {
  const r = crv.getBoundingClientRect(), k = crv.width / r.width, pad = 8, S = crv.width - pad * 2;
  return [clamp(((e.clientX - r.left) * k - pad) / S, 0, 1), clamp(1 - ((e.clientY - r.top) * k - pad) / S, 0, 1), S / k];
}
function crvSet(c, pts) { c.curves = { y: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]], ...c.curves, [crvCh]: pts }; }
crv.addEventListener('pointerdown', e => {
  const c = gclip();
  if (!c || e.button !== 0) return;
  const [x, y, S] = crvPos(e), pts = ptsOf(c, crvCh).map(p => [...p]);
  let i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) * S < 9);
  const before = snap();
  if (i < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(p => p[0] === x && p[1] === y); }
  crvSet(c, pts);
  crvDrag = { i, before };
  crv.setPointerCapture(e.pointerId); dirty = true; drawCurve(); e.preventDefault();
});
crv.addEventListener('pointermove', e => {
  const c = gclip();
  if (!crvDrag || !c) return;
  const [x, y] = crvPos(e), pts = c.curves[crvCh], i = crvDrag.i, n = pts.length;
  pts[i][1] = y;
  if (i > 0 && i < n - 1) pts[i][0] = clamp(x, pts[i - 1][0] + 0.01, pts[i + 1][0] - 0.01);
  dirty = true; drawCurve();
});
const crvEnd = () => { if (!crvDrag) return; const b = crvDrag.before; crvDrag = null; if (remember(b)) changed(); };
crv.addEventListener('pointerup', crvEnd);
crv.addEventListener('pointercancel', crvEnd);
crv.addEventListener('dblclick', e => {
  const c = gclip();
  if (!c) return;
  const [x, y, S] = crvPos(e), pts = ptsOf(c, crvCh), i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) * S < 9);
  if (i > 0 && i < pts.length - 1) edit(() => crvSet(c, pts.filter((_, j) => j !== i)));
});
for (const b of document.querySelectorAll('.ctabs [data-ch]')) b.onclick = () => {
  crvCh = b.dataset.ch;
  for (const x of document.querySelectorAll('.ctabs [data-ch]')) x.setAttribute('aria-checked', x === b);
  drawCurve();
};
$('crvPreset').onchange = () => {
  const c = gclip(), v = $('crvPreset').value;
  $('crvPreset').value = '';
  if (c && CURVES[v]) edit(() => crvSet(c, structuredClone(CURVES[v])));
};

// Scopes: se calculan de la imagen de la vista previa (achicada), unas 6 veces por segundo
const smp = document.createElement('canvas'), smpG = smp.getContext('2d', { willReadFrequently: true });
const scope = $('scope'), scG = scope.getContext('2d');
function updateScopes() {
  const kind = $('scopeKind').value, sw = 200, sh = Math.max(8, Math.round(sw * stage.height / stage.width));
  smp.width = sw; smp.height = sh;
  smpG.drawImage(stage, 0, 0, sw, sh);
  const d = smpG.getImageData(0, 0, sw, sh).data, N = sw * sh;
  const hist = { y: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) { hist.r[d[i]]++; hist.g[d[i + 1]]++; hist.b[d[i + 2]]++; hist.y[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; }
  histo = hist; drawCurve();
  const W = scope.width, H = scope.height;
  scG.fillStyle = '#050506'; scG.fillRect(0, 0, W, H);
  if (kind === 'hist') {
    scG.globalCompositeOperation = 'lighter';
    const mx = Math.max(1, ...['r', 'g', 'b'].flatMap(k => [...hist[k].slice(2, 254)]));
    for (const [k, col] of [['r', '#ff3b3b'], ['g', '#3bd65a'], ['b', '#3b7bff']]) {
      scG.fillStyle = col + '99'; scG.beginPath(); scG.moveTo(0, H);
      for (let i = 0; i < 256; i++) scG.lineTo(W * i / 255, H - (H - 10) * Math.min(1, hist[k][i] / mx));
      scG.lineTo(W, H); scG.fill();
    }
    scG.globalCompositeOperation = 'source-over';
    return grat(W, H, false);
  }
  const img = scG.createImageData(W, H), px = img.data, acc = new Float32Array(W * H * 3);
  const add = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; acc[o] += r; acc[o + 1] += g; acc[o + 2] += b; };
  const top = 10, hh = H - 20, lv = v => top + Math.round((1 - v / 255) * hh);
  for (let y = 0, i = 0; y < sh; y++) for (let x = 0; x < sw; x++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (kind === 'wave') { const X = Math.floor(x * W / sw); add(X, lv(0.2126 * r + 0.7152 * g + 0.0722 * b), 0.55, 1, 0.65); }
    else if (kind === 'parade') {
      const X = Math.floor(x * (W / 3 - 6) / sw);
      add(X, lv(r), 1, 0.25, 0.25); add(X + W / 3 + 3, lv(g), 0.25, 1, 0.35); add(X + 2 * W / 3 + 6, lv(b), 0.3, 0.5, 1);
    } else { // vectorscopio: Cb a la derecha, Cr arriba
      const cb = -0.1687 * r - 0.3313 * g + 0.5 * b, cr = 0.5 * r - 0.4187 * g - 0.0813 * b, R0 = H / 2 - 12;
      add(Math.round(W / 2 + cb / 128 * R0), Math.round(H / 2 - cr / 128 * R0), 0.4 + r / 425, 0.4 + g / 425, 0.4 + b / 425);
    }
  }
  const k = kind === 'vector' ? 0.5 : 3 * W * H / (N * (kind === 'parade' ? 3 : 1) * 12);
  for (let i = 0, o = 0; i < W * H; i++, o += 3) {
    px[i * 4] = 255 * (1 - Math.exp(-acc[o] * k)); px[i * 4 + 1] = 255 * (1 - Math.exp(-acc[o + 1] * k)); px[i * 4 + 2] = 255 * (1 - Math.exp(-acc[o + 2] * k)); px[i * 4 + 3] = 255;
  }
  scG.putImageData(img, 0, 0);
  if (kind === 'vector') vgrat(W, H); else grat(W, H, true);
}
function grat(W, H, levels) { // líneas de referencia: 0, 25, 50, 75 y 100 %
  scG.strokeStyle = '#ffffff1c'; scG.fillStyle = '#ffffff55'; scG.font = '10px sans-serif'; scG.lineWidth = 1;
  if (!levels) return;
  for (const v of [0, 25, 50, 75, 100]) { const y = 10 + Math.round((1 - v / 100) * (H - 20)) + 0.5; scG.beginPath(); scG.moveTo(0, y); scG.lineTo(W, y); scG.stroke(); scG.fillText(v, 3, y - 2); }
}
function vgrat(W, H) {
  const cx = W / 2, cy = H / 2, R0 = H / 2 - 12;
  scG.strokeStyle = '#ffffff22'; scG.lineWidth = 1;
  scG.beginPath(); scG.arc(cx, cy, R0, 0, 7); scG.moveTo(cx - R0, cy); scG.lineTo(cx + R0, cy); scG.moveTo(cx, cy - R0); scG.lineTo(cx, cy + R0); scG.stroke();
  scG.font = '10px sans-serif';
  for (const [n, r, g, b] of [['R', 191, 0, 0], ['Am', 191, 191, 0], ['V', 0, 191, 0], ['Ci', 0, 191, 191], ['Az', 0, 0, 191], ['Mg', 191, 0, 191]]) { // colores al 75 %
    const x = cx + (-0.1687 * r - 0.3313 * g + 0.5 * b) / 128 * R0, y = cy - (0.5 * r - 0.4187 * g - 0.0813 * b) / 128 * R0;
    scG.strokeStyle = '#ffffff66'; scG.strokeRect(x - 5, y - 5, 10, 10); scG.fillStyle = '#ffffff88'; scG.fillText(n, x + 7, y + 3);
  }
  const a = 123 * Math.PI / 180; // línea del tono de piel
  scG.strokeStyle = '#ffb08a77'; scG.beginPath(); scG.moveTo(cx, cy); scG.lineTo(cx + Math.cos(a) * R0, cy - Math.sin(a) * R0); scG.stroke();
}
$('scopeKind').onchange = () => { try { localStorage.setItem('clipcreate.editor.scope', $('scopeKind').value); } catch {} scopeDirty = true; };
try { const v = localStorage.getItem('clipcreate.editor.scope'); if (v) $('scopeKind').value = v; } catch {}

// Galería: stills con el color de un clip, para usar en otros (y en otros proyectos)
const GKEY = 'clipcreate.galeria';
const stills = () => { try { return JSON.parse(localStorage.getItem(GKEY) || '[]'); } catch { return []; } };
function renderStills() {
  const l = stills();
  $('stills').replaceChildren(...l.map((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${s.thumb}" alt=""><div class="sb"><b title="${esc(s.name)}">${esc(s.name)}</b>
      <div class="row"><button type="button" data-gapply="${i}">Aplicar</button><button type="button" data-gall="${i}">A todos</button><button type="button" class="ico" data-gdel="${i}" aria-label="Borrar el still ${esc(s.name)}"><svg class="i"><use href="#i-x"/></svg></button></div></div>`;
    return li;
  }));
  $('galHint').hidden = l.length > 2;
}
$('still').onclick = () => {
  const c = gclip();
  if (!c) return;
  const cv = document.createElement('canvas'); cv.width = 192; cv.height = Math.round(192 * stage.height / stage.width);
  cv.getContext('2d').drawImage(stage, 0, 0, cv.width, cv.height);
  const l = stills(), name = `${String(l.length + 1).padStart(2, '0')} · ${media.get(c.media).name.replace(/\.[^.]+$/, '')}`;
  l.unshift({ name, thumb: cv.toDataURL('image/jpeg', 0.7), grade: gradeOf(c), at: Date.now() });
  try { localStorage.setItem(GKEY, JSON.stringify(l.slice(0, 30))); say('Still guardado en la galería.'); }
  catch { say('No hay lugar en el navegador para otro still: borrá alguno.'); }
  renderStills();
};
$('stills').onclick = e => {
  const b = e.target.closest('button'), l = stills();
  if (!b) return;
  if (b.dataset.gdel !== undefined) { l.splice(+b.dataset.gdel, 1); try { localStorage.setItem(GKEY, JSON.stringify(l)); } catch {} return renderStills(); }
  const s = l[+(b.dataset.gapply ?? b.dataset.gall)], c = gclip();
  if (!s || !c) return;
  const g = structuredClone(s.grade);
  if (g.lut && !Assets.LUTS[g.lut] && !P.luts?.[g.lut]) g.lut = ''; // un LUT importado en otro proyecto no está acá
  const to = b.dataset.gall !== undefined ? vClips() : [c];
  edit(() => { for (const x of to) Object.assign(x, structuredClone(g)); });
  say(to.length > 1 ? `Still «${s.name}» aplicado a ${to.length} clips.` : `Still «${s.name}» aplicado.`);
};

// Las letras de los textos se cargan antes de dibujar (el lienzo no las pide solo)
const fontsReady = Promise.all(Object.values(FONTS).flatMap(f => [400, 600, 700, 800, 900].map(w => document.fonts.load(`${w} 40px ${f}`).catch(() => {}))))
  .then(() => { dirty = true; });

// ---------- Inicio: abre el proyecto pedido, o recupera el último ----------
(async () => {
  const q = new URLSearchParams(location.search);
  if (q.has('nuevo')) { // desde el inicio: Reel o Short (9:16) o video largo (16:9)
    const asp = ASPECTS[q.get('nuevo')] ? q.get('nuevo') : '9:16';
    await openProject(null);
    P.aspect = asp; P.name = asp === '16:9' ? 'Video largo nuevo' : 'Reel nuevo'; P.safe = asp === '9:16';
    await save(); sizeStage(); changed();
    say('Proyecto nuevo. Importá tus videos (botón Importar o arrastralos a la página).');
    requestAnimationFrame(loop); loadPlan();
    return;
  }
  if (q.has('proyectos')) { q.delete('proyectos'); setTimeout(() => { renderProjects(); $('projs').showModal(); }, 300); }
  let id = q.get('p');
  try { id ||= localStorage.getItem('clipcreate.editor.ultimo'); } catch {}
  if (!window.indexedDB) say('Este navegador no permite guardar proyectos: se pierden al cerrar la pestaña.');
  await openProject(id);
  if ($('status').textContent.startsWith('Faltan')) toast($('status').textContent);
  else if (id && P.id === id && dur()) say(`Se abrió «${P.name}». Se guarda solo mientras trabajás.`);
  else say('Importá un video, un audio o una imagen para empezar.');
  requestAnimationFrame(loop);
  loadPlan();
})();
