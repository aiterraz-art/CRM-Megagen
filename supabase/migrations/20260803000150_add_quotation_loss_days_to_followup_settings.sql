alter table public.client_followup_settings
    add column if not exists quotation_loss_days integer not null default 3;

update public.client_followup_settings
set quotation_loss_days = coalesce(quotation_loss_days, 3)
where id = 'default';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'client_followup_settings_quotation_loss_days_ck'
    ) then
        alter table public.client_followup_settings
            add constraint client_followup_settings_quotation_loss_days_ck
            check (quotation_loss_days >= 1);
    end if;
end $$;

create or replace function public.expire_stale_sent_quotations(p_days integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config_days integer := 3;
  v_days integer;
  v_threshold timestamptz;
  v_is_privileged boolean := false;
  v_has_stage boolean := false;
  v_rows integer := 0;
  v_note text;
begin
  select coalesce(cfs.quotation_loss_days, 3)
  into v_config_days
  from public.client_followup_settings cfs
  where cfs.id = 'default';

  v_days := greatest(coalesce(p_days, v_config_days, 3), 1);
  v_threshold := now() - make_interval(days => v_days);
  v_note := format('(%s dias sin respuesta negociacion perdida)', v_days);

  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) in ('admin', 'manager', 'jefe', 'administrativo')
  ) into v_is_privileged;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotations'
      and column_name = 'stage'
  ) into v_has_stage;

  if v_has_stage then
    execute
      'update public.quotations q
       set status = ''rejected'',
           stage = ''lost'',
           comments = case
             when coalesce(q.comments, '''') ilike ''%sin respuesta negociacion perdida%''
               then q.comments
             else trim(concat_ws(E''\n'', nullif(q.comments, ''''), $2))
           end
       where q.status = ''sent''
         and coalesce(q.sent_at, q.created_at) <= $1
         and not exists (
           select 1
           from public.orders o
           where o.quotation_id = q.id
         )
         and ($3 or q.seller_id = auth.uid())'
    using v_threshold, v_note, v_is_privileged;
  else
    update public.quotations q
    set status = 'rejected',
        comments = case
          when coalesce(q.comments, '') ilike '%sin respuesta negociacion perdida%'
            then q.comments
          else trim(concat_ws(E'\n', nullif(q.comments, ''), v_note))
        end
    where q.status = 'sent'
      and coalesce(q.sent_at, q.created_at) <= v_threshold
      and not exists (
        select 1
        from public.orders o
        where o.quotation_id = q.id
      )
      and (v_is_privileged or q.seller_id = auth.uid());
  end if;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.expire_stale_sent_quotations(integer) from public;
grant execute on function public.expire_stale_sent_quotations(integer) to authenticated;
