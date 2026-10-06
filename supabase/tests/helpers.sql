-- Assertion helpers for the database tests. Each check raises an exception on failure.
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- Raises unless the statement fails with a message containing the expected text.
create function pg_temp.check_refused(stmt text, expected text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: expected refusal containing "%"', expected;
exception when others then
  if sqlerrm like 'FAILED:%' or position(expected in sqlerrm) = 0 then
    raise exception 'FAILED: expected "%", got "%"', expected, sqlerrm;
  end if;
end $$;
