// Backup automatico di mie-ferie: scarica tutte le tabelle da Supabase in un file JSON
// datato e tiene solo le ultime copie. Nessuna dipendenza, Node 18+.
//
// Uso:  node scripts/backup.js
// Lo lancia ogni giorno l'attività pianificata di Windows "mie-ferie backup"
// (scripts/installa_backup.ps1). Chiave di servizio: vedi scripts/lib.js.
//
// Variabili facoltative:
//   MIE_FERIE_BACKUP_DIR   cartella di destinazione (default: backup/auto nella cartella del progetto)
//   MIE_FERIE_BACKUP_COPIE quante copie tenere (default 30)

const fs = require('fs');
const path = require('path');
const { leggiTabella, FILE_CHIAVE } = require('./lib');

const TABELLE = ['anni', 'ferie_mensili', 'anno_ap', 'maturazione_mensile', 'goduti_giornalieri', 'storico_goduti', 'ferie_impostazioni'];
const CARTELLA = process.env.MIE_FERIE_BACKUP_DIR || path.join(__dirname, '..', 'backup', 'auto');
const COPIE = parseInt(process.env.MIE_FERIE_BACKUP_COPIE || '30', 10);
const LOG = path.join(CARTELLA, 'backup.log');

function scriviLog(riga) {
  const testo = `${new Date().toISOString()} ${riga}`;
  console.log(testo);
  try { fs.appendFileSync(LOG, testo + '\n'); } catch (e) { /* il log non deve far fallire il backup */ }
}

async function main() {
  fs.mkdirSync(CARTELLA, { recursive: true });
  const dati = {};
  for (const t of TABELLE) dati[t] = await leggiTabella(t);

  // Con una chiave sbagliata (es. quella anon) RLS restituisce tabelle vuote senza errore:
  // un backup vuoto sembrerebbe riuscito ma non servirebbe a niente.
  if (dati.anni.length === 0 && dati.maturazione_mensile.length === 0) {
    throw new Error(`tabelle vuote: la chiave in uso non vede i dati (serve la chiave di servizio, file ${FILE_CHIAVE}).`);
  }

  const timbro = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(CARTELLA, `mie-ferie-${timbro}.json`);
  const contenuto = JSON.stringify({ creato: new Date().toISOString(), tabelle: dati }, null, 2);
  fs.writeFileSync(file + '.tmp', contenuto);
  JSON.parse(fs.readFileSync(file + '.tmp', 'utf8')); // controllo: il file si rilegge
  fs.renameSync(file + '.tmp', file);

  // Tiene le ultime COPIE copie
  const vecchi = fs.readdirSync(CARTELLA).filter(f => /^mie-ferie-.*\.json$/.test(f)).sort().reverse().slice(COPIE);
  vecchi.forEach(f => fs.unlinkSync(path.join(CARTELLA, f)));

  const righe = TABELLE.map(t => `${t}=${dati[t].length}`).join(' ');
  scriviLog(`OK ${path.basename(file)} (${Math.round(contenuto.length / 1024)} kB) ${righe}${vecchi.length ? ` | eliminate ${vecchi.length} copie vecchie` : ''}`);
}

main().catch(err => {
  try { fs.mkdirSync(CARTELLA, { recursive: true }); } catch (e) { /* ignorato: il log è facoltativo */ }
  scriviLog(`ERRORE ${err.message}`);
  process.exit(1);
});
