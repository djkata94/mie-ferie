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

// Impostazioni personali (tabella ferie_impostazioni): orario di lavoro e formato delle ore
const IMPOSTAZIONI_TABLE = 'ferie_impostazioni';
const IMPOSTAZIONI_PREDEFINITE = { inizio: '09:00', fine: '18:30', pausaInizio: '', pausaFine: '', formato: 'decimale' };
let impostazioni = { ...IMPOSTAZIONI_PREDEFINITE };

// Ore da mostrare nel formato scelto (7,50h oppure 7:30)
const ore = (n, unita = true) => formattaOre(n, impostazioni.formato, unita);

function oggiISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  const prev = datiDi(annoPrev);
  const sugg = !dati.apConfigurato && anni.includes(annoPrev) ? suggerimentoAP(prev) : { ferie: 0, permessi: 0 };
  // Per proporre la maturazione di un anno nuovo: quella di dicembre dell'anno prima
  const maturazionePrecedente = prev.maturazioneCaricata ? { f: prev.mesi[11].matF, p: prev.mesi[11].matP } : null;
  return { ...dati, suggerimentoF: sugg.ferie, suggerimentoP: sugg.permessi, giornate, maturazionePrecedente };
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
  const v = (n) => dati.apConfigurato ? `${ore(n)}` : '-';
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
    trInfo.innerHTML = `<td colspan="5" class="info-msg">⚠ Nessuna maturazione per il ${dati.anno}: impostala con 📁.</td>`;
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
      <td class="god-val" data-label="Godute (F/P)">${ore(m.godF, false)} / ${ore(m.godP, false)}</td>
      <td class="res-val" data-label="Resid. Ferie">${ore(m.resF)}</td>
      <td class="res-val" data-label="Resid. Permessi">${ore(m.resP)}</td>
      <td class="tot-val" data-label="Totale">${ore(m.totale)}</td>
    `;
    gridBody.appendChild(tr);
  });

  // Avviso soglia residuo totale (ferie + permessi) sotto 20h
  const soglia = $('sogliaAlert');
  const ultimo = dati.mesi[11];
  if (ultimo.totale < 20) {
    soglia.textContent = `⚠ Attenzione: residuo totale di ${ore(ultimo.totale)} (inferiore a 20h).`;
    soglia.style.display = 'block';
  } else {
    soglia.style.display = 'none';
  }

  renderPrevisione();
  precompilaMese();
}

// Mostra nel form i goduti già salvati per il mese selezionato (e le sue giornate)
function precompilaMese() {
  const i = MESI.indexOf(mese.value);
  const m = ultimiDati && i >= 0 ? ultimiDati.mesi[i] : null;
  ferie.value = m ? oreInCampo(m.godF, impostazioni.formato) : '';
  permessi.value = m ? oreInCampo(m.godP, impostazioni.formato) : '';
  renderGiornate();
}

// ---------------------------------------------------------------------------
// Previsione: residuo di oggi, di fine anno, giornate pianificate e simulazione
// ---------------------------------------------------------------------------

const previsioneCard = $('previsioneCard');
const simMese = $('simMese');
const simFerie = $('simFerie');
const simPermessi = $('simPermessi');
const simEsito = $('simEsito');

function renderPrevisione() {
  if (!ultimiDati) { previsioneCard.style.display = 'none'; return; }
  previsioneCard.style.display = 'block';
  const r = riepilogoPrevisione(ultimiDati, ultimiDati.giornate, oggiISO());
  const pezzi = [];
  if (r.residuoOggi !== null) pezzi.push(`oggi (${MESI_LABEL[r.iCorrente]}) <b class="${r.residuoOggi < 0 ? 'neg' : ''}">${ore(r.residuoOggi)}</b>`);
  pezzi.push(`fine anno <b class="${r.residuoFinale < 20 ? 'neg' : ''}">${ore(r.residuoFinale)}</b>`);
  $('previsioneAnno').textContent = ultimiDati.anno;
  $('previsioneSintesi').innerHTML = pezzi.join(' · ');
  const p = r.pianificate;
  $('previsionePianificate').textContent = p.giorni === 0
    ? 'Nessuna giornata pianificata dopo oggi.'
    : `Già conteggiate: ${p.giorni === 1 ? '1 giornata pianificata' : `${p.giorni} giornate pianificate`} dopo oggi (ferie ${ore(p.f)}, permessi ${ore(p.p)}).`;
  // Mese della simulazione: di default il mese corrente (o gennaio per un anno futuro)
  if (!simMese.dataset.toccato) simMese.value = MESI[r.iCorrente === null ? 0 : r.iCorrente];
  simEsito.innerHTML = '';
}

simMese.addEventListener('change', () => { simMese.dataset.toccato = '1'; });

$('simulaForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!ultimiDati) return;
  const i = MESI.indexOf(simMese.value);
  let f, p;
  try {
    f = parseOre(simFerie.value, 'Ferie') || 0;
    p = parseOre(simPermessi.value, 'Permessi') || 0;
    if (f === 0 && p === 0) throw new ErroreValidazione('Inserisci le ore da simulare.');
  } catch (err) {
    simEsito.innerHTML = '';
    segnalaErrore(err, 'Simulazione', simEsito);
    return;
  }
  const sim = simulaPrevisione(ultimiDati, i, f, p);
  const cosa = [f ? `${ore(f)} di ferie` : '', p ? `${ore(p)} di permessi` : ''].filter(Boolean).join(' e ');
  const classe = (n) => n < 0 ? 'neg' : (n < 20 ? 'warn' : 'ok');
  simEsito.innerHTML = `
    <p>Con ${cosa} in ${MESI_LABEL[i]}:</p>
    <ul>
      <li>residuo di ${MESI_LABEL[i]}: <b class="${classe(sim.mesi[i].totale)}">${ore(sim.mesi[i].totale)}</b></li>
      <li>punto più basso da lì in poi: <b class="${classe(sim.minimo.valore)}">${ore(sim.minimo.valore)}</b> (${MESI_LABEL[sim.minimo.i]})</li>
      <li>fine anno: <b class="${classe(sim.finale)}">${ore(sim.finale)}</b> (oggi previsto ${ore(ultimiDati.mesi[11].totale)})</li>
    </ul>
    <p class="sim-nota">${sim.minimo.valore < 0 ? '⚠ In quel periodo andresti sotto zero.' : (sim.finale < 20 ? '⚠ A fine anno resteresti sotto le 20 ore.' : 'Ok: resti sopra le 20 ore.')} È solo una simulazione, niente viene salvato.</p>`;
});
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
  $('giornateTotale').textContent = `Totale mese: F ${ore(m.godF)} · P ${ore(m.godP)}`;
  const nGiorni = giornate.filter(g => !g.riporto).length;
  $('giornateConteggio').textContent = nGiorni === 0 ? '' : (nGiorni === 1 ? '1 giornata' : `${nGiorni} giornate`);

  const { min, max } = limitiMese(parseInt(ultimiDati.anno, 10), i);
  giornataData.min = min;
  giornataData.max = max;
  if (!giornataData.value || giornataData.value < min || giornataData.value > max) {
    const oggi = oggiISO();
    giornataData.value = oggi >= min && oggi <= max ? oggi : min;
  }
  aggiornaSuggerimentoTurno();

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
  const oggi = oggiISO();
  giornate.forEach(g => {
    const tr = document.createElement('tr');
    const pianificata = !g.riporto && g.data > oggi;
    if (g.riporto) tr.className = 'riporto';
    else if (pianificata) tr.className = 'pianificata';
    tr.innerHTML = `
      <td>${g.riporto ? 'Riporto' : dataIT(g.data)}${pianificata ? ' <span class="tag-pianificata">pianificata</span>' : ''}</td>
      <td class="num">${ore(parseFloat(g.ferie_ore), false)}</td>
      <td class="num">${ore(parseFloat(g.permessi_ore), false)}</td>
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
    const ok = confirm(`${MESI_LABEL[i]} ha già un totale senza dettaglio (ferie ${ore(r.ferie_ore)}, permessi ${ore(r.permessi_ore)}).\n\n` +
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
    giornataEntrata.value = '';
    giornataUscita.value = '';
    if (await caricaGriglia()) show(`Giornata del ${giornataData.value.split('-').reverse().join('/')} aggiunta.`, 'ok');
  } catch (err) {
    segnalaErrore(err, 'Aggiunta giornata', giornateMsg);
  } finally {
    btnAggiungiGiornata.disabled = false;
  }
});

// --- Permesso dagli orari e pulsanti rapidi ---
const giornataEntrata = $('giornataEntrata');
const giornataUscita = $('giornataUscita');
const turnoInfo = $('turnoInfo');

function turnoCorrente() {
  return { inizio: impostazioni.inizio, fine: impostazioni.fine, pausaInizio: impostazioni.pausaInizio, pausaFine: impostazioni.pausaFine };
}

function aggiornaSuggerimentoTurno() {
  const pausa = impostazioni.pausaInizio ? `, pausa ${impostazioni.pausaInizio}–${impostazioni.pausaFine}` : '';
  turnoInfo.textContent = `Turno ${impostazioni.inizio}–${impostazioni.fine}${pausa} (⏱ per cambiarlo)`;
}

// Entrata o uscita cambiata: calcola i permessi e propone una nota se è vuota
function calcolaDaOrari() {
  giornateMsg.textContent = '';
  if (!giornataEntrata.value && !giornataUscita.value) return;
  try {
    const h = oreDaOrari({ entrata: giornataEntrata.value, uscita: giornataUscita.value }, turnoCorrente());
    giornataPermessi.value = h > 0 ? oreInCampo(h, impostazioni.formato) : '';
    if (!giornataNota.value.trim() || giornataNota.dataset.auto === '1') {
      const parti = [];
      if (giornataEntrata.value) parti.push(`entrato ${giornataEntrata.value}`);
      if (giornataUscita.value) parti.push(`uscito ${giornataUscita.value}`);
      giornataNota.value = parti.join(', ');
      giornataNota.dataset.auto = '1';
    }
    if (h === 0) giornateMsg.textContent = 'Nessun permesso: l\'orario è dentro il turno.';
  } catch (err) {
    segnalaErrore(err, 'Calcolo orari', giornateMsg);
  }
}
giornataEntrata.addEventListener('change', calcolaDaOrari);
giornataUscita.addEventListener('change', calcolaDaOrari);
giornataNota.addEventListener('input', () => { delete giornataNota.dataset.auto; });

// +15 / +30 / +45 / +60 minuti di permesso
document.querySelectorAll('.btn-rapido').forEach(b => b.addEventListener('click', () => {
  let attuale = 0;
  try { attuale = parseOre(giornataPermessi.value, 'Permessi') || 0; } catch (e) { attuale = 0; }
  giornataPermessi.value = oreInCampo(arrotonda2(attuale + parseInt(b.dataset.minuti, 10) / 60), impostazioni.formato);
}));

// Export CSV di tutte le giornate dell'anno a video
$('btnEsportaGiornate').addEventListener('click', () => {
  if (!ultimiDati || !ultimiDati.giornate) return;
  if (ultimiDati.giornate.length === 0) { giornateMsg.textContent = `Nessuna giornata nel ${ultimiDati.anno} da esportare.`; return; }
  // BOM: così Excel riconosce l'UTF-8 (accenti nelle note)
  const blob = new Blob(['﻿' + csvGiornate(ultimiDati.giornate, oggiISO(), impostazioni.formato)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mie-ferie-giornate-${ultimiDati.anno}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  show(`Esportate ${ultimiDati.giornate.length} giornate del ${ultimiDati.anno}.`, 'ok');
});

async function eliminaGiornata(g) {
  const cosa = g.riporto ? 'la voce di riporto' : `la giornata del ${g.data.split('-').reverse().join('/')}`;
  if (!confirm(`Elimino ${cosa} (ferie ${ore(parseFloat(g.ferie_ore))}, permessi ${ore(parseFloat(g.permessi_ore))})?`)) return;
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
  renderPrevisione();
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
    const righe = piano.sovrascritti.map(c => `${c.nome} di ${MESI_LABEL[i]}: ${ore(c.da)} → ${ore(c.a)}`).join('\n');
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
  // Ore al mese precompilate: quelle dell'anno a video (gennaio) o, se mancano, dell'anno precedente
  const anno = currentAnno;
  $('maturazioneAnno').textContent = anno || '';
  $('maturazioneAnnoBtn').textContent = anno || '';
  let f = '', p = '';
  if (ultimiDati && ultimiDati.maturazioneCaricata) {
    f = ultimiDati.mesi[0].matF; p = ultimiDati.mesi[0].matP;
  } else if (ultimiDati && ultimiDati.maturazionePrecedente) {
    f = ultimiDati.maturazionePrecedente.f; p = ultimiDati.maturazionePrecedente.p;
  }
  $('maturazioneFerie').value = f === '' ? '' : oreInCampo(f, 'decimale');
  $('maturazionePermessi').value = p === '' ? '' : oreInCampo(p, 'decimale');
  popupMaturation.style.display = 'flex';
}

// Stesse ore maturate in tutti i 12 mesi dell'anno a video (niente più CSV per gli anni nuovi)
$('maturazioneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const anno = currentAnno;
  if (!anno) return;
  maturationMsg.textContent = '';
  let f, p;
  try {
    f = parseOre($('maturazioneFerie').value, 'Ferie al mese');
    p = parseOre($('maturazionePermessi').value, 'Permessi al mese');
    if (f === null || p === null) throw new ErroreValidazione('Inserisci le ore di ferie e di permessi maturate al mese.');
    if (f > 40 || p > 40) throw new ErroreValidazione('Più di 40 ore maturate al mese? Controlla i valori.');
  } catch (err) {
    segnalaErrore(err, 'Maturazione', maturationMsg);
    return;
  }
  // Se l'anno ha già una maturazione diversa (es. mesi diversi dal CSV) chiede conferma
  if (ultimiDati && ultimiDati.anno === String(anno) && ultimiDati.maturazioneCaricata) {
    const diverso = ultimiDati.mesi.some(m => m.matF !== f || m.matP !== p);
    if (diverso && !confirm(`Il ${anno} ha già una maturazione. La sostituisco con ${fmtIT(f)} ore di ferie e ${fmtIT(p)} di permessi in ogni mese?`)) return;
  }
  const btn = $('btnSalvaMaturazione');
  btn.disabled = true;
  try {
    const adesso = new Date().toISOString();
    await query(`Maturazione ${anno}`, sb.from(MATURAZIONE_TABLE).upsert(
      MESI.map(m => ({ anno: parseInt(anno, 10), mese: m, ferie_maturata: f, permessi_maturati: p, updated_at: adesso })),
      { onConflict: 'anno,mese' }));
    chiudiPopupMaturation();
    if (await caricaGriglia()) show(`Maturazione del ${anno} salvata.`, 'ok');
  } catch (err) {
    segnalaErrore(err, `Maturazione ${anno}`, maturationMsg);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Impostazioni: orario di lavoro e formato ore
// ---------------------------------------------------------------------------

const popupImpostazioni = $('popupImpostazioni');
const impMsg = $('impMsg');

async function caricaImpostazioni() {
  try {
    const r = await query('Lettura impostazioni', sb.from(IMPOSTAZIONI_TABLE)
      .select('inizio_turno, fine_turno, pausa_inizio, pausa_fine, formato_ore').maybeSingle());
    const hhmm = (t) => t ? String(t).slice(0, 5) : '';
    impostazioni = r ? {
      inizio: hhmm(r.inizio_turno), fine: hhmm(r.fine_turno),
      pausaInizio: hhmm(r.pausa_inizio), pausaFine: hhmm(r.pausa_fine),
      formato: r.formato_ore === 'hhmm' ? 'hhmm' : 'decimale'
    } : { ...IMPOSTAZIONI_PREDEFINITE };
  } catch (e) {
    // Senza impostazioni il sito funziona con i valori predefiniti: lo segnalo solo in console
    if (classificaErrore(e).tipo !== 'tabella-mancante') console.error('[mie-ferie] Impostazioni non lette:', e);
    impostazioni = { ...IMPOSTAZIONI_PREDEFINITE };
  }
}

function apriImpostazioni() {
  $('impInizio').value = impostazioni.inizio;
  $('impFine').value = impostazioni.fine;
  $('impPausaInizio').value = impostazioni.pausaInizio;
  $('impPausaFine').value = impostazioni.pausaFine;
  document.querySelector(`input[name="impFormato"][value="${impostazioni.formato}"]`).checked = true;
  impMsg.textContent = '';
  popupImpostazioni.style.display = 'flex';
}

function chiudiImpostazioni() {
  popupImpostazioni.style.display = 'none';
}

$('btnImpostazioni').addEventListener('click', apriImpostazioni);
$('btnAnnullaImpostazioni').addEventListener('click', chiudiImpostazioni);
popupImpostazioni.addEventListener('click', (e) => { if (e.target === popupImpostazioni) chiudiImpostazioni(); });

$('impostazioniForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nuove = {
    inizio: $('impInizio').value, fine: $('impFine').value,
    pausaInizio: $('impPausaInizio').value, pausaFine: $('impPausaFine').value,
    formato: document.querySelector('input[name="impFormato"]:checked').value
  };
  try {
    if (!nuove.inizio || !nuove.fine || nuove.fine <= nuove.inizio) throw new ErroreValidazione('La fine del turno deve essere dopo l\'inizio.');
    if (!!nuove.pausaInizio !== !!nuove.pausaFine) throw new ErroreValidazione('Indica sia l\'inizio sia la fine della pausa (oppure nessuno dei due).');
    if (nuove.pausaInizio && (nuove.pausaFine <= nuove.pausaInizio || nuove.pausaInizio < nuove.inizio || nuove.pausaFine > nuove.fine)) {
      throw new ErroreValidazione('La pausa deve stare dentro il turno.');
    }
  } catch (err) {
    segnalaErrore(err, 'Impostazioni', impMsg);
    return;
  }
  const btn = $('btnSalvaImpostazioni');
  btn.disabled = true;
  try {
    await query('Salvataggio impostazioni', sb.from(IMPOSTAZIONI_TABLE).upsert({
      inizio_turno: nuove.inizio, fine_turno: nuove.fine,
      pausa_inizio: nuove.pausaInizio || null, pausa_fine: nuove.pausaFine || null,
      formato_ore: nuove.formato, updated_at: new Date().toISOString()
    }, { onConflict: 'utente' }));
    impostazioni = nuove;
    chiudiImpostazioni();
    if (ultimiDati) render(ultimiDati); // ridisegna tutto nel nuovo formato
    show('Impostazioni salvate.', 'ok');
  } catch (err) {
    segnalaErrore(err, 'Salvataggio impostazioni', impMsg);
  } finally {
    btn.disabled = false;
  }
});

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
        <span class="report-card-val">${ore(tSel.matF + tSel.matP)}</span>
        <span class="report-card-sub">F ${ore(tSel.matF)} · P ${ore(tSel.matP)}</span>
      </div>
      <div class="report-card">
        <span class="report-card-label">Goduti totale</span>
        <span class="report-card-val">${ore(tSel.godF + tSel.godP)}</span>
        <span class="report-card-sub">F ${ore(tSel.godF)} · P ${ore(tSel.godP)}</span>
      </div>
      <div class="report-card ${tSel.residuoFinale < 20 ? 'report-card-warn' : ''}">
        <span class="report-card-label">Residuo finale</span>
        <span class="report-card-val">${ore(tSel.residuoFinale)}</span>
        <span class="report-card-sub">AP ${ore(tSel.apTot)}</span>
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
            <td data-label="Maturato">${ore(r.t.matF + r.t.matP)}</td>
            <td data-label="Goduti">${ore(r.t.godF + r.t.godP)}</td>
            <td data-label="AP">${ore(r.t.apTot)}</td>
            <td data-label="Residuo" class="${r.t.residuoFinale < 20 ? 'report-res-warn' : ''}">${ore(r.t.residuoFinale)}</td>
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
  const oreStorico = (n) => n === null || n === undefined ? '—' : ore(parseFloat(n), false);
  const cambio = (prima, dopo) => prima === dopo ? oreStorico(dopo) : `${oreStorico(prima)} → ${oreStorico(dopo)}`;
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
  // Gli anni stanno solo nella tabella "anni"; le impostazioni servono prima di disegnare
  try {
    [anni] = await Promise.all([caricaAnniDaSupabase(), caricaImpostazioni()]);
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
