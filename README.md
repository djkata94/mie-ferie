# mie-ferie — Dashboard Ferie & Permessi

Sito statico personale per tracciare ferie e permessi aziendali, replicando fedelmente le formule di un foglio Google Sheets. Tutti i dati (maturazione, goduti mensili, AP) stanno su **Supabase**, protetti da login e regole RLS: il sito pubblico mostra solo il riquadro di accesso.

## Stack

- **Frontend**: HTML/CSS/JS vanilla (nessun build step)
- **Backend/DB**: Supabase (Postgres + Auth) con tabelle `anni`, `ferie_mensili`, `anno_ap`, `maturazione_mensile`
- **CSV del foglio Google**: solo in locale (`data/*.csv` è in `.gitignore`), usati una tantum dagli script di importazione

## Sicurezza

- La chiave anon in `supabase-config.js` è pubblica per natura (sito statico): da sola non dà accesso a nulla.
- Le policy RLS (`supabase/rls.sql`) concedono lettura e scrittura solo all'utente proprietario (`auth.uid()`), ruolo `authenticated`. Le registrazioni pubbliche sono disattivate.
- Gli script di importazione usano la **service role key** passata con la variabile `SUPABASE_SERVICE_KEY`: non va mai scritta nella repo.
- I CSV con i dati personali non sono più versionati né pubblicati.

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

```

3. **Authentication → Users → Add user**: crea il tuo utente (email + password).
   **Authentication → Sign In / Providers**: disattiva "Allow new users to sign up".
4. Apri `supabase/rls.sql`, sostituisci lo UUID segnaposto con quello del tuo utente ed eseguilo nel SQL Editor.
5. Inserisci URL e anon key in `supabase-config.js`.

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

L'AP di ogni anno sta nella tabella `anno_ap` e vale solo se `bloccato = true` e `ap_configurato = true`. Se manca:

- Appare una **barra AP** con bottone "Imposta AP".
- Si apre un **popup** con due campi (Ferie AP, Permessi AP), **precompilati** con il residuo reale di dicembre dell'anno precedente, calcolato dai dati su Supabase (stesso calcolo della griglia).
- Dopo **"Conferma e blocca"**, i valori vengono salvati su Supabase (`anno_ap`) e bloccati.

## Struttura file

```
index.html          # UI (login, griglia, form, popup, report, storico)
style.css           # stile scuro "ledger"
logica.js           # calcoli puri (residui, suggerimento AP, validazione, errori): sito + test + script
app.js              # login, Supabase, interfaccia; errori gestiti in segnalaErrore()
supabase-config.js  # URL e anon key Supabase
favicon.svg, manifest.webmanifest  # icona vettoriale e installazione come app
icons/              # favicon.ico, PNG per iPhone (180) e Android (192, 512, maskable): node scripts/genera_icone.js
package.json        # solo gli script npm test / npm run serve (nessuna dipendenza)
supabase/
  rls.sql           # policy RLS "solo proprietario"
  storico.sql       # tabella storico_goduti + trigger su ferie_mensili
  giornate.sql      # tabella goduti_giornalieri + trigger che ricalcola il totale del mese
tests/
  logica.test.js    # test dei calcoli con i valori del foglio 2026
data/
  Mie Ferie - YYYY.csv  # SOLO in locale, ignorati da git
scripts/
  lib.js              # upsert REST con service key (parser CSV preso da logica.js)
  load_maturation.js  # importa la maturazione dai CSV a Supabase
  import_goduti.js    # importa goduti e AP di un anno da CSV a Supabase
  serve.js            # server statico minimo per test locali (node scripts/serve.js)
  genera_icone.js     # rigenera le icone PNG/ICO dal disegno del calendario (zero dipendenze)
```

## Importare i CSV in Supabase

Requisiti: **Node.js 22+** (nessun `npm install`) e la **service role key** di Supabase
(Project Settings → API) nella variabile `SUPABASE_SERVICE_KEY`. I CSV vanno messi in
`data/` (restano fuori da git).

```powershell
$env:SUPABASE_SERVICE_KEY = "<service role key>"
node scripts/load_maturation.js            # maturazione di tutti gli anni in data/
node scripts/import_goduti.js 2026 --dry-run   # mostra goduti e AP che verrebbero scritti
node scripts/import_goduti.js 2026         # scrive goduti (ferie_mensili) e AP (anno_ap)
```

Entrambi fanno upsert, quindi sono rieseguibili. `import_goduti.js` salta i mesi con
entrambe le celle vuote e non tocca l'AP se la colonna B del CSV è vuota.

## Registrare i goduti

- Scegli il mese nel form (o clicca la sua riga nella griglia): i campi mostrano le ore già salvate.
- Un campo lasciato **vuoto** non viene modificato; per azzerare scrivi **0**.
- Se il salvataggio cambia un valore già registrato (diverso da 0) il sito chiede conferma mostrando il prima → dopo.
- Valori ammessi: da 0 a 200 ore al mese.

### Dettaglio giornaliero

Sotto il form c'è il pannello **Giornate** del mese selezionato: data, ore di ferie e/o permessi
(massimo 24 al giorno) e una nota. Il totale del mese lo ricalcola un trigger su Supabase come somma
delle giornate (`supabase/giornate.sql`), quindi griglia, report e storico restano coerenti.

- Se il mese aveva già un totale registrato senza dettaglio, alla prima giornata il sito chiede di
  tenerlo come voce di **riporto** (datata il 1° del mese), così non si perde nulla.
- Un mese con il dettaglio giornaliero non si modifica più dal form del totale: si aggiungono o
  eliminano giornate.
- Finché `giornate.sql` non è stato lanciato il pannello lo segnala e il resto funziona come prima.

## Aggiungere un nuovo anno

1. Tasto **⚙** nel sito (accanto al selettore anni) → **Aggiungi** l'anno. Viene salvato su Supabase e selezionato.
2. Imposta l'AP con il bottone **Imposta AP** della barra (il popup si apre da solo solo per l'anno in corso), precompilato con il residuo di dicembre dell'anno precedente.
3. Per la maturazione: esporta il foglio anno dal Google Sheet in CSV, salvalo come `data/Mie Ferie - <ANNO>.csv` ed esegui `node scripts/load_maturation.js` (oppure usa il popup **📁** nel sito per caricare il singolo CSV dall'interfaccia).

**Nuovi pulsanti nell'interfaccia:**
- **📁 Importa maturazione** – apre un popup per caricare un singolo CSV (`Mie Ferie - YYYY.csv`) direttamente dal sito.
- **💾 Esporta backup JSON** – scarica tutte le tabelle Supabase in un file JSON di backup locale.
- **📊 Report** – mostra il riepilogo dell'anno (maturato, goduti, residuo) e il confronto tra tutti gli anni, con stampa/PDF.
- **🕘 Storico** – elenco delle modifiche ai goduti dell'anno (quando, mese, prima → dopo). Serve `supabase/storico.sql`.
- **⚠️ Avviso soglia 20h** – banner rosso che appare quando il residuo totale (ferie + permessi) dell'ultimo mese scende sotto 20h.

## Icone e installazione

- **Preferiti e schede**: `icons/favicon.ico` (16/32/48 px) più `favicon.svg` per i browser moderni.
- **iPhone/iPad** (Condividi → Aggiungi alla schermata Home): `icons/apple-touch-icon.png`.
- **Android** (Chrome → Installa app / Aggiungi a schermata Home): icone 192 e 512 del manifest,
  più la versione *maskable* per le icone adattive.

Si rigenerano tutte con `node scripts/genera_icone.js`.

## Test

I calcoli stanno in `logica.js` e sono coperti da test Node senza dipendenze, che usano
come riferimento i valori del foglio Google 2026 (residui mese per mese, O9/O10, suggerimento AP,
salvataggio che non azzera i campi vuoti, riconoscimento degli errori):

```bash
npm test
```

Per provare il sito in locale (serve comunque il login):

```bash
npm run serve   # poi apri http://localhost:8765
```

## Errori

Tutte le chiamate a Supabase passano da `query()` (aggiunge il contesto) e gli errori arrivano
a un solo punto, `segnalaErrore()`, che scrive il dettaglio in console e mostra un messaggio in
italiano: rete assente o lenta (timeout 15 s), sessione scaduta (torna al login), permessi
negati (RLS), tabella mancante. Se la lettura fallisce la griglia resta vuota: niente residui
parziali e niente popup AP aperto per errore.

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
(popup "Gestisci anni" con Aggiungi/Rimuovi). Togliere un anno lo nasconde dalla lista ma non cancella goduti, AP e maturazione.

### 3. Sistema di blocco AP più pulito ✅ (fatto)
La tabella `anno_ap` ha il campo `ap_configurato` (boolean). Il sito tratta l'AP come
bloccato solo quando `bloccato = true` **e** `ap_configurato = true`. Gli anni con AP
già salvato ma senza flag devono essere riconfermati dal popup "Imposta AP".
Eliminato il workaround "se bloccato ma a zero, tratto come non bloccato".

### 4. Rimuovere `codice.gs` e aggiungere README ✅ (fatto)
Il vecchio script Google Apps Script non è più utilizzato dato che il sito è standalone con Supabase + CSV. Rimosso. Questo README documenta setup e logica.

### 5. Sicurezza / RLS più restrittiva ✅ (fatto)
Login con Supabase Auth, policy RLS solo per l'utente proprietario (`supabase/rls.sql`),
script di importazione con service role key da variabile d'ambiente, CSV personali
tolti da repo e sito.

### 6. Report / riepilogo annuale ✅ (fatto)
Pulsante **📊** nel sito: apre una sezione "Report" con
- card riepilogo dell'anno selezionato (maturato totale, goduti totale, residuo finale con AP)
- tabella di **confronto tra tutti gli anni** (maturato, goduti, AP, residuo finale) con l'anno selezionato evidenziato e residui sotto 20h in rosso
- pulsante **🖨 Stampa / PDF** che usa le stampe del browser (con CSS dedicato `@media print` che isola solo il report).

### 7. Notifiche / soglie residuo ✅ (fatto)
Banner persistente rosso (`#sogliaAlert`) quando il residuo totale (ferie + permessi)
dell'ultimo mese scende sotto **20h totali**.

### 8. Storico modifiche goduti ✅ (fatto)
Tabella `storico_goduti` scritta da un trigger su `ferie_mensili` (`supabase/storico.sql`):
ogni inserimento, modifica o cancellazione con valori prima/dopo e data. Il sito la legge
con il bottone 🕘 e non può modificarla.

### 9. Responsive mobile ✅ (fatto)
Layout mobile-first sotto i 700px: la tabella diventa **card stacking** (una riga = una card con etichette `data-label`), titolo fluido con `clamp()`, colonna di input a riga singola, touch target 44px sui dispositivi touch.

### 10. Export backup dati Supabase ✅ (fatto)
Pulsante **💾** accanto al selettore anni: esporta tutte le tabelle Supabase
(`anni`, `ferie_mensili`, `anno_ap`, `maturazione_mensile`) in un file JSON
con data nel nome (`mie-ferie-backup-YYYY-MM-DD.json`).
