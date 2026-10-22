// ClipCreate: transcribe el audio en el servidor con Groq (Whisper grande): segundos en vez de minutos.
// La clave de Groq vive acá como secreto (GROQ_API_KEY). Solo para usuarios con cuenta; se anota cuánto audio usa cada uno.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-video',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Segundos de audio por usuario por día (se cambia con el secreto LIMITE_AUDIO_DIARIO): 4 horas
const LIMITE = Number(Deno.env.get('LIMITE_AUDIO_DIARIO') ?? 14400);
const MAX_BYTES = 24 * 1024 * 1024; // Groq acepta hasta 25 MB por archivo en el plan gratis

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) return json({ error: 'Transcripción en el servidor no configurada' }, 501);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'Iniciá sesión' }, 401);

  // Plan: cada video nuevo cuenta (gratis 2 en total, básico 10 y pro 40 por mes); el mismo video no cuenta dos veces
  const huella = req.headers.get('x-video') ?? '';
  if (!/^[\w.-]{4,80}$/.test(huella)) return json({ error: 'Falta identificar el video' }, 400);
  const { data: cupo, error: cupoErr } = await admin.rpc('usar_video', { uid: user.id, h: huella });
  if (cupoErr) return json({ error: 'No se pudo revisar el plan' }, 500);
  if (cupo === 'limite') return json({ error: 'limite' }, 402);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'Pedido inválido' }, 400); }
  const audio = form.get('audio'), secs = Number(form.get('segundos') ?? 0);
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_BYTES || !(secs > 0 && secs <= 3600)) {
    return json({ error: 'Pedido inválido' }, 400);
  }

  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: usado } = await admin.from('uso').select('segundos').eq('user_id', user.id).gte('creado', desde);
  const total = (usado ?? []).reduce((n: number, r: { segundos: number | null }) => n + Number(r.segundos ?? 0), 0);
  if (total + secs > LIMITE) return json({ error: 'Límite diario de audio alcanzado' }, 429);

  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.ogg');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'es');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');
  fd.append('timestamp_granularities[]', 'word'); // el tiempo real de cada palabra, para el karaoke
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${groqKey}` }, body: fd,
  });
  if (!r.ok) {
    // 401: clave de Groq mal; 429: límite de Groq; lo demás, error de Groq
    return json({ error: `Groq ${r.status}` }, r.status === 429 ? 429 : 502);
  }
  const out = await r.json();
  type W = { word: string; start: number; end: number };
  const words: W[] = Array.isArray(out.words) ? out.words : [];
  // cada frase con los tiempos de sus palabras (las que empiezan dentro de la frase)
  const segments = (out.segments ?? []).map((s: { start: number; end: number; text: string }) => ({
    start: s.start, end: s.end, text: s.text,
    words: words.filter(w => w.start >= s.start - 0.05 && w.start < s.end).map(w => [w.start, w.end]),
  }));
  try { await admin.from('uso').insert({ user_id: user.id, tokens: 0, segundos: secs }); } catch { /* igual se responde */ }
  return json({ segments });
});
