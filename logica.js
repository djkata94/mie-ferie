// Logica pura di mie-ferie: niente DOM, niente Supabase.
// Usata dal sito (caricata prima di app.js) e dai test Node (tests/logica.test.js)
// e dagli script di importazione (scripts/lib.js).

const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const MAX_ORE_MESE = 200;

function arrotonda2(n) {
  return Math.round(n * 100) / 100;
}

// Numero all'italiana dal CSV del foglio: "13,33" → 13.33; vuoto o "-" → 0
function parseIT(s) {
  if (s === null || s === undefined) return 0;
  const t = String(s).trim();
  if (t === '' || t === '-') return 0;
  return parseFloat(t.replace(',', '.')) || 0;
}

function fmtIT(n) {
  return n.toFixed(2).replace('.', ',');
}

// Parser CSV minimo: campi tra virgolette (con la virgola decimale dentro), righe vuote saltate
function parseCSV(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
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

// Residui mese per mese, come le celle C7…N7 del foglio:
// residuo = residuo precedente + maturazione − goduti, ferie e permessi separati, partendo dall'AP.
// maturazione e goduti: 12 elementi { f, p } (gennaio … dicembre).
function calcolaResidui(apFerie, apPermessi, maturazione, goduti) {
  const mesi = [];
  let resF = apFerie;
  let resP = apPermessi;
  for (let i = 0; i < 12; i++) {
    const mat = maturazione[i] || { f: 0, p: 0 };
    const god = goduti[i] || { f: 0, p: 0 };
    resF += mat.f - god.f;
    resP += mat.p - god.p;
    mesi.push({
      nome: MESI_LABEL[i],
      matF: mat.f, matP: mat.p, godF: god.f, godP: god.p,
      resF, resP, totale: resF + resP
    });
  }
  return mesi;
}

// Righe Supabase di UN anno → dati pronti per griglia e report.
// righe = { maturazione: [{mese, ferie_maturata, permessi_maturati}], ap: {…} | null, goduti: [{mese, ferie_ore, permessi_ore}] }
function costruisciAnno(anno, righe) {
  const perMese = (lista, campoF, campoP) => MESI.map(m => {
    const r = (lista || []).find(x => x.mese === m);
    return r ? { f: parseFloat(r[campoF]) || 0, p: parseFloat(r[campoP]) || 0 } : { f: 0, p: 0 };
  });
  const ap = righe.ap || null;
  // AP valido solo se confermato dal popup (bloccato + ap_configurato)
  const apConfigurato = !!ap && ap.bloccato === true && ap.ap_configurato === true;
  const apFerie = apConfigurato ? (parseFloat(ap.ap_ferie) || 0) : 0;
  const apPermessi = apConfigurato ? (parseFloat(ap.ap_permessi) || 0) : 0;
  return {
    anno: String(anno),
    apFerie, apPermessi, apConfigurato,
    maturazioneCaricata: (righe.maturazione || []).length > 0,
    mesi: calcolaResidui(
      apFerie, apPermessi,
      perMese(righe.maturazione, 'ferie_maturata', 'permessi_maturati'),
      perMese(righe.goduti, 'ferie_ore', 'permessi_ore')
    )
  };
}

// Suggerimento AP di un anno = residuo di dicembre dell'anno precedente
function suggerimentoAP(datiAnnoPrecedente) {
  if (!datiAnnoPrecedente) return { ferie: 0, permessi: 0 };
  const dic = datiAnnoPrecedente.mesi[11];
  return { ferie: arrotonda2(dic.resF), permessi: arrotonda2(dic.resP) };
}

function sommaMesi(dati) {
  let matF = 0, matP = 0, godF = 0, godP = 0;
  dati.mesi.forEach(m => { matF += m.matF; matP += m.matP; godF += m.godF; godP += m.godP; });
  const residuoFinale = dati.mesi.length ? dati.mesi[dati.mesi.length - 1].totale : 0;
  return { matF, matP, godF, godP, residuoFinale, apTot: dati.apFerie + dati.apPermessi };
}

class ErroreValidazione extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreValidazione';
  }
}

// Campo ore del form: '' = "non modificare" (null), altrimenti numero tra 0 e MAX_ORE_MESE
function parseOre(testo, nome) {
  const s = String(testo === undefined || testo === null ? '' : testo).trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new ErroreValidazione(`${nome}: inserisci un numero di ore maggiore o uguale a 0.`);
  if (n > MAX_ORE_MESE) throw new ErroreValidazione(`${nome}: ${fmtIT(n)} ore in un mese sono troppe (massimo ${MAX_ORE_MESE}).`);
  return arrotonda2(n);
}

// Cosa salvare per un mese. attuale = { godF, godP }; nuovaF/nuovaP = numero o null (campo vuoto).
// Campo vuoto = mantieni il valore attuale (un tempo veniva salvato 0, cancellando il dato).
function pianificaSalvataggio(attuale, nuovaF, nuovaP) {
  if (nuovaF === null && nuovaP === null) {
    throw new ErroreValidazione('Inserisci le ore di ferie o di permessi (0 per azzerare).');
  }
  const f = nuovaF === null ? attuale.godF : nuovaF;
  const p = nuovaP === null ? attuale.godP : nuovaP;
  const cambi = [];
  if (f !== attuale.godF) cambi.push({ nome: 'Ferie', da: attuale.godF, a: f });
  if (p !== attuale.godP) cambi.push({ nome: 'Permessi', da: attuale.godP, a: p });
  // Da confermare solo se si sovrascrive un valore già registrato (diverso da 0)
  return { f, p, cambi, sovrascritti: cambi.filter(c => c.da !== 0) };
}

// --- Goduti per giorno (tabella goduti_giornalieri) ---
const MAX_ORE_GIORNO = 24;
const MAX_NOTA = 200;
const NOTA_RIPORTO = 'Totale registrato prima del dettaglio giornaliero';

// "2026-03-15" → { anno: 2026, i: 2 } (i = indice del mese 0..11)
function meseDaData(dataISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataISO || ''));
  if (!m) return null;
  const i = parseInt(m[2], 10) - 1;
  const giorno = parseInt(m[3], 10);
  const giorniNelMese = new Date(Date.UTC(parseInt(m[1], 10), i + 1, 0)).getUTCDate();
  if (i < 0 || i > 11 || giorno < 1 || giorno > giorniNelMese) return null;
  return { anno: parseInt(m[1], 10), i };
}

// Primo e ultimo giorno del mese, in formato ISO (per i limiti del campo data)
function limitiMese(anno, i) {
  const mm = String(i + 1).padStart(2, '0');
  const ultimo = new Date(Date.UTC(anno, i + 1, 0)).getUTCDate();
  return { min: `${anno}-${mm}-01`, max: `${anno}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

function giornateDelMese(giornate, anno, i) {
  return (giornate || [])
    .filter(g => { const m = meseDaData(g.data); return m && m.anno === parseInt(anno, 10) && m.i === i; })
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.id || 0) - (b.id || 0)));
}

// Valida una nuova giornata e dice se prima serve la voce di riporto.
// input: { data, ferie, permessi, nota } (ferie/permessi come testo del form)
// mese: { anno, i, godF, godP, numeroGiornate } = stato attuale del mese selezionato
function pianificaGiornata(input, mese) {
  const pos = meseDaData(input.data);
  if (!pos) throw new ErroreValidazione('Data non valida.');
  if (pos.anno !== parseInt(mese.anno, 10) || pos.i !== mese.i) {
    throw new ErroreValidazione(`La data deve essere in ${MESI_LABEL[mese.i]} ${mese.anno}.`);
  }
  const f = parseOre(input.ferie, 'Ferie') || 0;
  const p = parseOre(input.permessi, 'Permessi') || 0;
  if (f === 0 && p === 0) throw new ErroreValidazione('Inserisci le ore di ferie o di permessi della giornata.');
  if (f > MAX_ORE_GIORNO || p > MAX_ORE_GIORNO) throw new ErroreValidazione(`In un giorno al massimo ${MAX_ORE_GIORNO} ore.`);
  const nota = String(input.nota || '').trim();
  if (nota.length > MAX_NOTA) throw new ErroreValidazione(`Nota troppo lunga (massimo ${MAX_NOTA} caratteri).`);

  // Il mese ha già un totale ma nessuna giornata: quel totale diventa una voce di riporto,
  // altrimenti il ricalcolo (somma delle giornate) lo cancellerebbe.
  const serveRiporto = mese.numeroGiornate === 0 && (mese.godF > 0 || mese.godP > 0);
  return {
    riga: { data: input.data, ferie_ore: f, permessi_ore: p, nota: nota || null, riporto: false },
    riporto: serveRiporto
      ? { data: limitiMese(pos.anno, pos.i).min, ferie_ore: mese.godF, permessi_ore: mese.godP, nota: NOTA_RIPORTO, riporto: true }
      : null
  };
}

// Classifica un errore (di Supabase, di rete o di validazione) per decidere cosa dire all'utente.
// tipi: validazione | rete | sessione | permesso | tabella-mancante | altro
function classificaErrore(e) {
  const err = e && e.cause ? e.cause : e;
  if (!err) return { tipo: 'altro', messaggio: 'errore sconosciuto.' };
  if (err.name === 'ErroreValidazione' || (e && e.name === 'ErroreValidazione')) {
    return { tipo: 'validazione', messaggio: (e.message || err.message) };
  }
  const codice = String(err.code || '');
  const testo = String(err.message || err) + ' ' + String(err.details || '');
  if (/Failed to fetch|NetworkError|Load failed|AbortError|TimeoutError|timed out|network/i.test(testo) ||
      err.name === 'AbortError' || err.name === 'TimeoutError') {
    return { tipo: 'rete', messaggio: 'connessione a Supabase non riuscita (rete assente o troppo lenta). Riprova tra poco.' };
  }
  if (codice === 'PGRST301' || codice === 'PGRST303' || /JWT|jwt expired|refresh token|not authenticated/i.test(testo)) {
    return { tipo: 'sessione', messaggio: 'sessione scaduta: accedi di nuovo.' };
  }
  if (codice === '42501' || /row-level security|permission denied/i.test(testo)) {
    return { tipo: 'permesso', messaggio: 'Supabase ha rifiutato l\'operazione (permessi). Esci e rientra; se continua controlla le regole RLS.' };
  }
  if (codice === 'PGRST205' || codice === '42P01' || /does not exist|schema cache/i.test(testo)) {
    return { tipo: 'tabella-mancante', messaggio: 'tabella non trovata su Supabase.' };
  }
  return { tipo: 'altro', messaggio: String(err.message || err) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MESI, MESI_LABEL, MAX_ORE_MESE,
    arrotonda2, parseIT, fmtIT, parseCSV,
    calcolaResidui, costruisciAnno, suggerimentoAP, sommaMesi,
    ErroreValidazione, parseOre, pianificaSalvataggio, classificaErrore,
    MAX_ORE_GIORNO, NOTA_RIPORTO, meseDaData, limitiMese, giornateDelMese, pianificaGiornata
  };
}
