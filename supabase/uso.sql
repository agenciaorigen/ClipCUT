-- ClipCut: registro de uso por usuario (lo escriben solo las funciones del servidor)
create table if not exists public.uso (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tokens integer not null default 0,
  creado timestamptz not null default now()
);
alter table public.uso add column if not exists segundos numeric not null default 0;
create index if not exists uso_user_creado on public.uso (user_id, creado);
alter table public.uso enable row level security;
-- cada usuario puede ver solo su propio uso; nadie puede escribir desde la app
drop policy if exists "ver mi uso" on public.uso;
create policy "ver mi uso" on public.uso for select to authenticated using (user_id = auth.uid());
