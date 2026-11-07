-- Impostazioni personali di mie-ferie (una riga per utente): orario di lavoro per
-- calcolare i permessi dagli orari di entrata/uscita e formato delle ore (decimale o h:mm).
-- Su Supabase, così telefono e PC usano gli stessi valori. Rieseguibile.
-- Applicata come migrazione "mie_ferie_impostazioni" il 07/11/2026.

create table if not exists ferie_impostazioni (
  utente uuid primary key default auth.uid(),
  inizio_turno time not null default '09:00',
  fine_turno time not null default '18:30',
  pausa_inizio time,                       -- facoltativa: le ore di pausa non contano come permesso
  pausa_fine time,
  formato_ore text not null default 'decimale',
  updated_at timestamptz not null default now(),
  constraint turno_valido check (fine_turno > inizio_turno),
  constraint pausa_valida check (
    (pausa_inizio is null and pausa_fine is null)
    or (pausa_inizio is not null and pausa_fine is not null
        and pausa_fine > pausa_inizio
        and pausa_inizio >= inizio_turno and pausa_fine <= fine_turno)
  ),
  constraint formato_valido check (formato_ore in ('decimale', 'hhmm'))
);

alter table ferie_impostazioni enable row level security;
drop policy if exists "solo_owner" on ferie_impostazioni;
-- (select auth.uid()): valutato una volta per query e non per riga (advisor auth_rls_initplan)
create policy "solo_owner" on ferie_impostazioni for all to authenticated
  using ((select auth.uid()) = '23839773-79af-4262-aaa5-c91fe42e5991' and utente = (select auth.uid()))
  with check ((select auth.uid()) = '23839773-79af-4262-aaa5-c91fe42e5991' and utente = (select auth.uid()));
