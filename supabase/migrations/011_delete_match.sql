begin;
-- No ejecuta borrados al aplicar la migración. Solo habilita la operación explícita.
create function public.delete_match(p_match_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; previous_context text;
begin
  select * into m from public.matches where id=p_match_id for update;
  if not found then return; end if; -- Reintento de una eliminación confirmada.
  if m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El partido cambió. Espera la actualización automática y confirma de nuevo.';
  end if;
  -- Coordina la operación con creación de cruces/cierre de esta categoría.
  perform 1 from public.categories where id=m.category_id for update;
  previous_context:=current_setting('copa.deleting_match',true);
  perform set_config('copa.deleting_match',m.id::text,true);
  delete from public.match_events where match_id=m.id;
  delete from public.matches where id=m.id;
  perform set_config('copa.deleting_match',coalesce(previous_context,''),true);
end $$;

-- La anulación individual sigue usando voided_at. Solo la RPC propietaria puede
-- eliminar eventos físicamente, y exclusivamente del partido indicado.
create or replace function public.prevent_goal_delete() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user = pg_get_userbyid((select proowner from pg_proc
      where oid='public.delete_match(uuid,timestamptz)'::regprocedure))
    and current_setting('copa.deleting_match',true)=old.match_id::text then
    return old;
  end if;
  raise exception 'Los goles se anulan mediante voided_at; solo se eliminan al borrar su partido';
end $$;
revoke all on function public.delete_match(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.delete_match(uuid,timestamptz) to anon;
commit;
