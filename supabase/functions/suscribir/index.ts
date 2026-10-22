// ClipCreate: cobro con Mercado Pago. Crea la suscripción mensual (Básico o Pro) y devuelve el link de pago,
// o la cancela. También informa los precios. El token de Mercado Pago vive acá como secreto (MP_ACCESS_TOKEN).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-video',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Precio en dólares (lo que se muestra) y en pesos (lo que cobra Mercado Pago). Los pesos se cambian con secretos.
const PLANES: Record<string, { nombre: string; usd: number; ars: number }> = {
  basico: { nombre: 'ClipCreate Básico', usd: 9, ars: Number(Deno.env.get('PRECIO_BASICO_ARS') ?? 0) },
  pro: { nombre: 'ClipCreate Pro', usd: 19, ars: Number(Deno.env.get('PRECIO_PRO_ARS') ?? 0) },
};
const APP_URL = Deno.env.get('APP_URL') ?? 'https://agenciaorigen.github.io/ClipCUT/';
const mp = (path: string, init: RequestInit = {}) => fetch(`https://api.mercadopago.com${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'Iniciá sesión' }, 401);

  let body: { accion?: string; plan?: string };
  try { body = await req.json(); } catch { return json({ error: 'Pedido inválido' }, 400); }

  if (body.accion === 'precios') {
    return json({ basico: { usd: PLANES.basico.usd, ars: PLANES.basico.ars }, pro: { usd: PLANES.pro.usd, ars: PLANES.pro.ars } });
  }

  if (!Deno.env.get('MP_ACCESS_TOKEN')) return json({ error: 'Cobro no configurado' }, 501);

  if (body.accion === 'cancelar') {
    const { data: perfil } = await admin.from('perfiles').select('mp_id').eq('user_id', user.id).maybeSingle();
    if (!perfil?.mp_id) return json({ error: 'No tenés una suscripción activa' }, 400);
    const r = await mp(`/preapproval/${perfil.mp_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    if (!r.ok) return json({ error: `Mercado Pago ${r.status}` }, 502);
    await admin.from('perfiles').update({ plan: 'gratis', mp_estado: 'cancelled', actualizado: new Date().toISOString() }).eq('user_id', user.id);
    return json({ ok: true });
  }

  const plan = PLANES[body.plan ?? ''];
  if (!plan) return json({ error: 'Plan inválido' }, 400);
  if (!(plan.ars > 0)) return json({ error: 'Falta el precio en pesos de este plan' }, 501);

  const r = await mp('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: plan.nombre,
      external_reference: `${user.id}:${body.plan}`, // así el aviso de pago sabe a quién y qué plan darle
      payer_email: user.email,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: plan.ars, currency_id: 'ARS' },
      back_url: `${APP_URL}?pago=listo`,
      status: 'pending',
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.init_point) return json({ error: `Mercado Pago ${r.status}: ${out.message ?? 'no se pudo crear la suscripción'}` }, 502);
  return json({ url: out.init_point });
});
