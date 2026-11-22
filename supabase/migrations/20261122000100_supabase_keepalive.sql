-- ============================================================================
-- FREE-PLAN KEEP-ALIVE (2026-11-22)
-- ============================================================================
-- Supabase pauses a Free-plan project after a week with too little user
-- database activity ("a few user requests to the database each day" is the
-- documented rule of thumb). Nothing in the app guarantees that traffic, so a
-- quiet week used to be enough to pause the project and take sign-in and cloud
-- sync offline.
--
-- This schedules a real request through the project's own REST API every six
-- hours: a PostgREST table read that executes a SELECT against
-- `public.questions`. It lives entirely inside Postgres, so there is no external
-- scheduler, token or secret to rot.
--
--   cron job   hdsat-supabase-keepalive   '17 */6 * * *'   net.http_get
--   cron job   hdsat-keepalive-cleanup    '43 3 * * 0'     prune pg_net log
--
-- The publishable (anon) key the request needs lives in
-- `public.keepalive_config`, which has RLS on, no policies and no anon or
-- authenticated grants, so it is not readable through the API. The key is
-- written by `tools/apply_keepalive.py` with the service-role key and is never
-- committed. Until then the job runs but skips (apikey is null).
--
-- Verify:
--
--   select jobname, schedule, active from cron.job where jobname like 'hdsat-%';
--   select status, start_time, return_message
--     from cron.job_run_details order by start_time desc limit 5;
--   select status_code, created from net._http_response order by id desc limit 5;
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.keepalive_config (
    id boolean primary key default true check (id),
    url text not null,
    apikey text
);

alter table public.keepalive_config enable row level security;
revoke all on public.keepalive_config from public, anon, authenticated;

insert into public.keepalive_config (id, url)
values (true, 'https://qijfmwjcaminecxmbtcf.supabase.co/rest/v1/questions?select=id&limit=1')
on conflict (id) do update set url = excluded.url;

-- Four real API reads a day, spread across the day rather than bunched at one
-- hour, well inside the "few requests a day" guidance.
select cron.schedule(
    'hdsat-supabase-keepalive',
    '17 */6 * * *',
    $job$
    select net.http_get(
        url := c.url,
        headers := jsonb_build_object(
            'apikey', c.apikey,
            'Authorization', 'Bearer ' || c.apikey
        ),
        timeout_milliseconds := 10000
    )
    from public.keepalive_config c
    where c.apikey is not null;
    $job$
);

-- pg_net keeps every response in net._http_response. Four rows a day is tiny,
-- but pruning weekly keeps the table honest without touching project data.
select cron.schedule(
    'hdsat-keepalive-cleanup',
    '43 3 * * 0',
    $job$
    delete from net._http_response where created < now() - interval '3 days';
    $job$
);
