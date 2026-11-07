-- Regole RLS di mie-ferie: i dati sono accessibili SOLO all'utente proprietario.
-- Da lanciare nel SQL Editor di Supabase DOPO aver creato l'utente
-- (Authentication → Users → Add user) e aver disattivato le registrazioni
-- (Authentication → Sign In / Providers → "Allow new users to sign up" spento).
--
-- 1. Sostituisci TUTTE le occorrenze di 00000000-0000-0000-0000-000000000000
--    con lo UUID dell'utente (colonna "UID" in Authentication → Users).
-- 2. Esegui tutto lo script. È rieseguibile.

-- Via QUALSIASI altra policy su queste 4 tabelle, qualunque nome abbia
-- (le policy sono in OR: ne basta una aperta per lasciare passare tutti).
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('anni', 'ferie_mensili', 'anno_ap', 'maturazione_mensile')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

drop policy if exists "solo_owner" on ferie_mensili;
drop policy if exists "solo_owner" on anno_ap;
drop policy if exists "solo_owner" on anni;
drop policy if exists "solo_owner" on maturazione_mensile;

alter table ferie_mensili enable row level security;
alter table anno_ap enable row level security;
alter table anni enable row level security;
alter table maturazione_mensile enable row level security;

create policy "solo_owner" on ferie_mensili for all to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000')
  with check (auth.uid() = '00000000-0000-0000-0000-000000000000');

create policy "solo_owner" on anno_ap for all to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000')
  with check (auth.uid() = '00000000-0000-0000-0000-000000000000');

create policy "solo_owner" on anni for all to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000')
  with check (auth.uid() = '00000000-0000-0000-0000-000000000000');

create policy "solo_owner" on maturazione_mensile for all to authenticated
  using (auth.uid() = '00000000-0000-0000-0000-000000000000')
  with check (auth.uid() = '00000000-0000-0000-0000-000000000000');

-- Verifica: devono comparire solo le 4 policy "solo_owner", ruolo {authenticated},
-- e rls_attivo = true su tutte e 4 le tabelle
select c.relname as tabella, c.relrowsecurity as rls_attivo, p.policyname, p.roles, p.cmd
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('anni', 'ferie_mensili', 'anno_ap', 'maturazione_mensile')
order by c.relname;
