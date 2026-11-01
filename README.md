# mie-ferie — Dashboard Ferie & Permessi

Sito statico personale per tracciare ferie e permessi aziendali, replicando fedelmente le formule di un foglio Google Sheets. I goduti mensili e l'AP (Anno Precedente) sono salvati su **Supabase** per la sincronizzazione multi-dispositivo; la maturazione e i dati storici arrivano da CSV esportati dal foglio originale.

## Stack

- **Frontend**: HTML/CSS/JS vanilla (nessun build step, si apre direttamente `index.html`)
- **Backend/DB**: Supabase (Postgres) con tabelle `anni`, `ferie_mensili`, `anno_ap`, `maturazione_mensile`
- **Dati storici**: CSV in `data/` (esportati dal foglio Google, uno per anno) + script di importazione in Supabase

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
  ap_configurato boolean default false,
  updated_at timestamptz default now()
);

-- Anni disponibili (gestiti dal sito con il popup "Gestisci anni" )
create table if not exists anni (
  anno integer primary key,
  created_at timestamptz default now()
);

-- Maturazione mensile (importata dai CSV con scripts/load_maturation.js)
create table if not exists maturazione_mensile (
  anno integer not null,
  mese text not null,
  ferie_maturata numeric default 0,
  permessi_maturati numeric default 0,
  updated_at timestamptz default now(),
  primary key (anno, mese)
);

alter table ferie_mensili enable row level security;
alter table anno_ap enable row level security;
alter table anni enable row level security;
alter table maturazione_mensile enable row level security;
create policy "ferie_mensili_all" on ferie_mensili for all using (true);
create policy "anno_ap_all" on anno_ap for all using (true);
create policy "anni_all" on anni for all using (true);
create policy "maturazione_mensile_all" on maturazione_mensile for all using (true);
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
index.html          # UI (griglia, form, popup AP, popup anni, popup importazione)
style.css           # stile scuro "ledger"
app.js              # logica di calcolo, Supabase, popup
supabase-config.js  # URL e anon key Supabase
data/
  anni.json         # fallback legacy (il sito usa la tabella "anni" di Supabase)
  Mie Ferie - 2026.csv
  Mie Ferie - 2027.csv
  ...
scripts/
  load_maturation.js  # importa la maturazione dai CSV a Supabase (nessuna dipendenza)
  serve.js            # server statico minimo per test locali (node scripts/serve.js)
```

## Importare la maturazione dai CSV a Supabase

Lo script `scripts/load_maturation.js` legge tutti i file `data/Mie Ferie - YYYY.csv`,
estrae le righe di maturazione (ferie e permessi per i 12 mesi) e le inserisce nella
tabella `maturazione_mensile` (upsert, quindi rieseguibile senza duplicati). Inserisce
anche gli anni nella tabella `anni`, così appaiono subito nel sito.

Requisiti: **Node.js 18+** (nessun `npm install`, lo script usa solo moduli integrati).

```bash
cd mie-ferie
node scripts/load_maturation.js
```

Dopo l'importazione il sito legge la maturazione da Supabase; i CSV restano come
fallback/backward-compatibilità (e per i goduti storici).

## Aggiungere un nuovo anno

1. Tasto **⚙** nel sito (accanto al selettore anni) → **Aggiungi** l'anno. Viene salvato su Supabase e selezionato.
2. Imposta l'AP dal popup (verrà suggerito automaticamente il residuo dicembre dell'anno precedente, se disponibile).
3. Per la maturazione: esporta il foglio anno dal Google Sheet in CSV, salvalo come `data/Mie Ferie - <ANNO>.csv` ed esegui `node scripts/load_maturation.js` (oppure usa il popup **📁** nel sito per caricare il singolo CSV dall'interfaccia).

**Nuovi pulsanti nell'interfaccia:**
- **📁 Importa maturazione** – apre un popup per caricare un singolo CSV (`Mie Ferie - YYYY.csv`) direttamente dal sito.
- **💾 Esporta backup JSON** – scarica tutte le tabelle Supabase in un file JSON di backup locale.
- **📊 Report** – mostra il riepilogo dell'anno (maturato, goduti, residuo) e il confronto tra tutti gli anni, con stampa/PDF.
- **⚠️ Avviso soglia 20h** – banner rosso che appare quando il residuo totale (ferie + permessi) dell'ultimo mese scende sotto 20h.

## Test locali

I CSV vengono caricati con `fetch`, che su `file://` è bloccato dal browser. Per provare il sito in locale usa il server statico incluso:

```bash
cd mie-ferie
node scripts/serve.js 8765   # poi apri http://localhost:8765
```

(Nessuna dipendenza esterna.)

---

## Roadmap — idee di miglioramento

Di seguito le migliorie pianificate/proposte, in ordine di importanza:

### 1. Architettura: sostituire i CSV con Supabase ✅ (fatto)
Migrazione realizzata: la maturazione vive nella tabella `maturazione_mensile` ed è
importabile con `scripts/load_maturation.js` (o dal popup 📁 nel sito). Rimane da
valutare un eventuale pannello admin per modificare la maturazione direttamente da UI.
- i CSV non servono più dopo l'importazione (restano come backup)
- il Google Sheet diventa solo un backup

### 2. Gestione anni dinamica da Supabase ✅ (fatto)
La lista anni viene dalla tabella `anni`, gestibile dal sito con il pulsante ⚙
(popup "Gestisci anni" con Aggiungi/Rimuovi). `anni.json` resta solo come fallback.

### 3. Sistema di blocco AP più pulito ✅ (fatto)
La tabella `anno_ap` ha il campo `ap_configurato` (boolean). Il sito tratta l'AP come
bloccato solo quando `bloccato = true` **e** `ap_configurato = true`. Gli anni con AP
già salvato ma senza flag devono essere riconfermati dal popup "Imposta AP".
Eliminato il workaround "se bloccato ma a zero, tratto come non bloccato".

### 4. Rimuovere `codice.gs` e aggiungere README ✅ (fatto)
Il vecchio script Google Apps Script non è più utilizzato dato che il sito è standalone con Supabase + CSV. Rimosso. Questo README documenta setup e logica.

### 5. Sicurezza / RLS più restrittiva
- Policy RLS meno permissive (lettura pubblica, scrittura solo admin o via service role).
- Valutare di proteggere l'anon key (richiederebbe un backend proxy).

### 6. Report / riepilogo annuale ✅ (fatto)
Pulsante **📊** nel sito: apre una sezione "Report" con
- card riepilogo dell'anno selezionato (maturato totale, goduti totale, residuo finale con AP)
- tabella di **confronto tra tutti gli anni** (maturato, goduti, AP, residuo finale) con l'anno selezionato evidenziato e residui sotto 20h in rosso
- pulsante **🖨 Stampa / PDF** che usa le stampe del browser (con CSS dedicato `@media print` che isola solo il report).

### 7. Notifiche / soglie residuo ✅ (fatto)
Banner persistente rosso (`#sogliaAlert`) quando il residuo totale (ferie + permessi)
dell'ultimo mese scende sotto **20h totali**.

### 8. Storico modifiche goduti
Tabella `storico_goduti` che registra ogni modifica (data, mese, valore precedente, nuovo valore) per risolvere discrepanze.

### 9. Responsive mobile ✅ (fatto)
Layout mobile-first sotto i 700px: la tabella diventa **card stacking** (una riga = una card con etichette `data-label`), titolo fluido con `clamp()`, colonna di input a riga singola, touch target 44px sui dispositivi touch.

### 10. Export backup dati Supabase ✅ (fatto)
Pulsante **💾** accanto al selettore anni: esporta tutte le tabelle Supabase
(`anni`, `ferie_mensili`, `anno_ap`, `maturazione_mensile`) in un file JSON
con data nel nome (`mie-ferie-backup-YYYY-MM-DD.json`).
