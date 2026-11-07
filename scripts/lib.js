// Funzioni comuni agli script di importazione (nessuna dipendenza, Node 18+).
//
// La chiave NON sta nel codice: con le regole RLS attive la chiave anon non può
// scrivere, quindi gli script usano la service role key passata da variabile
// d'ambiente (dashboard Supabase → Project Settings → API → service_role).
// Non salvarla mai nella repo.

const SUPABASE_URL = 'https://esfaugsdnmxhkyozaezm.supabase.co';
const MESI = ['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO','AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'];

function chiave() {
  const k = process.env.SUPABASE_SERVICE_KEY;
  if (!k) {
    console.error('Manca la variabile SUPABASE_SERVICE_KEY (service role key di Supabase).');
    console.error('PowerShell:  $env:SUPABASE_SERVICE_KEY = "..."; node scripts/<script>.js');
    process.exit(1);
  }
  return k;
}

// Upsert via REST (PostgREST)
async function upsert(table, rows, onConflict) {
  const key = chiave();
  const url = `${SUPABASE_URL}/rest/v1/${table}` + (onConflict ? `?on_conflict=${onConflict}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    throw new Error(`Supabase ha risposto ${res.status} per "${table}": ${await res.text()}`);
  }
  return res.json().catch(() => null);
}

// Parser CSV (campi tra virgolette, numeri con virgola decimale)
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const row = [];
    let i = 0;
    while (i < line.length) {
      let field = '';
      if (line[i] === '"') {
        i++;
        while (i < line.length && line[i] !== '"') field += line[i++];
        i++;
      } else {
        while (i < line.length && line[i] !== ',') field += line[i++];
      }
      row.push(field);
      if (i < line.length && line[i] === ',') i++;
    }
    rows.push(row);
  }
  return rows;
}

function vuoto(str) {
  if (str === undefined || str === null) return true;
  const s = String(str).trim();
  return s === '' || s === '-';
}

function parseNumber(str) {
  if (vuoto(str)) return 0;
  return parseFloat(String(str).trim().replace(',', '.')) || 0;
}

// Anni per cui esiste "data/Mie Ferie - YYYY.csv" (i CSV restano solo in locale, fuori da git)
function anniCSV(dataDir) {
  const fs = require('fs');
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .map(f => f.match(/^Mie Ferie - (\d{4})\.csv$/))
    .filter(Boolean)
    .map(m => m[1]);
}

module.exports = { SUPABASE_URL, MESI, upsert, parseCSV, vuoto, parseNumber, anniCSV };
