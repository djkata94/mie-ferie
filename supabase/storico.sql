-- Storico delle modifiche ai goduti (ferie_mensili) di mie-ferie.
-- Ogni inserimento, modifica o cancellazione di un mese viene registrata da un
-- trigger nel database: non dipende dal sito, quindi vale anche per gli script.
-- Il sito può solo LEGGERE lo storico (bottone 🕘), non scriverlo né cancellarlo.
--
-- Da lanciare nel SQL Editor di Supabase (progetto travel-OS) dopo rls.sql.
-- Sostituisci 00000000-0000-0000-0000-000000000000 con lo UUID del proprietario. Rieseguibile.

create table if not exists storico_goduti (
  id bigint generated always as identity primary key,
  anno integer not null,
  mese text not null,
  operazione text not null,            -- INSERT | UPDATE | DELETE
  ferie_prima numeric,
  permessi_prima numeric,
  ferie_dopo numeric,
  permessi_dopo numeric,
  utente uuid,                         -- auth.uid() di chi ha fatto la modifica (null = script con service key)
  quando timestamptz not null default now()
);

create index if not exists storico_goduti_anno_quando on storico_goduti (anno, quando desc);

-- security definer: il trigger scrive nello storico anche se l'utente non ha
-- alcun permesso di scrittura su quella tabella.
create or replace function registra_storico_goduti()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into storico_goduti (anno, mese, operazione, ferie_prima, permessi_prima, utente)
    values (old.anno, old.mese, tg_op, old.ferie_ore, old.permessi_ore, auth.uid());
    return old;
  elsif tg_op = 'INSERT' then
    insert into storico_goduti (anno, mese, operazione, ferie_dopo, permessi_dopo, utente)
    values (new.anno, new.mese, tg_op, new.ferie_ore, new.permessi_ore, auth.uid());
  else
    -- UPDATE che non cambia le ore (es. solo updated_at): niente riga di storico
    if new.ferie_ore is not distinct from old.ferie_ore
       and new.permessi_ore is not distinct from old.permessi_ore then
      return new;
    end if;
    insert into storico_goduti (anno, mese, operazione, ferie_prima, permessi_prima, ferie_dopo, permessi_dopo, utente)
    values (new.anno, new.mese, tg_op, old.ferie_ore, old.permessi_ore, new.ferie_ore, new.permessi_ore, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists storico_goduti_trg on ferie_mensili;
create trigger storico_goduti_trg
  after insert or update or delete on ferie_mensili
  for each row execute function registra_storico_goduti();

-- Lettura solo per il proprietario; nessuna policy di scrittura = il sito non può
-- modificare o cancellare lo storico.
alter table storico_goduti enable row level security;
drop policy if exists "solo_owner_lettura" on storico_goduti;
create policy "solo_owner_lettura" on storico_goduti for select to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000');
revoke insert, update, delete on storico_goduti from anon, authenticated;

-- Verifica: trigger presente e policy di sola lettura
select tgname from pg_trigger where tgrelid = 'public.ferie_mensili'::regclass and not tgisinternal;
select policyname, roles, cmd from pg_policies where tablename = 'storico_goduti';
