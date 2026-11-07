// Funzioni comuni agli script di importazione (nessuna dipendenza, Node 18+).
//
// La chiave NON sta nel codice: con le regole RLS attive la chiave anon non può
// scrivere, quindi gli script usano la service role key passata da variabile
// d'ambiente (dashboard Supabase → Project Settings → API → service_role).
// Non salvarla mai nella repo.

const SUPABASE_URL = 'https://esfaugsdnmxhkyozaezm.supabase.co';

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
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30000) // niente attese infinite se la rete si blocca
  });
  if (!res.ok) {
    throw new Error(`Supabase ha risposto ${res.status} per "${table}": ${await res.text()}`);
  }
  return res.json().catch(() => null);
}

// Parser CSV e numeri all'italiana: gli stessi del sito (logica.js), una copia sola
const { parseCSV, parseIT: parseNumber, MESI } = require('../logica.js');

function vuoto(str) {
  if (str === undefined || str === null) return true;
  const s = String(str).trim();
  return s === '' || s === '-';
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
