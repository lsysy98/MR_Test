begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.client_cleanup_runs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  state text not null default 'preview' check (state in ('preview','applied','restored'))
);
create table if not exists public.client_cleanup_items (
  run_id uuid not null references public.client_cleanup_runs(id),
  client_id text not null,
  snapshot jsonb not null,
  reasons jsonb not null,
  removed boolean not null default false,
  primary key(run_id, client_id)
);

create or replace function public.client_cleanup(p_action text, p_run uuid, p_candidates jsonb default '[]', p_page integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.client_cleanup_runs; n integer; result jsonb;
begin
  if p_action = 'preview' then
    insert into client_cleanup_runs(id) values(p_run);
    insert into client_cleanup_items(run_id,client_id,snapshot,reasons)
      select p_run,d.id,to_jsonb(d),c.reasons from jsonb_to_recordset(p_candidates) as c(id text,reasons jsonb)
      join client_directory d on d.id=c.id
      where d.id like 'code-%' or d.id like 'client-%';
  end if;
  select * into r from client_cleanup_runs where id=p_run for update;
  if not found then raise exception '미리보기를 다시 실행해주세요.'; end if;
  if p_action = 'apply' and r.state = 'preview' then
    if r.created_at < now()-interval '15 minutes' then raise exception '미리보기가 만료되었습니다. 다시 확인해주세요.'; end if;
    -- Only remove the exact rows reviewed; preserve intervening edits and manual clients.
    with removed as (
      delete from client_directory d using client_cleanup_items i
      where i.run_id=p_run and d.id=i.client_id and to_jsonb(d)=i.snapshot returning d.id
    ) update client_cleanup_items i set removed=true from removed d where i.run_id=p_run and i.client_id=d.id;
    update client_cleanup_runs set state='applied' where id=p_run;
  elsif p_action = 'restore' and r.state = 'applied' then
    insert into client_directory
      select restored.* from client_cleanup_items i
      cross join lateral jsonb_populate_record(null::client_directory,i.snapshot) restored
      where i.run_id=p_run and i.removed on conflict(id) do nothing;
    update client_cleanup_runs set state='restored' where id=p_run;
  elsif p_action not in ('preview','page','apply','restore') then
    raise exception 'invalid_request';
  end if;
  select count(*) into n from client_cleanup_items where run_id=p_run;
  select jsonb_build_object('runId',p_run,'total',n,'page',greatest(0,p_page),'pageSize',50,
    'state',(select state from client_cleanup_runs where id=p_run),
    'removed',(select count(*) from client_cleanup_items where run_id=p_run and removed),
    'items',coalesce((select jsonb_agg(x) from (
      select snapshot->>'client_name' as client,snapshot->>'client_code' as code,snapshot->>'branch_name' as branch,reasons
      from client_cleanup_items where run_id=p_run order by snapshot->>'client_name',client_id limit 50 offset greatest(0,p_page)*50
    ) x),'[]'::jsonb)) into result;
  return result;
end $$;

create table if not exists public.report_push_subscriptions (
  id text primary key,
  token_hash text not null,
  owner text not null check(owner in ('성진욱','김무영','이승엽','김태홍','제성규','송진영','이현욱')),
  subscription jsonb not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.report_push_deliveries (
  subscription_id text not null references public.report_push_subscriptions(id) on delete cascade,
  delivery_key text not null,
  lease uuid not null,
  status text not null check(status in ('sending','sent','failed','skipped','expired')),
  attempts integer not null default 1,
  error_code text,
  updated_at timestamptz not null default now(),
  primary key(subscription_id,delivery_key)
);
alter table public.report_push_subscriptions add column if not exists reminder_time time without time zone not null default '18:00';
create index if not exists report_push_enabled_idx on public.report_push_subscriptions(owner) where enabled;

drop function if exists public.report_push_device(text,text,text,text,jsonb);
create or replace function public.report_push_device(p_action text,p_id text,p_token_hash text,p_owner text default '',p_subscription jsonb default '{}',p_reminder_time text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s report_push_subscriptions;
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtext(p_id));
  select * into s from report_push_subscriptions where id=p_id for update;
  if found and s.token_hash<>p_token_hash then raise exception 'device_token_mismatch'; end if;
  if p_reminder_time is not null and p_reminder_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_reminder_time'; end if;
  if p_action='subscribe' then
    if s.id is null and (select count(*) from report_push_subscriptions where owner=p_owner and enabled)>=50 then raise exception 'device_limit'; end if;
    insert into report_push_subscriptions(id,token_hash,owner,subscription,reminder_time)
    values(p_id,p_token_hash,p_owner,p_subscription,coalesce(p_reminder_time::time,s.reminder_time,'18:00'::time))
    on conflict(id) do update set owner=excluded.owner,subscription=excluded.subscription,reminder_time=excluded.reminder_time,enabled=true,updated_at=now();
  elsif p_action='preferences' then
    if s.id is null then raise exception 'subscription_required'; end if;
    update report_push_subscriptions set owner=p_owner,reminder_time=coalesce(p_reminder_time::time,reminder_time),updated_at=now() where id=p_id;
  elsif p_action='unsubscribe' then
    update report_push_subscriptions set enabled=false,updated_at=now() where id=p_id;
  elsif p_action<>'status' then raise exception 'invalid_request';
  end if;
  return (select jsonb_build_object('enabled',enabled,'owner',owner,'reminderTime',to_char(reminder_time,'HH24:MI')) from report_push_subscriptions where id=p_id);
end $$;

create or replace function public.report_push_due(p_now timestamptz default now())
returns setof public.report_push_subscriptions language sql stable security definer set search_path = public as $$
  select s.* from report_push_subscriptions s
  where s.enabled
    and (p_now at time zone 'Asia/Seoul')::time >= s.reminder_time
    and (p_now at time zone 'Asia/Seoul')::time - s.reminder_time < interval '15 minutes'
    and not exists(select 1 from daily_completions c where c.owner=s.owner and c.report_date=(p_now at time zone 'Asia/Seoul')::date and c.status in ('done','leave'))
    and not exists(select 1 from report_push_deliveries d where d.subscription_id=s.id and d.delivery_key=to_char(p_now at time zone 'Asia/Seoul','YYYY-MM-DD') and (d.status<>'failed' or d.attempts>=3))
  order by s.reminder_time,s.id;
$$;

create or replace function public.tick_report_push()
returns bigint language plpgsql security definer set search_path = '' as $$
declare origin text; secret text; request_id bigint;
begin
  if not exists(select 1 from public.report_push_due()) then return null; end if;
  select decrypted_secret into origin from vault.decrypted_secrets where name='daily_report_test_push_origin';
  select decrypted_secret into secret from vault.decrypted_secrets where name='daily_report_test_cron_secret';
  if origin is null or secret is null then raise exception 'push_scheduler_not_configured'; end if;
  select net.http_get(url:=origin||'/api/notifications?action=dispatch',headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=55000) into request_id;
  return request_id;
end $$;

create or replace function public.configure_report_push_scheduler(p_origin text,p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if p_origin !~ '^https://[a-zA-Z0-9.-]+(:443)?$' or length(p_secret)<16 then raise exception 'invalid_scheduler_config'; end if;
  perform pg_advisory_xact_lock(hashtext('daily-report-test-push-scheduler'));
  select id into secret_id from vault.secrets where name='daily_report_test_push_origin';
  if secret_id is null then perform vault.create_secret(p_origin,'daily_report_test_push_origin');
  else perform vault.update_secret(secret_id,p_origin); end if;
  select id into secret_id from vault.secrets where name='daily_report_test_cron_secret';
  if secret_id is null then perform vault.create_secret(p_secret,'daily_report_test_cron_secret');
  else perform vault.update_secret(secret_id,p_secret); end if;
  perform cron.schedule('daily-report-test-push','* * * * *','select public.tick_report_push();');
  return true;
end $$;

create or replace function public.claim_report_push(p_id text,p_key text,p_lease uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into report_push_deliveries(subscription_id,delivery_key,lease,status)
    select p_id,p_key,p_lease,'sending' where exists(select 1 from report_push_subscriptions where id=p_id and enabled)
    on conflict(subscription_id,delivery_key) do update set lease=excluded.lease,status='sending',attempts=report_push_deliveries.attempts+1,updated_at=now()
      where report_push_deliveries.status='failed' and report_push_deliveries.attempts<3;
  get diagnostics n=row_count;
  return n=1;
end $$;

alter table public.client_cleanup_runs enable row level security;
alter table public.client_cleanup_items enable row level security;
alter table public.report_push_subscriptions enable row level security;
alter table public.report_push_deliveries enable row level security;
revoke all on public.client_cleanup_runs,public.client_cleanup_items,public.report_push_subscriptions,public.report_push_deliveries from anon,authenticated;
grant all on public.client_cleanup_runs,public.client_cleanup_items,public.report_push_subscriptions,public.report_push_deliveries to service_role;
revoke all on function public.client_cleanup(text,uuid,jsonb,integer),public.report_push_device(text,text,text,text,jsonb,text),public.claim_report_push(text,text,uuid),public.report_push_due(timestamptz),public.configure_report_push_scheduler(text,text),public.tick_report_push() from public,anon,authenticated;
grant execute on function public.client_cleanup(text,uuid,jsonb,integer),public.report_push_device(text,text,text,text,jsonb,text),public.claim_report_push(text,text,uuid),public.report_push_due(timestamptz),public.configure_report_push_scheduler(text,text) to service_role;
select pg_notify('pgrst','reload schema');
commit;
