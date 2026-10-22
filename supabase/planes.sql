-- ClipCut: planes y videos por usuario
-- Gratis: 2 videos en total. Básico: 10 por mes. Pro: 40 por mes.
create table if not exists public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'gratis' check (plan in ('gratis', 'basico', 'pro')),
  mp_id text,            -- la suscripción de Mercado Pago
  mp_estado text,
  actualizado timestamptz not null default now()
);
alter table public.perfiles enable row level security;
drop policy if exists "ver mi perfil" on public.perfiles;
create policy "ver mi perfil" on public.perfiles for select to authenticated using (user_id = auth.uid());

create table if not exists public.videos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  huella text not null,  -- identifica el archivo de video (nombre y tamaño), no su contenido
  creado timestamptz not null default now(),
  unique (user_id, huella)
);
alter table public.videos enable row level security;
drop policy if exists "ver mis videos" on public.videos;
create policy "ver mis videos" on public.videos for select to authenticated using (user_id = auth.uid());

-- Cuántos videos puede usar cada plan y en qué período
create or replace function public.limite_plan(p text) returns int language sql immutable as $$
  select case p when 'pro' then 40 when 'basico' then 10 else 2 end
$$;

-- La usan solo las funciones del servidor: anota un video nuevo si el plan lo permite
create or replace function public.usar_video(uid uuid, h text) returns text
language plpgsql security definer set search_path = public as $$
declare p text; n int;
begin
  insert into perfiles (user_id) values (uid) on conflict (user_id) do nothing;
  select plan into p from perfiles where user_id = uid;
  if exists (select 1 from videos where user_id = uid and huella = h) then return 'ok'; end if;
  if p = 'gratis' then
    select count(*) into n from videos where user_id = uid;
  else
    select count(*) into n from videos where user_id = uid and creado > now() - interval '30 days';
  end if;
  if n >= limite_plan(p) then return 'limite'; end if;
  insert into videos (user_id, huella) values (uid, h);
  return 'ok';
end $$;
revoke execute on function public.usar_video(uuid, text) from public, anon, authenticated;
grant execute on function public.usar_video(uuid, text) to service_role;

-- La usa la app: el plan del usuario y cuántos videos le quedan
create or replace function public.mi_cuenta() returns json
language plpgsql security definer set search_path = public as $$
declare p text; n int;
begin
  if auth.uid() is null then return null; end if;
  insert into perfiles (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select plan into p from perfiles where user_id = auth.uid();
  if p = 'gratis' then
    select count(*) into n from videos where user_id = auth.uid();
  else
    select count(*) into n from videos where user_id = auth.uid() and creado > now() - interval '30 days';
  end if;
  return json_build_object('plan', p, 'usados', n, 'limite', limite_plan(p));
end $$;
revoke execute on function public.mi_cuenta() from public, anon;
grant execute on function public.mi_cuenta() to authenticated;
