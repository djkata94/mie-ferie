// Importa la maturazione dai CSV di data/ nella tabella Supabase "maturazione_mensile".
// Nessuna dipendenza esterna: usa fetch (integrato in Node 18+).
//
// Uso (PowerShell):
//   $env:SUPABASE_SERVICE_KEY = "<service role key>"; node scripts/load_maturation.js

const fs = require('fs');
const path = require('path');
const { MESI, upsert, parseCSV, parseNumber, anniCSV } = require('./lib');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function importaMaturation(anno) {
  const rows = parseCSV(fs.readFileSync(path.join(DATA_DIR, `Mie Ferie - ${anno}.csv`), 'utf8'));
  // Righe 2 e 3 (indici 1,2): maturazione ferie/permessi per mese (colonne C..N = indici 2..13)
  const rowFerie = rows[1] || [];
  const rowPermessi = rows[2] || [];

  const upsertRows = [];
  let totF = 0, totP = 0;
  for (let i = 0; i < 12; i++) {
    const f = parseNumber(rowFerie[i + 2]);
    const p = parseNumber(rowPermessi[i + 2]);
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
  await upsert('maturazione_mensile', upsertRows, 'anno,mese');
  // Assicura che l'anno sia presente nella tabella "anni" (cosi appare nel sito)
  await upsert('anni', [{ anno: parseInt(anno, 10) }], 'anno');
  console.log(`  -> ${anno} importato (${upsertRows.length} righe).`);
}

async function main() {
  const anni = anniCSV(DATA_DIR);
  if (anni.length === 0) {
    console.log('Nessun CSV trovato in data/ (attesi file "Mie Ferie - YYYY.csv").');
    return;
  }
  console.log(`Trovati CSV per gli anni: ${anni.join(', ')}`);
  for (const a of anni) await importaMaturation(a);
  console.log('Importazione completata con successo.');
}

main().catch(err => {
  console.error('Errore fatale durante l importazione:', err.message);
  process.exit(1);
});
