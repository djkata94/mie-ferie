# mie-ferie — Dashboard Ferie & Permessi

Sito statico personale per tracciare ferie e permessi aziendali, replicando fedelmente le formule di un foglio Google Sheets. I goduti mensili e l'AP (Anno Precedente) sono salvati su **Supabase** per la sincronizzazione multi-dispositivo; la maturazione e i dati storici arrivano da CSV esportati dal foglio originale.

## Stack

- **Frontend**: HTML/CSS/JS vanilla (nessun build step, si apre direttamente `index.html`)
- **Backend/DB**: Supabase (Postgres) con tabelle `ferie_mensili` e `anno_ap`
- **Dati storici**: CSV in `data/` (esportati dal foglio Google, uno per anno)

## Setup Supabase

1. Crea un progetto Supabase.
2. Crea le tabelle seguenti nell'editor SQL:

```sql
-- Goduti mensili (ferie/permessi goduti per mese/anno)
create table if not exists ferie_mensili (
  anno integer not null,
  mese text not null,
  ferie_ore numeric default 0,
  permessi_ore numeric default 0,
  updated_at timestamptz default now(),
  primary key (anno, mese)
);

-- AP (Anno Precedente): valori di partenza bloccabili da sito
create table if not exists anno_ap (
  anno integer primary key,
  ap_ferie numeric default 0,
  ap_permessi numeric default 0,
  bloccato boolean default false,
  updated_at timestamptz default now()
);

alter table ferie_mensili enable row level security;
alter table anno_ap enable row level security;
create policy "ferie_mensili_all" on ferie_mensili for all using (true);
create policy "anno_ap_all" on anno_ap for all using (true);
```

3. Inserisci URL e anon key in `supabase-config.js`.

## Logica di calcolo (replica del foglio Google)

Il sito replica esattamente le formule del foglio Google originale, foglio per anno (2026, 2027, …):

| Cella foglio | Formula | Significato |
|---|---|---|
| `C7` | `=SUM(B2:C2)+SUM(B3:C3)-C5-C6` | Residuo gennaio = (AP ferie + mat. gennaio) + (AP permessi + mat. gennaio) - goduti gennaio |
| `D7` | `=C7+SUM(D2:D3)-D5-D6` | Residuo febbraio = residuo gennaio + maturazione - goduto |
| … | … | stesso schema per ogni mese fino a `N7` (dicembre) |
| `O9` | `=O2-O5` | Ferie residue teoriche (totale maturate - totale godute) |
| `O10` | `=O3-O6` | Permessi residue teorici (totale maturati - totale goduti) |
| `O12` | `=O9+O10` | Totalone (residuo finale combinato) |

Nel sito le ferie e i permessi vengono tenuti separati (`resF`, `resP`) e la colonna "Totale Residuo" mostra la loro somma, che coincide con `C7`, `D7`, ecc.

## AP (Anno Precedente)

Per gli anni in cui `B2`/`B3` del CSV sono vuoti (es. 2027+), l'AP va impostato **da sito**:

- Appare una **barra AP** con bottone "Imposta AP".
- Si apre un **popup** con due campi (Ferie AP, Permessi AP), **precompilati** con il residuo di dicembre dell'anno precedente (letto automaticamente dalle celle "FERIE RESIDUE TEORICA" / "PERMESSI RESIDUI TEORICI" del CSV precedente).
- Dopo **"Conferma e blocca"**, i valori vengono salvati su Supabase (`anno_ap`) e bloccati: non si modificano più.
- Se l'AP è "bloccato ma a zero", viene trattato come non bloccato per permetterne l'impostazione.

## Struttura file

```
index.html          # UI (griglia, form, popup AP)
style.css           # stile scuro "ledger"
app.js              # logica di calcolo, Supabase, popup AP
supabase-config.js  # URL e anon key Supabase
data/
  anni.json         # lista anni disponibili (da aggiornare manualmente)
  Mie Ferie - 2026.csv
  Mie Ferie - 2027.csv
  ...
```

## Aggiungere un nuovo anno

1. Esporta il nuovo foglio anno dal Google Sheet in CSV (`File > Scarica > Valori separati da virgola`).
2. Salvalo in `data/` come `Mie Ferie - <ANNO>.csv`.
3. Aggiungi l'anno a `data/anni.json`.
4. Fai commit/push.
5. Apri il sito, seleziona il nuovo anno e imposta l'AP dal popup (verrà suggerito automaticamente il residuo dicembre dell'anno precedente).

---

## Roadmap — idee di miglioramento

Di seguito le migliorie pianificate/proposte, in ordine di importanza:

### 1. Architettura: sostituire i CSV con Supabase ⭐ (priorità alta)
Migrare anche la maturazione (righe ferie/permessi dei CSV) su Supabase e aggiungere un pannello admin da sito per inserire i valori di maturazione per mese/anno. A quel punto:
- non servono più CSV esportati a mano
- non serve più il Google Sheet (o diventa solo un backup)
- aggiungere un anno diventa una voce di menu, non un commit

**SQL Supabase per `maturazione_mensile` (nuova tabella):**
```sql
create table if not exists maturazione_mensile (
  anno integer not null,
  mese text not null,
  ferie_maturata numeric default 0,
  permessi_maturati numeric default 0,
  updated_at timestamptz default now(),
  primary key (anno, mese)
);
alter table maturazione_mensile enable row level security;
create policy "maturazione_mensile_all" on maturazione_mensile for all using (true);
```

**Aggiornare la tabella `anno_ap` per aggiungere un flag `ap_configurato`:**
```sql
-- Aggiungere la colonna se non esiste (esegui una sola volta)
ALTER TABLE IF EXISTS anno_ap ADD COLUMN ap_configurato boolean default false;
```

**Note:** dopo questa modifica, l'AP di un anno sarà trattato come "non configurato" finché `ap_configurato = false`. Quando l'utente imposta AP dal popup, lo script imposta `bloccato = true` **e** `ap_configurato = true`.

### 2. Gestione anni dinamica da Supabase ⭐ (priorità alta)
Derivare la lista degli anni da Supabase (es. `select distinct anno`) oppure tabella `anni` gestibile da sito. Elimina la modifica manuale di `anni.json`. Con un bottone "＋ Nuovo anno" si apre direttamente il popup AP.

### 3. Sistema di blocco AP più pulito
Aggiungere un campo esplicito `ap_configurato` (boolean) separato dai valori, per eliminare l'attuale workaround "se bloccato ma zero, tratto come non bloccato".

### 4. Rimuovere `codice.gs` e aggiungere README ✅ (fatto)
Il vecchio script Google Apps Script non è più utilizzato dato che il sito è standalone con Supabase + CSV. Rimosso. Questo README documenta setup e logica.

### 5. Sicurezza / RLS più restrittiva
- Policy RLS meno permissive (lettura pubblica, scrittura solo admin o via service role).
- Valutare di proteggere l'anon key (richiederebbe un backend proxy).

### 6. Report / riepilogo annuale
Pagina o sezione con:
- totale goduti vs totale maturato
- residuo attuale
- confronto tra anni (tabella o grafico)
- esportazione in PDF/stampa

### 7. Notifiche / soglie residuo
Banner o badge quando il residuo scende sotto una soglia configurabile (es. 40h), oppure promemoria per usare i giorni prima di eventuali scadenze.

### 8. Storico modifiche goduti
Tabella `storico_goduti` che registra ogni modifica (data, mese, valore precedente, nuovo valore) per risolvere discrepanze.

### 9. Responsive mobile
Migliorare il layout su smartphone: la tabella con `min-width: 650px` diventa scadente. Valutare card stacking o colonne ridotte sotto i 700px.

### 10. Export backup dati Supabase
Pulsante per esportare tutti i dati (`ferie_mensili` + `anno_ap`) in JSON, così da avere un backup locale indipendente da Supabase.
