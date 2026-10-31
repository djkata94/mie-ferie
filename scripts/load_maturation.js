// Importa la maturazione dai CSV di data/ nella tabella Supabase "maturazione_mensile".
// Nessuna dipendenza esterna: usa fetch (integrato in Node 18+).
//
// Uso:  node scripts/load_maturation.js

const fs = require('fs');
const path = require('path');

// Configurazione Supabase (stessi valori di supabase-config.js)
const SUPABASE_URL = 'https://esfaugsdnmxhkyozaezm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZmF1Z3Nkbm14aGt5b3phZXptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzE4MTgsImV4cCI6MjEwNTc0NzgxOH0.dW8zmH1Usiy125svefhAWl4GpJ93evJcUq0SPT9KW-M';

const MATURAZIONE_TABLE = 'maturazione_mensile';
const ANNI_TABLE = 'anni';
const MESI = ['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO','AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'];

// Chiamata REST a Supabase (PostgREST)
async function supabaseRequest(table, rows, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}` +
    (onConflict ? `?on_conflict=${onConflict}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const testo = await res.text();
    throw new Error(`Supabase ha risposto ${res.status} per "${table}": ${testo}`);
  }
  return res.json().catch(() => null);
}

// Parser CSV (gestisce campi tra virgolette e valori numerici con virgola)
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const row = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let field = '';
        while (i < line.length && line[i] !== '"') {
          field += line[i];
          i++;
        }
        i++;
        row.push(field);
        if (i < line.length && line[i] === ',') i++;
      } else {
        let field = '';
        while (i < line.length && line[i] !== ',') {
          field += line[i];
          i++;
        }
        row.push(field);
        if (i < line.length && line[i] === ',') i++;
      }
    }
    rows.push(row);
  }
  return rows;
}

function parseNumber(str) {
  if (str === undefined || str === null) return 0;
  const s = String(str).trim();
  if (s === '' || s === '-') return 0;
  return parseFloat(s.replace(',', '.')) || 0;
}

async function importaMaturation(anno) {
  const csvPath = path.join(__dirname, '..', 'data', `Mie Ferie - ${anno}.csv`);
  const testo = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(testo);
  // Righe 2 e 3 (indici 1,2): maturazione ferie/permessi per mese (colonne C..N = indici 2..13)
  const rowFerie = rows[1] || [];
  const rowPermessi = rows[2] || [];

  const upsertRows = [];
  let totF = 0, totP = 0;
  for (let i = 0; i < 12; i++) {
    const col = i + 2;
    const f = parseNumber(rowFerie[col]);
    const p = parseNumber(rowPermessi[col]);
    totF += f;
    totP += p;
    upsertRows.push({
      anno: parseInt(anno, 10),
      mese: MESI[i],
      ferie_maturata: f,
      permessi_maturati: p,
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Importo maturazione ${anno}: totale ferie ${totF.toFixed(2)}h, permessi ${totP.toFixed(2)}h...`);
  await supabaseRequest(MATURAZIONE_TABLE, upsertRows, 'anno,mese');
  // Assicura che l'anno sia presente nella tabella "anni" (cosi appare nel sito)
  await supabaseRequest(ANNI_TABLE, [{ anno: parseInt(anno, 10) }], 'anno');
  console.log(`  -> ${anno} importato (${upsertRows.length} righe).`);
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const files = fs.readdirSync(dataDir);
  const anni = [];
  for (const f of files) {
    const match = f.match(/^Mie Ferie - (\d{4})\.csv$/);
    if (match) anni.push(match[1]);
  }
  if (anni.length === 0) {
    console.log('Nessun CSV trovato in data/ (attesi file "Mie Ferie - YYYY.csv").');
    return;
  }
  console.log(`Trovati CSV per gli anni: ${anni.join(', ')}`);
  for (const a of anni) {
    await importaMaturation(a);
  }
  console.log('Importazione completata con successo.');
}

main().catch(err => {
  console.error('Errore fatale durante l importazione:', err.message);
  process.exit(1);
});
