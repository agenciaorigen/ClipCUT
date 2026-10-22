// ClipCreate: puente entre la app y DeepSeek. La clave de DeepSeek vive acá como secreto (DEEPSEEK_API_KEY)
// y nunca llega al navegador. Solo atiende a usuarios que entraron con su cuenta, y anota cuánto usa cada uno.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-video',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Tokens por usuario por día (se cambia con el secreto LIMITE_DIARIO)
const LIMITE = Number(Deno.env.get('LIMITE_DIARIO') ?? 300000);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // ¿Quién pide? (el token de la sesión de la app)
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'Iniciá sesión' }, 401);

  // Plan: cada video nuevo cuenta (gratis 2 en total, básico 10 y pro 40 por mes); el mismo video no cuenta dos veces
  const huella = req.headers.get('x-video') ?? '';
  if (!/^[\w.-]{4,80}$/.test(huella)) return json({ error: 'Falta identificar el video' }, 400);
  const { data: cupo, error: cupoErr } = await admin.rpc('usar_video', { uid: user.id, h: huella });
  if (cupoErr) return json({ error: 'No se pudo revisar el plan' }, 500);
  if (cupo === 'limite') return json({ error: 'limite' }, 402);

  // Pedido: solo mensajes de texto, con un tamaño razonable
  let body: { messages?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Pedido inválido' }, 400); }
  const messages = body.messages;
  const ok = Array.isArray(messages) && messages.length > 0 && messages.length <= 10 &&
    messages.every((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string') &&
    JSON.stringify(messages).length <= 400000;
  if (!ok) return json({ error: 'Pedido inválido' }, 400);

  // Límite diario por usuario
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: usado } = await admin.from('uso').select('tokens').eq('user_id', user.id).gte('creado', desde);
  const total = (usado ?? []).reduce((n: number, r: { tokens: number | null }) => n + (r.tokens ?? 0), 0);
  if (total >= LIMITE) return json({ error: 'Límite diario alcanzado' }, 429);

  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('DEEPSEEK_API_KEY')}` },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.2, response_format: { type: 'json_object' }, messages }),
  });
  const text = await r.text();
  if (r.ok) {
    try {
      const tokens = JSON.parse(text).usage?.total_tokens ?? 0;
      await admin.from('uso').insert({ user_id: user.id, tokens });
    } catch { /* si no se pudo anotar, igual se responde */ }
  }
  // 401/402 de DeepSeek son problemas de la clave o el saldo del servidor, no del usuario
  return new Response(r.ok ? text : JSON.stringify({ error: `DeepSeek ${r.status}` }), {
    status: r.ok ? 200 : r.status === 401 || r.status === 402 ? 502 : r.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
