// ClipCreate: aviso de Mercado Pago cuando una suscripción se paga, se pausa o se cancela.
// No confía en lo que llega: con el número de suscripción le pregunta a Mercado Pago el estado real
// y recién ahí cambia el plan del usuario. Esta función se publica SIN verificar JWT (la llama Mercado Pago).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ok = () => new Response('ok', { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok();
  const url = new URL(req.url);
  let body: { type?: string; topic?: string; data?: { id?: string } } = {};
  try { body = await req.json(); } catch { /* algunos avisos llegan solo por la URL */ }
  const type = body.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '';
  const id = body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id');
  if (!id || !/^[\w-]{6,64}$/.test(String(id)) || !/preapproval/.test(type)) return ok(); // otros avisos no nos importan

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  const r = await fetch(`https://api.mercadopago.com/preapproval/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return new Response('reintentar', { status: 500 }); // Mercado Pago vuelve a avisar más tarde
  const sus = await r.json();
  const [uid, plan] = String(sus.external_reference ?? '').split(':');
  if (!/^[0-9a-f-]{36}$/.test(uid ?? '') || !['basico', 'pro'].includes(plan)) return ok();

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: perfil } = await admin.from('perfiles').select('mp_id').eq('user_id', uid).maybeSingle();
  const ahora = new Date().toISOString();

  if (sus.status === 'authorized') {
    // si tenía otra suscripción (por ejemplo, pasó de Básico a Pro), se cancela la vieja para no cobrar dos veces
    if (perfil?.mp_id && perfil.mp_id !== sus.id) {
      await fetch(`https://api.mercadopago.com/preapproval/${perfil.mp_id}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
      });
    }
    await admin.from('perfiles').upsert({ user_id: uid, plan, mp_id: sus.id, mp_estado: sus.status, actualizado: ahora });
  } else if (['cancelled', 'paused'].includes(sus.status) && perfil?.mp_id === sus.id) {
    // solo si es la suscripción vigente: cancelar una vieja no le saca el plan nuevo
    await admin.from('perfiles').update({ plan: 'gratis', mp_estado: sus.status, actualizado: ahora }).eq('user_id', uid);
  }
  return ok();
});
