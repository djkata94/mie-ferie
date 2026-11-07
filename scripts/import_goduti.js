// Importa i goduti (ferie e permessi) e l'AP da un CSV del foglio Google in Supabase.
// Una tantum, rieseguibile (upsert). Nessuna dipendenza: Node 18+.
//
// - Goduti: righe "FERIE GOD." e "PERM. GOD" (indici 4 e 5), colonne C..N = gennaio..dicembre
//   → tabella ferie_mensili. I mesi con entrambe le celle vuote non vengono scritti.
// - AP: colonna B delle righe FERIE/PERMESSI (indici 1 e 2), se non vuota
//   → tabella anno_ap con bloccato = true e ap_configurato = true.
//
// Uso (PowerShell):
//   $env:SUPABASE_SERVICE_KEY = "<service role key>"; node scripts/import_goduti.js 2026
//   aggiungere --dry-run per vedere cosa verrebbe scritto senza scrivere.

const fs = require('fs');
const path = require('path');
const { MESI, upsert, parseCSV, vuoto, parseNumber } = require('./lib');

async function main() {
  const anno = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!/^\d{4}$/.test(anno || '')) {
    console.error('Uso: node scripts/import_goduti.js <ANNO> [--dry-run]');
    process.exit(1);
  }
  const csvPath = path.join(__dirname, '..', 'data', `Mie Ferie - ${anno}.csv`);
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));

  const etichettaF = String((rows[4] || [])[0] || '').toUpperCase();
  const etichettaP = String((rows[5] || [])[0] || '').toUpperCase();
  if (!etichettaF.startsWith('FERIE GOD') || !etichettaP.startsWith('PERM')) {
    throw new Error(`Formato CSV inatteso: righe 5-6 sono "${etichettaF}" / "${etichettaP}"`);
  }

  const goduti = [];
  for (let i = 0; i < 12; i++) {
    const cF = rows[4][i + 2];
    const cP = rows[5][i + 2];
    if (vuoto(cF) && vuoto(cP)) continue;
    goduti.push({
      anno: parseInt(anno, 10),
      mese: MESI[i],
      ferie_ore: parseNumber(cF),
      permessi_ore: parseNumber(cP),
      updated_at: new Date().toISOString()
    });
  }

  const apF = (rows[1] || [])[1];
  const apP = (rows[2] || [])[1];
  const ap = vuoto(apF) && vuoto(apP) ? null : {
    anno: parseInt(anno, 10),
    ap_ferie: parseNumber(apF),
    ap_permessi: parseNumber(apP),
    bloccato: true,
    ap_configurato: true,
    updated_at: new Date().toISOString()
  };

  console.log(`Goduti ${anno} (${goduti.length} mesi):`);
  goduti.forEach(g => console.log(`  ${g.mese.padEnd(10)} ferie ${g.ferie_ore}  permessi ${g.permessi_ore}`));
  console.log(ap ? `AP ${anno}: ferie ${ap.ap_ferie}, permessi ${ap.ap_permessi}` : `AP ${anno}: vuoto nel CSV, non toccato`);

  if (dryRun) { console.log('--dry-run: nulla scritto.'); return; }
  if (goduti.length) await upsert('ferie_mensili', goduti, 'anno,mese');
  if (ap) await upsert('anno_ap', [ap], 'anno');
  await upsert('anni', [{ anno: parseInt(anno, 10) }], 'anno');
  console.log('Importazione completata.');
}

main().catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
