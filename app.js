// mie-ferie: interfaccia e accesso a Supabase.
// I calcoli puri (residui, suggerimento AP, validazione, classificazione errori)
// stanno in logica.js, caricato prima di questo file e coperto dai test Node.

const ANNO_AP_TABLE = 'anno_ap';
const ANNI_TABLE = 'anni';
const MATURAZIONE_TABLE = 'maturazione_mensile';
const GODUTI_TABLE = 'ferie_mensili';
const STORICO_TABLE = 'storico_goduti';
const GIORNATE_TABLE = 'goduti_giornalieri';
const TIMEOUT_RETE_MS = 15000;

// fetch con timeout: una richiesta bloccata diventa un errore "rete" invece di un'attesa infinita
function fetchConTimeout(url, opzioni = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_RETE_MS);
  const signal = opzioni.signal && AbortSignal.any ? AbortSignal.any([opzioni.signal, timeout]) : (opzioni.signal || timeout);
  return fetch(url, { ...opzioni, signal });
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchConTimeout }
});

let anni = [];
let currentAnno = null;
let ultimiDati = null;

const $ = (id) => document.getElementById(id);
const selAnno = $('selAnno');
const apBar = $('apBar');
const apVal = $('apVal');
const btnModificaAP = $('btnModificaAP');
const mese = $('mese');
const ferie = $('ferie');
const permessi = $('permessi');
const btnSalva = $('btnSalva');
const status = $('status');
const gridBody = $('gridBody');
const popupAP = $('popupAP');
const apAnnoSpan = $('apAnno');
const apFerieInput = $('apFerie');
const apPermessiInput = $('apPermessi');
const btnConfermaAP = $('btnConfermaAP');
const apMsg = $('apMsg');
const popupAnni = $('popupAnni');
const listaAnni = $('listaAnni');
const nuovoAnnoInput = $('nuovoAnno');
const btnAggiungiAnno = $('btnAggiungiAnno');
const anniMsg = $('anniMsg');
const popupMaturation = $('popupMaturation');
const maturationFileInput = $('maturationFileInput');
const btnConfermaMaturation = $('btnConfermaMaturation');
const maturationMsg = $('maturationMsg');

// ---------------------------------------------------------------------------
// Messaggi ed errori
// ---------------------------------------------------------------------------

// Messaggio di stato sotto il form. Un solo timer: un messaggio nuovo non viene
// nascosto dal timer di quello precedente; gli errori restano finché non arriva altro.
let showTimer = null;
function show(testo, tipo = 'info') {
  clearTimeout(showTimer);
  status.textContent = testo;
  status.className = 'status status-' + tipo;
  status.style.display = testo ? 'block' : 'none';
  if (testo && tipo !== 'err') showTimer = setTimeout(() => { status.style.display = 'none'; }, 3000);
}

// Errore di Supabase con il contesto di cosa si stava facendo; l'originale resta in cause
class ErroreDati extends Error {
  constructor(operazione, causa) {
    super(`${operazione}: ${causa && causa.message ? causa.message : causa}`, { cause: causa });
    this.name = 'ErroreDati';
  }
}

// Esegue una query Supabase e lancia ErroreDati se fallisce
async function query(operazione, promessa) {
  let risposta;
  try {
    risposta = await promessa;
  } catch (e) {
    throw new ErroreDati(operazione, e);
  }
  if (risposta.error) throw new ErroreDati(operazione, risposta.error);
  return risposta.data;
}

// Unico punto in cui un errore diventa un messaggio per l'utente (e una riga in console).
// azione: "Salvataggio di Marzo" ecc. dove: elemento in cui scriverlo (default: barra di stato).
function segnalaErrore(e, azione, dove) {
  const { tipo, messaggio } = classificaErrore(e);
  if (tipo !== 'validazione') console.error(`[mie-ferie] ${azione}:`, e);
  const testo = tipo === 'validazione' ? messaggio : `${azione} non riuscito: ${messaggio}`;
  if (tipo === 'sessione') {
    sb.auth.signOut().finally(() => {
      if (loginMsg) loginMsg.textContent = 'Sessione scaduta: accedi di nuovo.';
    });
    return testo;
  }
  if (dove) dove.textContent = testo;
  else show(testo, 'err');
  return testo;
}

// ---------------------------------------------------------------------------
// Lettura dati
// ---------------------------------------------------------------------------

// Tutte le righe di maturazione, AP e goduti in 3 query (pochi kB): servono sia alla
// griglia (anno + anno precedente per il suggerimento AP) sia al report (tutti gli anni).
async function caricaTuttiIDati() {
  const [maturazione, ap, goduti] = await Promise.all([
    query('Lettura maturazione', sb.from(MATURAZIONE_TABLE).select('anno, mese, ferie_maturata, permessi_maturati')),
    query('Lettura AP', sb.from(ANNO_AP_TABLE).select('anno, ap_ferie, ap_permessi, bloccato, ap_configurato')),
    query('Lettura goduti', sb.from(GODUTI_TABLE).select('anno, mese, ferie_ore, permessi_ore'))
  ]);
  const n = (a) => parseInt(a, 10);
  return (anno) => costruisciAnno(anno, {
    maturazione: maturazione.filter(r => r.anno === n(anno)),
    ap: ap.find(r => r.anno === n(anno)) || null,
    goduti: goduti.filter(r => r.anno === n(anno))
  });
}

// Giornate dell'anno; null se la tabella non esiste ancora (giornate.sql non lanciato)
async function caricaGiornate(anno) {
  try {
    return await query('Lettura giornate', sb.from(GIORNATE_TABLE)
      .select('id, data, ferie_ore, permessi_ore, nota, riporto')
      .gte('data', `${anno}-01-01`)
      .lte('data', `${anno}-12-31`)
      .order('data', { ascending: true }));
  } catch (e) {
    if (classificaErrore(e).tipo === 'tabella-mancante') return null;
    throw e;
  }
}

// Dati per la griglia: l'anno richiesto, il suggerimento AP dal dicembre precedente e le giornate
async function calcolaAnno(anno) {
  const [datiDi, giornate] = await Promise.all([caricaTuttiIDati(), caricaGiornate(anno)]);
  const dati = datiDi(anno);
  const annoPrev = String(parseInt(anno, 10) - 1);
  const sugg = !dati.apConfigurato && anni.includes(annoPrev) ? suggerimentoAP(datiDi(annoPrev)) : { ferie: 0, permessi: 0 };
  return { ...dati, suggerimentoF: sugg.ferie, suggerimentoP: sugg.permessi, giornate };
}

async function caricaAnniDaSupabase() {
  const righe = await query('Lettura anni', sb.from(ANNI_TABLE).select('anno').order('anno', { ascending: true }));
  return righe.map(r => String(r.anno));
}

// ---------------------------------------------------------------------------
// Griglia
// ---------------------------------------------------------------------------

function rigaAP(dati) {
  const tr = document.createElement('tr');
  tr.className = 'row-ap';
  const v = (n) => dati.apConfigurato ? `${fmtIT(n)}h` : '-';
  tr.innerHTML = `
    <td data-label="AP">AP (Anno Prec.)</td>
    <td class="god-val" data-label="Godute">- / -</td>
    <td class="res-val" data-label="Resid. Ferie">${v(dati.apFerie)}</td>
    <td class="res-val" data-label="Resid. Permessi">${v(dati.apPermessi)}</td>
    <td class="tot-val" data-label="Totale">${v(dati.apFerie + dati.apPermessi)}</td>
  `;
  return tr;
}

function render(dati) {
  gridBody.innerHTML = '';

  // Avviso se per l'anno non c'è maturazione su Supabase (i residui sarebbero solo AP - goduti)
  if (!dati.maturazioneCaricata) {
    const trInfo = document.createElement('tr');
    trInfo.className = 'row-info';
    trInfo.innerHTML = `<td colspan="5" class="info-msg">⚠ Nessuna maturazione caricata per ${dati.anno}: importala con 📁.</td>`;
    gridBody.appendChild(trInfo);
  }

  // Barra "AP non impostato" finché l'AP dell'anno non è confermato
  apBar.style.display = dati.apConfigurato ? 'none' : 'flex';
  if (apVal) apVal.textContent = 'non impostato';
  gridBody.appendChild(rigaAP(dati));

  dati.mesi.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.className = 'row-mese';
    tr.title = 'Modifica ' + m.nome;
    // Clic su un mese = lo seleziona nel form con i valori già salvati
    tr.addEventListener('click', () => {
      mese.value = MESI[i];
      precompilaMese();
      ferie.focus();
    });
    tr.innerHTML = `
      <td data-label="Mese">${m.nome}</td>
      <td class="god-val" data-label="Godute (F/P)">${fmtIT(m.godF)} / ${fmtIT(m.godP)}</td>
      <td class="res-val" data-label="Resid. Ferie">${fmtIT(m.resF)}h</td>
      <td class="res-val" data-label="Resid. Permessi">${fmtIT(m.resP)}h</td>
      <td class="tot-val" data-label="Totale">${fmtIT(m.totale)}h</td>
    `;
    gridBody.appendChild(tr);
  });

  // Avviso soglia residuo totale (ferie + permessi) sotto 20h
  const soglia = $('sogliaAlert');
  const ultimo = dati.mesi[11];
  if (ultimo.totale < 20) {
    soglia.textContent = `⚠ Attenzione: residuo totale di ${fmtIT(ultimo.totale)}h (inferiore a 20h).`;
    soglia.style.display = 'block';
  } else {
    soglia.style.display = 'none';
  }

  precompilaMese();
}

// Mostra nel form i goduti già salvati per il mese selezionato (e le sue giornate)
function precompilaMese() {
  const i = MESI.indexOf(mese.value);
  const m = ultimiDati && i >= 0 ? ultimiDati.mesi[i] : null;
  ferie.value = m ? m.godF : '';
  permessi.value = m ? m.godP : '';
  renderGiornate();
}
mese.addEventListener('change', precompilaMese);

// ---------------------------------------------------------------------------
// Goduti per giorno: il totale del mese lo ricalcola il trigger su goduti_giornalieri
// ---------------------------------------------------------------------------

const giornateCard = $('giornateCard');
const giornataForm = $('giornataForm');
const giornataData = $('giornataData');
const giornataFerie = $('giornataFerie');
const giornataPermessi = $('giornataPermessi');
const giornataNota = $('giornataNota');
const btnAggiungiGiornata = $('btnAggiungiGiornata');
const giornateMsg = $('giornateMsg');

// Pannello aperto o chiuso: comodità di chi guarda, ricordata in questo browser (parte chiuso)
const CHIAVE_GIORNATE_APERTE = 'mie-ferie:giornate-aperte';
try {
  giornateCard.open = localStorage.getItem(CHIAVE_GIORNATE_APERTE) === '1';
} catch (e) { /* storage non disponibile (es. navigazione privata): resta chiuso */ }
giornateCard.addEventListener('toggle', () => {
  try { localStorage.setItem(CHIAVE_GIORNATE_APERTE, giornateCard.open ? '1' : '0'); } catch (e) { /* non essenziale */ }
});

function giornateMeseSelezionato() {
  const i = MESI.indexOf(mese.value);
  if (!ultimiDati || !ultimiDati.giornate || i < 0) return [];
  return giornateDelMese(ultimiDati.giornate, ultimiDati.anno, i);
}

// Con il dettaglio giornaliero il totale del mese non si modifica a mano (si sommerebbe due volte)
function aggiornaBloccoMese(bloccato) {
  ferie.disabled = bloccato;
  permessi.disabled = bloccato;
  btnSalva.disabled = bloccato;
  $('meseHint').textContent = bloccato
    ? `Il totale di ${MESI_LABEL[MESI.indexOf(mese.value)]} è la somma delle giornate qui sotto: modifica quelle.`
    : '';
}

function renderGiornate() {
  const i = MESI.indexOf(mese.value);
  giornateMsg.textContent = '';
  if (!ultimiDati || i < 0) {
    giornateCard.style.display = 'none';
    aggiornaBloccoMese(false);
    return;
  }
  giornateCard.style.display = 'block';
  $('giornateMese').textContent = `${MESI_LABEL[i]} ${ultimiDati.anno}`;
  const lista = $('giornateLista');

  if (ultimiDati.giornate === null) {
    // Tabella non ancora creata su Supabase
    aggiornaBloccoMese(false);
    $('giornateTotale').textContent = '';
    $('giornateConteggio').textContent = '';
    giornataForm.style.display = 'none';
    lista.innerHTML = '<p class="giornate-vuoto">Dettaglio giornaliero non ancora attivo: va lanciato <code>supabase/giornate.sql</code> su Supabase.</p>';
    return;
  }
  giornataForm.style.display = '';

  const giornate = giornateMeseSelezionato();
  aggiornaBloccoMese(giornate.length > 0);
  const m = ultimiDati.mesi[i];
  $('giornateTotale').textContent = `Totale mese: F ${fmtIT(m.godF)}h · P ${fmtIT(m.godP)}h`;
  const nGiorni = giornate.filter(g => !g.riporto).length;
  $('giornateConteggio').textContent = nGiorni === 0 ? '' : (nGiorni === 1 ? '1 giornata' : `${nGiorni} giornate`);

  const { min, max } = limitiMese(parseInt(ultimiDati.anno, 10), i);
  giornataData.min = min;
  giornataData.max = max;
  if (!giornataData.value || giornataData.value < min || giornataData.value > max) {
    const oggi = new Date();
    const oggiISO = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
    giornataData.value = oggiISO >= min && oggiISO <= max ? oggiISO : min;
  }

  if (giornate.length === 0) {
    lista.innerHTML = (m.godF > 0 || m.godP > 0)
      ? `<p class="giornate-vuoto">Il totale di ${MESI_LABEL[i]} è stato registrato senza dettaglio. Aggiungendo una giornata, quel totale resta come voce di riporto.</p>`
      : `<p class="giornate-vuoto">Nessuna giornata registrata in ${MESI_LABEL[i]}.</p>`;
    return;
  }

  const dataIT = (d) => { const [y, mm, dd] = d.split('-'); return `${dd}/${mm}/${y}`; };
  lista.innerHTML = `
    <table class="giornate-table">
      <thead><tr><th>Data</th><th class="num">Ferie</th><th class="num">Permessi</th><th>Nota</th><th></th></tr></thead>
      <tbody></tbody>
    </table>`;
  const tbody = lista.querySelector('tbody');
  giornate.forEach(g => {
    const tr = document.createElement('tr');
    if (g.riporto) tr.className = 'riporto';
    tr.innerHTML = `
      <td>${g.riporto ? 'Riporto' : dataIT(g.data)}</td>
      <td class="num">${fmtIT(parseFloat(g.ferie_ore))}</td>
      <td class="num">${fmtIT(parseFloat(g.permessi_ore))}</td>
      <td class="nota"></td>
      <td class="elimina"><button type="button" title="Elimina">✕</button></td>`;
    tr.querySelector('.nota').textContent = g.nota || ''; // testo libero: mai come HTML
    tr.querySelector('button').addEventListener('click', () => eliminaGiornata(g));
    tbody.appendChild(tr);
  });
}

giornataForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const i = MESI.indexOf(mese.value);
  if (!ultimiDati || !ultimiDati.giornate || i < 0) return;
  giornateMsg.textContent = '';

  let piano;
  try {
    if (giornataFerie.validity.badInput || giornataPermessi.validity.badInput) throw new ErroreValidazione('Ore non valide.');
    const m = ultimiDati.mesi[i];
    piano = pianificaGiornata(
      { data: giornataData.value, ferie: giornataFerie.value, permessi: giornataPermessi.value, nota: giornataNota.value },
      { anno: ultimiDati.anno, i, godF: m.godF, godP: m.godP, numeroGiornate: giornateMeseSelezionato().length }
    );
  } catch (err) {
    segnalaErrore(err, 'Giornata', giornateMsg);
    return;
  }
  if (piano.riporto) {
    const r = piano.riporto;
    const ok = confirm(`${MESI_LABEL[i]} ha già un totale senza dettaglio (ferie ${fmtIT(r.ferie_ore)}, permessi ${fmtIT(r.permessi_ore)}).\n\n` +
      `Lo tengo come voce di riporto e aggiungo la giornata?`);
    if (!ok) return;
  }

  btnAggiungiGiornata.disabled = true;
  try {
    // Prima il riporto, poi la giornata: se la seconda fallisce il totale del mese resta quello di prima
    if (piano.riporto) await query(`Riporto di ${MESI_LABEL[i]}`, sb.from(GIORNATE_TABLE).insert(piano.riporto));
    await query('Aggiunta giornata', sb.from(GIORNATE_TABLE).insert(piano.riga));
    giornataFerie.value = '';
    giornataPermessi.value = '';
    giornataNota.value = '';
    if (await caricaGriglia()) show(`Giornata del ${giornataData.value.split('-').reverse().join('/')} aggiunta.`, 'ok');
  } catch (err) {
    segnalaErrore(err, 'Aggiunta giornata', giornateMsg);
  } finally {
    btnAggiungiGiornata.disabled = false;
  }
});

async function eliminaGiornata(g) {
  const cosa = g.riporto ? 'la voce di riporto' : `la giornata del ${g.data.split('-').reverse().join('/')}`;
  if (!confirm(`Elimino ${cosa} (ferie ${fmtIT(parseFloat(g.ferie_ore))}, permessi ${fmtIT(parseFloat(g.permessi_ore))})?`)) return;
  try {
    await query('Eliminazione giornata', sb.from(GIORNATE_TABLE).delete().eq('id', g.id));
    if (await caricaGriglia()) show('Giornata eliminata.', 'ok');
  } catch (err) {
    segnalaErrore(err, 'Eliminazione giornata', giornateMsg);
  }
}

// Griglia vuota senza numeri: nessun anno, oppure lettura fallita (mai residui parziali)
function svuotaGriglia(messaggio) {
  ultimiDati = null;
  apBar.style.display = 'none';
  $('sogliaAlert').style.display = 'none';
  gridBody.innerHTML = messaggio
    ? `<tr class="row-info"><td colspan="5" class="info-msg">${messaggio}</td></tr>`
    : '';
  precompilaMese();
}

let caricamentoId = 0;
async function caricaGriglia() {
  const anno = selAnno.value;
  if (!anno) {
    currentAnno = null;
    svuotaGriglia('Nessun anno: aggiungine uno con ⚙.');
    return true;
  }
  currentAnno = anno;
  // Se si cambia anno prima che il caricamento precedente finisca, vince l'ultimo
  const mioId = ++caricamentoId;
  svuotaGriglia();
  show('Caricamento...', 'info');

  try {
    const dati = await calcolaAnno(anno);
    if (mioId !== caricamentoId) return false;
    ultimiDati = dati;
    render(dati);
    show('', 'info');

    // Popup AP automatico solo se la lettura è riuscita, l'AP manca davvero ed è l'anno in corso
    if (!dati.apConfigurato && anno === String(new Date().getFullYear())) {
      setTimeout(() => apriPopupAP(anno, dati.suggerimentoF, dati.suggerimentoP), 400);
    }
    return true;
  } catch (e) {
    if (mioId !== caricamentoId) return false;
    svuotaGriglia('Dati non disponibili: riprova ricaricando la pagina.');
    segnalaErrore(e, `Caricamento del ${anno}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Salvataggio goduti
// ---------------------------------------------------------------------------

function leggiCampoOre(input, nome) {
  // Con type="number" un testo non valido arriva come stringa vuota: non va scambiato per "vuoto"
  if (input.validity && input.validity.badInput) throw new ErroreValidazione(`${nome}: valore non valido.`);
  return parseOre(input.value, nome);
}

async function inviaDati() {
  const anno = selAnno.value;
  const i = MESI.indexOf(mese.value);
  if (!anno || i < 0 || !ultimiDati || ultimiDati.anno !== String(anno)) {
    show('Dati dell\'anno non caricati: attendi o ricarica la pagina prima di salvare.', 'err');
    return;
  }
  if (giornateMeseSelezionato().length > 0) {
    show(`${MESI_LABEL[i]} ha il dettaglio giornaliero: modifica le giornate.`, 'err');
    return;
  }

  let piano;
  try {
    piano = pianificaSalvataggio(ultimiDati.mesi[i], leggiCampoOre(ferie, 'Ferie'), leggiCampoOre(permessi, 'Permessi'));
  } catch (e) {
    segnalaErrore(e, 'Salvataggio');
    return;
  }
  if (piano.cambi.length === 0) {
    show('Nessuna modifica da salvare.', 'info');
    return;
  }
  if (piano.sovrascritti.length > 0) {
    const righe = piano.sovrascritti.map(c => `${c.nome} di ${MESI_LABEL[i]}: ${fmtIT(c.da)} → ${fmtIT(c.a)}`).join('\n');
    if (!confirm(`Modifico i valori già salvati?\n\n${righe}`)) return;
  }

  btnSalva.disabled = true;
  show('Invio in corso...', 'info');
  try {
    await query(`Salvataggio di ${MESI_LABEL[i]}`, sb.from(GODUTI_TABLE).upsert({
      anno: parseInt(anno, 10),
      mese: MESI[i],
      ferie_ore: piano.f,
      permessi_ore: piano.p,
      updated_at: new Date().toISOString()
    }, { onConflict: 'anno,mese' }));
    // Il salvataggio è riuscito anche se poi la rilettura fallisce (caricaGriglia lo segnala da sé)
    if (await caricaGriglia()) show(`Salvato ${MESI_LABEL[i]}.`, 'ok');
  } catch (e) {
    segnalaErrore(e, `Salvataggio di ${MESI_LABEL[i]}`);
  } finally {
    // Riattiva il form, a meno che il mese selezionato abbia il dettaglio giornaliero
    aggiornaBloccoMese(giornateMeseSelezionato().length > 0);
  }
}

// ---------------------------------------------------------------------------
// Popup AP
// ---------------------------------------------------------------------------

function apriPopupAP(anno, suggerimentoF, suggerimentoP) {
  apAnnoSpan.textContent = anno;
  apFerieInput.value = suggerimentoF ?? '';
  apPermessiInput.value = suggerimentoP ?? '';
  apMsg.textContent = '';
  popupAP.style.display = 'flex';
  apFerieInput.focus();
}

function chiudiPopupAP() {
  popupAP.style.display = 'none';
  apMsg.textContent = '';
}

$('btnAnnullaAP').addEventListener('click', chiudiPopupAP);
popupAP.addEventListener('click', (e) => { if (e.target === popupAP) chiudiPopupAP(); });

// Bottone "Imposta AP" della barra: popup con il suggerimento calcolato per l'anno a video
btnModificaAP.addEventListener('click', () => {
  if (!currentAnno) return;
  const d = ultimiDati && ultimiDati.anno === String(currentAnno) ? ultimiDati : null;
  apriPopupAP(currentAnno, d ? d.suggerimentoF : '', d ? d.suggerimentoP : '');
});

btnConfermaAP.addEventListener('click', async () => {
  const anno = apAnnoSpan.textContent;
  // L'AP può essere negativo (ore anticipate), quindi niente parseOre qui
  const leggi = (input, nome) => {
    const s = input.value.trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    if (!isFinite(n) || Math.abs(n) > 1000) throw new ErroreValidazione(`${nome}: valore non valido.`);
    return arrotonda2(n);
  };
  let f, p;
  try {
    f = leggi(apFerieInput, 'Ferie AP');
    p = leggi(apPermessiInput, 'Permessi AP');
    if (f === null && p === null) throw new ErroreValidazione('Inserisci almeno un valore.');
  } catch (e) {
    segnalaErrore(e, 'Salvataggio AP', apMsg);
    return;
  }
  btnConfermaAP.disabled = true;
  try {
    await query(`Salvataggio AP ${anno}`, sb.from(ANNO_AP_TABLE).upsert({
      anno: parseInt(anno, 10),
      ap_ferie: f ?? 0,
      ap_permessi: p ?? 0,
      bloccato: true,
      ap_configurato: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'anno' }));
    chiudiPopupAP();
    if (await caricaGriglia()) show('AP salvato e bloccato.', 'ok');
  } catch (e) {
    // L'errore resta nel popup, così i valori inseriti non si perdono
    segnalaErrore(e, `Salvataggio AP ${anno}`, apMsg);
  } finally {
    btnConfermaAP.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Gestione anni
// ---------------------------------------------------------------------------

function apriPopupAnni() {
  aggiornaListaAnni();
  anniMsg.textContent = '';
  popupAnni.style.display = 'flex';
}

function chiudiPopupAnni() {
  popupAnni.style.display = 'none';
  anniMsg.textContent = '';
}

$('btnChiudiAnni').addEventListener('click', chiudiPopupAnni);
popupAnni.addEventListener('click', (e) => { if (e.target === popupAnni) chiudiPopupAnni(); });

function aggiornaListaAnni() {
  listaAnni.innerHTML = '';
  anni.forEach(a => {
    const row = document.createElement('div');
    row.className = 'anno-row';
    row.innerHTML = `<span>${a}</span><button title="Rimuovi anno">✕</button>`;
    row.querySelector('button').addEventListener('click', () => rimuoviAnnoDaUI(a));
    listaAnni.appendChild(row);
  });
}

function aggiornaSelectAnni() {
  selAnno.innerHTML = '';
  anni.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    selAnno.appendChild(opt);
  });
  const annoCorrente = String(new Date().getFullYear());
  selAnno.value = anni.includes(annoCorrente) ? annoCorrente : (anni[anni.length - 1] || '');
  currentAnno = selAnno.value || null;
}

async function aggiungiAnnoDaUI() {
  const anno = nuovoAnnoInput.value.trim();
  if (!/^\d{4}$/.test(anno) || anno < '2000' || anno > '2100') {
    anniMsg.textContent = 'Inserisci un anno valido (2000–2100).';
    return;
  }
  if (anni.includes(anno)) {
    anniMsg.textContent = 'Anno già presente.';
    return;
  }
  btnAggiungiAnno.disabled = true;
  try {
    await query(`Aggiunta del ${anno}`, sb.from(ANNI_TABLE).upsert({ anno: parseInt(anno, 10) }, { onConflict: 'anno' }));
    anni.push(anno);
    anni.sort();
    aggiornaSelectAnni();
    selAnno.value = anno;
    nuovoAnnoInput.value = '';
    chiudiPopupAnni();
    if (await caricaGriglia()) show('Anno ' + anno + ' aggiunto.', 'ok');
  } catch (e) {
    segnalaErrore(e, `Aggiunta del ${anno}`, anniMsg);
  } finally {
    btnAggiungiAnno.disabled = false;
  }
}

async function rimuoviAnnoDaUI(anno) {
  const msg = `Togliere il ${anno} dalla lista degli anni?\n\n` +
    `Goduti, AP e maturazione del ${anno} restano salvati: se riaggiungi l'anno ricompaiono.`;
  if (!confirm(msg)) return;
  try {
    await query(`Rimozione del ${anno}`, sb.from(ANNI_TABLE).delete().eq('anno', parseInt(anno, 10)));
    const eraVisualizzato = currentAnno === anno;
    anni = anni.filter(a => a !== anno);
    aggiornaSelectAnni();
    aggiornaListaAnni();
    show('Anno ' + anno + ' tolto dalla lista.', 'ok');
    // aggiornaSelectAnni ha già scelto un altro anno (o nessuno): ricarica se la griglia mostrava quello tolto
    if (eraVisualizzato) caricaGriglia();
  } catch (e) {
    segnalaErrore(e, `Rimozione del ${anno}`, anniMsg);
  }
}

// ---------------------------------------------------------------------------
// Importazione maturazione da CSV (file scelto dal PC, non più nella repo)
// ---------------------------------------------------------------------------

function apriPopupMaturation() {
  maturationFileInput.value = '';
  maturationMsg.textContent = '';
  popupMaturation.style.display = 'flex';
}

function chiudiPopupMaturation() {
  maturationMsg.textContent = '';
  popupMaturation.style.display = 'none';
}

async function importaMaturationDaFile() {
  const file = maturationFileInput.files && maturationFileInput.files[0];
  if (!file) {
    maturationMsg.textContent = 'Seleziona un file CSV.';
    return;
  }
  const match = file.name.match(/Mie Ferie\s*-\s*(\d{4})\.csv$/i);
  if (!match) {
    maturationMsg.textContent = 'Nome file non valido. Usa il formato "Mie Ferie - YYYY.csv".';
    return;
  }
  const anno = parseInt(match[1], 10);

  btnConfermaMaturation.disabled = true;
  try {
    const righe = parseCSV(await file.text());
    // Righe 2 e 3 (indici 1,2): maturazione ferie/permessi, colonne C..N (indici 2..13) = gennaio..dicembre
    const rowFerie = righe[1] || [];
    const rowPermessi = righe[2] || [];
    if (!String(rowFerie[0] || '').toUpperCase().startsWith('FERIE') || !String(rowPermessi[0] || '').toUpperCase().startsWith('PERMESSI')) {
      throw new ErroreValidazione('Il file non ha le righe FERIE e PERMESSI del foglio "Mie Ferie".');
    }
    const adesso = new Date().toISOString();
    const upsertRows = MESI.map((m, i) => ({
      anno, mese: m,
      ferie_maturata: parseIT(rowFerie[i + 2]),
      permessi_maturati: parseIT(rowPermessi[i + 2]),
      updated_at: adesso
    }));
    // Una sola richiesta per i 12 mesi (prima erano 12 in serie)
    await query(`Importazione maturazione ${anno}`, sb.from(MATURAZIONE_TABLE).upsert(upsertRows, { onConflict: 'anno,mese' }));
    chiudiPopupMaturation();
    if (await caricaGriglia()) show('Maturazione importata per il ' + anno + '.', 'ok');
  } catch (e) {
    segnalaErrore(e, 'Importazione', maturationMsg);
  } finally {
    btnConfermaMaturation.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Backup JSON
// ---------------------------------------------------------------------------

async function esportaBackup() {
  const tabelle = [ANNI_TABLE, GODUTI_TABLE, ANNO_AP_TABLE, MATURAZIONE_TABLE];
  try {
    // Passa dal client sb così usa il token della sessione (le regole RLS lo richiedono)
    const dati = await Promise.all(tabelle.map(t => query(`Lettura ${t}`, sb.from(t).select('*'))));
    const backup = Object.fromEntries(tabelle.map((t, i) => [t, dati[i]]));
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mie-ferie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    show('Backup esportato.', 'ok');
  } catch (e) {
    segnalaErrore(e, 'Backup');
  }
}

// ---------------------------------------------------------------------------
// Report annuale
// ---------------------------------------------------------------------------

function apriReport() {
  if (!currentAnno) return;
  chiudiStorico();
  $('reportSection').style.display = 'block';
  $('reportAnno').textContent = currentAnno;
  caricaReport();
}

function chiudiReport() {
  $('reportSection').style.display = 'none';
}

async function caricaReport() {
  const riepilogo = $('reportRiepilogo');
  const confronto = $('reportConfronto');
  riepilogo.innerHTML = '<p class="loading">Calcolo in corso…</p>';
  confronto.innerHTML = '';

  let datiDi;
  try {
    // 3 query per tutti gli anni insieme (prima: 3 query per ogni anno, in serie)
    datiDi = await caricaTuttiIDati();
  } catch (e) {
    riepilogo.innerHTML = '';
    segnalaErrore(e, 'Report', riepilogo);
    return;
  }

  const annoSel = currentAnno;
  const tSel = sommaMesi(datiDi(annoSel));
  riepilogo.innerHTML = `
    <div class="report-cards">
      <div class="report-card">
        <span class="report-card-label">Maturato totale</span>
        <span class="report-card-val">${fmtIT(tSel.matF + tSel.matP)}h</span>
        <span class="report-card-sub">F ${fmtIT(tSel.matF)}h · P ${fmtIT(tSel.matP)}h</span>
      </div>
      <div class="report-card">
        <span class="report-card-label">Goduti totale</span>
        <span class="report-card-val">${fmtIT(tSel.godF + tSel.godP)}h</span>
        <span class="report-card-sub">F ${fmtIT(tSel.godF)}h · P ${fmtIT(tSel.godP)}h</span>
      </div>
      <div class="report-card ${tSel.residuoFinale < 20 ? 'report-card-warn' : ''}">
        <span class="report-card-label">Residuo finale</span>
        <span class="report-card-val">${fmtIT(tSel.residuoFinale)}h</span>
        <span class="report-card-sub">AP ${fmtIT(tSel.apTot)}h</span>
      </div>
    </div>
  `;

  const righe = anni.map(a => ({ anno: a, t: sommaMesi(datiDi(a)), selezionato: a === String(annoSel) }));
  confronto.innerHTML = `
    <table class="report-table">
      <thead>
        <tr><th>Anno</th><th>Maturato</th><th>Goduti</th><th>AP</th><th>Residuo</th></tr>
      </thead>
      <tbody>
        ${righe.map(r => `
          <tr class="${r.selezionato ? 'report-row-sel' : ''}">
            <td data-label="Anno">${r.anno}</td>
            <td data-label="Maturato">${fmtIT(r.t.matF + r.t.matP)}h</td>
            <td data-label="Goduti">${fmtIT(r.t.godF + r.t.godP)}h</td>
            <td data-label="AP">${fmtIT(r.t.apTot)}h</td>
            <td data-label="Residuo" class="${r.t.residuoFinale < 20 ? 'report-res-warn' : ''}">${fmtIT(r.t.residuoFinale)}h</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Storico modifiche goduti (tabella scritta da un trigger, vedi supabase/storico.sql)
// ---------------------------------------------------------------------------

function apriStorico() {
  if (!currentAnno) return;
  chiudiReport();
  $('storicoSection').style.display = 'block';
  $('storicoAnno').textContent = currentAnno;
  caricaStorico(currentAnno);
}

function chiudiStorico() {
  $('storicoSection').style.display = 'none';
}

async function caricaStorico(anno) {
  const box = $('storicoLista');
  box.innerHTML = '<p class="loading">Carico lo storico…</p>';
  let righe;
  try {
    righe = await query('Lettura storico', sb.from(STORICO_TABLE)
      .select('mese, operazione, ferie_prima, permessi_prima, ferie_dopo, permessi_dopo, quando')
      .eq('anno', parseInt(anno, 10))
      .order('quando', { ascending: false })
      .limit(200));
  } catch (e) {
    if (classificaErrore(e).tipo === 'tabella-mancante') {
      console.error('[mie-ferie] Storico non attivo:', e);
      box.innerHTML = '<p class="info-msg">Storico non ancora attivo: va lanciato <code>supabase/storico.sql</code> su Supabase.</p>';
      return;
    }
    box.innerHTML = '';
    segnalaErrore(e, 'Storico', box);
    return;
  }
  if (righe.length === 0) {
    box.innerHTML = `<p class="info-msg">Nessuna modifica registrata per il ${anno}.</p>`;
    return;
  }
  const ore = (n) => n === null || n === undefined ? '—' : fmtIT(parseFloat(n));
  const cambio = (prima, dopo) => prima === dopo ? ore(dopo) : `${ore(prima)} → ${ore(dopo)}`;
  const nomeOp = { INSERT: 'Nuovo', UPDATE: 'Modifica', DELETE: 'Cancellato' };
  const quando = (t) => new Date(t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Quando</th><th>Mese</th><th>Ferie</th><th>Permessi</th><th>Tipo</th></tr></thead>
      <tbody>
        ${righe.map(r => `
          <tr>
            <td data-label="Quando">${quando(r.quando)}</td>
            <td data-label="Mese">${MESI_LABEL[MESI.indexOf(r.mese)] || r.mese}</td>
            <td data-label="Ferie">${cambio(r.ferie_prima, r.ferie_dopo)}</td>
            <td data-label="Permessi">${cambio(r.permessi_prima, r.permessi_dopo)}</td>
            <td data-label="Tipo">${nomeOp[r.operazione] || r.operazione}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Avvio e login (Supabase Auth)
// ---------------------------------------------------------------------------

$('btnExportBackup').addEventListener('click', esportaBackup);
$('btnReport').addEventListener('click', apriReport);
$('btnChiudiReport').addEventListener('click', chiudiReport);
$('btnStampaReport').addEventListener('click', () => window.print());
$('btnStorico').addEventListener('click', apriStorico);
$('btnChiudiStorico').addEventListener('click', chiudiStorico);

async function loadAnni() {
  // Gli anni stanno solo nella tabella "anni"
  try {
    anni = await caricaAnniDaSupabase();
  } catch (e) {
    svuotaGriglia('Dati non disponibili: riprova ricaricando la pagina.');
    segnalaErrore(e, 'Caricamento degli anni');
    return;
  }
  aggiornaSelectAnni();
  mese.value = MESI[new Date().getMonth()];
  caricaGriglia();
}

// Le regole RLS concedono i dati solo all'utente autenticato: senza sessione
// si vede soltanto il riquadro di accesso.
const loginForm = $('loginForm');
const loginEmail = $('loginEmail');
const loginPassword = $('loginPassword');
const btnLogin = $('btnLogin');
const loginMsg = $('loginMsg');
let appAvviata = false;

function mostraLogin() {
  appAvviata = false;
  document.body.classList.add('non-autenticato');
  svuotaGriglia();
  chiudiReport();
  chiudiStorico();
  loginPassword.value = '';
  loginEmail.focus();
}

function avviaApp() {
  document.body.classList.remove('non-autenticato');
  loginMsg.textContent = '';
  if (appAvviata) return; // SIGNED_IN può arrivare più volte (es. al ritorno sulla scheda)
  appAvviata = true;
  // Fuori dalla callback di onAuthStateChange: chiamare Supabase lì dentro può bloccarsi
  setTimeout(loadAnni, 0);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMsg.textContent = '';
  btnLogin.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });
    if (error) throw error;
    // avviaApp() parte da onAuthStateChange (SIGNED_IN)
  } catch (err) {
    if (err && err.message === 'Invalid login credentials') loginMsg.textContent = 'Email o password errate.';
    else segnalaErrore(err, 'Accesso', loginMsg);
  } finally {
    btnLogin.disabled = false;
  }
});

$('btnLogout').addEventListener('click', () => sb.auth.signOut());

sb.auth.onAuthStateChange((event, session) => {
  if (session) avviaApp();
  else mostraLogin();
});
