create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.meetings (
  id text primary key,
  name text not null,
  time text not null default '',
  location text not null default '',
  organizer text not null default '',
  is_published boolean not null default false,
  venue_config jsonb not null,
  seating_rules jsonb not null,
  people jsonb not null default '[]'::jsonb,
  regions jsonb not null default '[]'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.meetings
  add column if not exists is_published boolean not null default false;

create unique index if not exists meetings_single_published_idx
  on public.meetings (is_published)
  where is_published = true;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.assign_initial_profile_role()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.profiles) = 0 then
    new.role = 'admin';
  elsif new.role is null or new.role not in ('admin', 'member') then
    new.role = 'member';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_initial_role on public.profiles;
create trigger profiles_assign_initial_role
before insert on public.profiles
for each row execute function public.assign_initial_profile_role();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists meetings_touch_updated_at on public.meetings;
create trigger meetings_touch_updated_at
before update on public.meetings
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "meetings_select_shared" on public.meetings;
create policy "meetings_select_shared"
on public.meetings
for select
to authenticated
using (true);

drop policy if exists "meetings_insert_shared" on public.meetings;
create policy "meetings_insert_shared"
on public.meetings
for insert
to authenticated
with check (true);

drop policy if exists "meetings_update_shared" on public.meetings;
create policy "meetings_update_shared"
on public.meetings
for update
to authenticated
using (true)
with check (true);

drop policy if exists "meetings_delete_shared" on public.meetings;
create policy "meetings_delete_shared"
on public.meetings
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

comment on table public.profiles is '共享排座系统用户资料与角色';
comment on table public.meetings is '共享排座系统会议聚合存储表';
