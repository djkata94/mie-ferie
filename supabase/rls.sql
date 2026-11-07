-- Regole RLS di mie-ferie: i dati sono accessibili SOLO all'utente proprietario.
-- Da lanciare nel SQL Editor di Supabase DOPO aver creato l'utente
-- (Authentication → Users → Add user) e aver disattivato le registrazioni
-- (Authentication → Sign In / Providers → "Allow new users to sign up" spento).
--
-- 1. Sostituisci TUTTE le occorrenze di 00000000-0000-0000-0000-000000000000
--    con lo UUID dell'utente (colonna "UID" in Authentication → Users).
-- 2. Esegui tutto lo script. È rieseguibile.

-- Via le vecchie policy aperte a tutti ("for all using (true)")
drop policy if exists "ferie_mensili_all" on ferie_mensili;
drop policy if exists "anno_ap_all" on anno_ap;
drop policy if exists "anni_all" on anni;
drop policy if exists "maturazione_mensile_all" on maturazione_mensile;

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

-- Verifica: devono comparire solo le 4 policy "solo_owner", ruolo {authenticated}
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename;
