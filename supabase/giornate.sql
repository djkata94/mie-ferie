-- Goduti per giorno (data, ore di ferie e/o permessi, nota) di mie-ferie.
-- Il totale del mese in ferie_mensili viene RICALCOLATO da un trigger come somma
-- delle giornate: griglia, report e storico_goduti continuano a funzionare uguali.
-- Un mese che aveva già un totale senza dettaglio: alla prima giornata il sito crea
-- una voce "riporto" con quel totale (riporto = true), così non si perde nulla.
--
-- Da lanciare nel SQL Editor di Supabase (progetto travel-OS) dopo rls.sql e storico.sql.
-- Sostituisci 00000000-0000-0000-0000-000000000000 con lo UUID del proprietario. Rieseguibile.

create table if not exists goduti_giornalieri (
  id bigint generated always as identity primary key,
  data date not null,
  ferie_ore numeric not null default 0,
  permessi_ore numeric not null default 0,
  nota text,
  riporto boolean not null default false,  -- totale del mese registrato prima del dettaglio giornaliero
  created_at timestamptz not null default now(),
  constraint giornata_ore_valide check (
    ferie_ore >= 0 and permessi_ore >= 0
    and (ferie_ore > 0 or permessi_ore > 0)
    and (riporto or (ferie_ore <= 24 and permessi_ore <= 24))
    and ferie_ore <= 200 and permessi_ore <= 200
  ),
  constraint giornata_nota_breve check (nota is null or char_length(nota) <= 200)
);

create index if not exists goduti_giornalieri_data on goduti_giornalieri (data);

-- Ricalcola il totale del mese di p_data in ferie_mensili (0 se non resta nessuna giornata)
create or replace function ricalcola_goduti_mese(p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inizio date := date_trunc('month', p_data)::date;
  v_mese text := (array['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO',
                        'AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'])[extract(month from p_data)::int];
  v_ferie numeric;
  v_permessi numeric;
begin
  select coalesce(sum(ferie_ore), 0), coalesce(sum(permessi_ore), 0)
    into v_ferie, v_permessi
    from goduti_giornalieri
   where data >= v_inizio and data < (v_inizio + interval '1 month');

  insert into ferie_mensili (anno, mese, ferie_ore, permessi_ore, updated_at)
  values (extract(year from p_data)::int, v_mese, v_ferie, v_permessi, now())
  on conflict (anno, mese) do update
    set ferie_ore = excluded.ferie_ore,
        permessi_ore = excluded.permessi_ore,
        updated_at = now();
end;
$$;

-- IMPORTANTE: la funzione scavalca RLS (security definer), quindi NON deve essere
-- richiamabile dall'API (/rest/v1/rpc): la usa solo il trigger qui sotto.
revoke execute on function ricalcola_goduti_mese(date) from public, anon, authenticated;

create or replace function goduti_giornalieri_aggiorna_mese()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform ricalcola_goduti_mese(new.data);
  elsif tg_op = 'DELETE' then
    perform ricalcola_goduti_mese(old.data);
  else
    perform ricalcola_goduti_mese(old.data);
    if date_trunc('month', new.data) <> date_trunc('month', old.data) then
      perform ricalcola_goduti_mese(new.data);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists goduti_giornalieri_trg on goduti_giornalieri;
create trigger goduti_giornalieri_trg
  after insert or update or delete on goduti_giornalieri
  for each row execute function goduti_giornalieri_aggiorna_mese();

alter table goduti_giornalieri enable row level security;
drop policy if exists "solo_owner" on goduti_giornalieri;
create policy "solo_owner" on goduti_giornalieri for all to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000')
  with check (auth.uid() = '00000000-0000-0000-0000-000000000000');

-- Verifica: policy, trigger e funzione NON eseguibile da anon/authenticated (devono uscire false)
select policyname, roles, cmd from pg_policies where tablename = 'goduti_giornalieri';
select tgname from pg_trigger where tgrelid = 'public.goduti_giornalieri'::regclass and not tgisinternal;
select has_function_privilege('anon', 'ricalcola_goduti_mese(date)', 'execute') as anon_puo_eseguire,
       has_function_privilege('authenticated', 'ricalcola_goduti_mese(date)', 'execute') as utenti_possono_eseguire;
