// Funzioni comuni agli script (importazione, backup). Nessuna dipendenza, Node 18+.
//
// La chiave NON sta nel codice: con le regole RLS la chiave anon non legge né scrive,
// quindi gli script usano la chiave di servizio di Supabase (Project Settings → API Keys:
// "secret" sb_secret_… oppure la vecchia "service_role"). La cercano, in ordine:
//   1. variabile d'ambiente SUPABASE_SERVICE_KEY
//   2. file %USERPROFILE%\.mie-ferie\service_role.key (fuori dalla repo)
// Non salvarla mai nella repo.

const fs = require('fs');
const os = require('os');
const path = require('path');

// MIE_FERIE_SUPABASE_URL: solo per provare gli script contro un server finto
const SUPABASE_URL = process.env.MIE_FERIE_SUPABASE_URL || 'https://esfaugsdnmxhkyozaezm.supabase.co';
const FILE_CHIAVE = process.env.MIE_FERIE_KEY_FILE || path.join(os.homedir(), '.mie-ferie', 'service_role.key');

function chiave() {
  let k = process.env.SUPABASE_SERVICE_KEY;
  if (!k && fs.existsSync(FILE_CHIAVE)) k = fs.readFileSync(FILE_CHIAVE, 'utf8').trim();
  if (!k) {
    console.error('Manca la chiave di servizio di Supabase.');
    console.error(`Incollala nel file ${FILE_CHIAVE}`);
    console.error('oppure (PowerShell):  $env:SUPABASE_SERVICE_KEY = "..."; node scripts/<script>.js');
    process.exit(1);
  }
  return k;
}

// Intestazioni per PostgREST: le chiavi nuove (sb_secret_…) vanno solo in apikey,
// le vecchie (JWT "eyJ…") anche come Bearer.
function intestazioni(key, extra = {}) {
  const h = { apikey: key, ...extra };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

// Lettura di una tabella intera via REST
async function leggiTabella(table) {
  const key = chiave();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: intestazioni(key),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Supabase ha risposto ${res.status} per "${table}": ${await res.text()}`);
  return res.json();
}

// Upsert via REST (PostgREST)
async function upsert(table, rows, onConflict) {
  const key = chiave();
  const url = `${SUPABASE_URL}/rest/v1/${table}` + (onConflict ? `?on_conflict=${onConflict}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: intestazioni(key, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
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
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .map(f => f.match(/^Mie Ferie - (\d{4})\.csv$/))
    .filter(Boolean)
    .map(m => m[1]);
}

module.exports = { SUPABASE_URL, FILE_CHIAVE, MESI, upsert, leggiTabella, parseCSV, vuoto, parseNumber, anniCSV };
