-- Public aggregate availability for catalog badges; no copy or reader details.
begin;
create or replace function sora_v2.catalog_book_statuses()
returns table (book_id integer, status text, available_copies integer)
language sql stable security definer set search_path = '' as $$
  select b.book_id,
    case
      when count(c.copy_id) filter (where c.copy_status = 'In-Shelf') > 0 then 'In Shelf'
      when count(c.copy_id) filter (where c.copy_status = 'With Reader') > 0 then 'With Reader'
      when count(c.copy_id) filter (where c.copy_status = 'On Hold') > 0 then 'On Hold'
      when count(c.copy_id) filter (where c.copy_status = 'In Return Cart') > 0 then 'Return Cart'
      when count(c.copy_id) filter (where c.copy_status = 'Damaged') > 0 then 'Damaged'
      else 'Ask Staff'
    end,
    count(c.copy_id) filter (where c.copy_status = 'In-Shelf')::integer
  from sora_v2.books b left join sora_v2.book_copies c on c.book_id = b.book_id
  group by b.book_id;
$$;
revoke all on function sora_v2.catalog_book_statuses() from public, anon, authenticated;
grant execute on function sora_v2.catalog_book_statuses() to anon, authenticated;
commit;
