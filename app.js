const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const ANNO_AP_TABLE = 'anno_ap';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let anni = [];
let currentAnno = null;
let apBloccato = false;
let apValori = { ferie: 0, permessi: 0 };

const selAnno = document.getElementById('selAnno');
const apBar = document.getElementById('apBar');
const apLabel = document.getElementById('apLabel');
const apVal = document.getElementById('apVal');
const btnModificaAP = document.getElementById('btnModificaAP');
const mese = document.getElementById('mese');
const ferie = document.getElementById('ferie');
const permessi = document.getElementById('permessi');
const btnSalva = document.getElementById('btnSalva');
const status = document.getElementById('status');
const gridBody = document.getElementById('gridBody');
const popupAP = document.getElementById('popupAP');
const apAnnoSpan = document.getElementById('apAnno');
const apFerieInput = document.getElementById('apFerie');
const apPermessiInput = document.getElementById('apPermessi');
const btnConfermaAP = document.getElementById('btnConfermaAP');
const btnAnnullaAP = document.getElementById('btnAnnullaAP');
const apMsg = document.getElementById('apMsg');

function show(testo, tipo = 'info') {
  status.textContent = testo;
  status.style.color = tipo === 'ok' ? '#4ade80' : (tipo === 'err' ? '#f87171' : '#c99a4a');
  status.style.display = testo ? 'block' : 'none';
  if (tipo !== 'err') setTimeout(() => { status.style.display = 'none'; }, 3000);
}

function parseIT(s) {
  if (s === null || s === undefined || String(s).trim() === '' || String(s).trim() === '-') return 0;
  return parseFloat(String(s).replace(',', '.')) || 0;
}

function fmtIT(n) {
  return n.toFixed(2).replace('.', ',');
}

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

// Legge AP da Supabase. Restituisce sempre un oggetto (mai null).
async function caricaAP(anno) {
  try {
    const { data, error } = await sb
      .from(ANNO_AP_TABLE)
      .select('ap_ferie, ap_permessi, bloccato')
      .eq('anno', parseInt(anno, 10))
      .maybeSingle();
    if (error) {
      console.error('Errore caricaAP:', error);
      return { ap_ferie: 0, ap_permessi: 0, bloccato: false };
    }
    return data || { ap_ferie: 0, ap_permessi: 0, bloccato: false };
  } catch (e) {
    console.error('Eccezione caricaAP:', e);
    return { ap_ferie: 0, ap_permessi: 0, bloccato: false };
  }
}

// Salva/blocca AP su Supabase.
async function salvaAP(anno, ferie, permessi) {
  const { error } = await sb
    .from(ANNO_AP_TABLE)
    .upsert({
      anno: parseInt(anno, 10),
      ap_ferie: parseFloat(ferie) || 0,
      ap_permessi: parseFloat(permessi) || 0,
      bloccato: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'anno' });
  if (error) throw error;
}

function chiudiPopupAP() {
  if (popupAP) popupAP.style.display = 'none';
  if (apMsg) apMsg.textContent = '';
}

if (btnAnnullaAP) btnAnnullaAP.addEventListener('click', chiudiPopupAP);
if (popupAP) popupAP.addEventListener('click', (e) => {
  if (e.target === popupAP) chiudiPopupAP();
});

function apriPopupAP(anno, suggerimentoF, suggerimentoP) {
  if (apAnnoSpan) apAnnoSpan.textContent = anno;
  if (apFerieInput) apFerieInput.value = suggerimentoF !== undefined && suggerimentoF !== null ? suggerimentoF : '';
  if (apPermessiInput) apPermessiInput.value = suggerimentoP !== undefined && suggerimentoP !== null ? suggerimentoP : '';
  if (apMsg) apMsg.textContent = '';
  if (popupAP) {
    popupAP.style.display = 'flex';
    if (apFerieInput) apFerieInput.focus();
  }
}

if (btnConfermaAP) btnConfermaAP.addEventListener('click', async () => {
  const anno = apAnnoSpan ? apAnnoSpan.textContent : currentAnno;
  const f = apFerieInput ? apFerieInput.value : '';
  const p = apPermessiInput ? apPermessiInput.value : '';
  if (f === '' && p === '') {
    if (apMsg) apMsg.textContent = 'Inserisci almeno un valore.';
    return;
  }
  if (btnConfermaAP) btnConfermaAP.disabled = true;
  try {
    await salvaAP(anno, f, p);
    apBloccato = true;
    apValori = { ferie: parseFloat(f) || 0, permessi: parseFloat(p) || 0 };
    chiudiPopupAP();
    show('AP salvato e bloccato.', 'ok');
    caricaGriglia();
  } catch (e) {
    show('Errore salvataggio AP: ' + e.message, 'err');
  } finally {
    if (btnConfermaAP) btnConfermaAP.disabled = false;
  }
});

// Calcola residui per un anno, replicando le formule del foglio Google:
//   C7 = SUM(B2:C2)+SUM(B3:C3)-C5-C6
//   D7 = C7+SUM(D2:D3)-D5-D6   (ecc. per ogni mese)
//   O9 = O2-O5   (ferie residue teoriche)
//   O10 = O3-O6  (permessi residue teoriche)
async function calcolaAnno(anno) {
  const r = await fetch(`data/Mie Ferie - ${anno}.csv`);
  if (!r.ok) throw new Error('CSV non trovato per ' + anno);
  const rows = parseCSV(await r.text());

  const ferieRow = rows[1] || [];
  const permRow = rows[2] || [];
  const godFRow = rows[4] || [];
  const godPRow = rows[5] || [];

  // --- AP: leggi da CSV (colonna B, indice 1) se presente e non vuoto ---
  let apFerie = parseIT(ferieRow[1]);
  let apPermessi = parseIT(permRow[1]);
  const apCSVVuoto = String(ferieRow[1]).trim() === '' && String(permRow[1]).trim() === '';

  let apDaSupabase = null;
  if (apCSVVuoto) {
    apDaSupabase = await caricaAP(anno);
    if (apDaSupabase && apDaSupabase.bloccato === true) {
      apFerie = parseFloat(apDaSupabase.ap_ferie) || 0;
      apPermessi = parseFloat(apDaSupabase.ap_permessi) || 0;
      apBloccato = true;
      apValori = { ferie: apFerie, permessi: apPermessi };
    } else {
      apBloccato = false;
      apValori = { ferie: 0, permessi: 0 };
    }
  } else {
    // AP presente nel CSV: consideriamolo già definito (bloccato)
    apBloccato = true;
    apValori = { ferie: apFerie, permessi: apPermessi };
  }

  // --- Suggerimento AP: residuo dicembre dell'anno precedente ---
  let suggerimentoF = 0;
  let suggerimentoP = 0;
  const annoPrev = (parseInt(anno, 10) - 1).toString();
  if (!apBloccato && anni.includes(annoPrev)) {
    try {
      const prevDati = await calcolaAnno(annoPrev);
      if (prevDati && prevDati.mesi && prevDati.mesi[11]) {
        suggerimentoF = prevDati.mesi[11].resF;
        suggerimentoP = prevDati.mesi[11].resP;
      }
    } catch (e) {
      // ignorato: suggerimento resta 0
    }
  }

  // --- Carica goduti da Supabase ---
  const { data: dbRows } = await sb
    .from('ferie_mensili')
    .select('mese, ferie_ore, permessi_ore')
    .eq('anno', parseInt(anno, 10));

  const dbMap = {};
  if (dbRows) {
    dbRows.forEach(row => { dbMap[row.mese] = { f: parseFloat(row.ferie_ore), p: parseFloat(row.permessi_ore) }; });
  }

  const mesi = [];
  let runningF = apFerie;
  let runningP = apPermessi;

  for (let i = 0; i < 12; i++) {
    const col = i + 2; // colonna C (indice 2) = Gennaio
    const matF = parseIT(ferieRow[col]);
    const matP = parseIT(permRow[col]);
    const saved = dbMap[MESI[i]];
    const godF = saved !== undefined ? saved.f : parseIT(godFRow[col]);
    const godP = saved !== undefined ? saved.p : parseIT(godPRow[col]);

    runningF += (matF - godF);
    runningP += (matP - godP);

    mesi.push({
      nome: MESI_LABEL[i],
      matF, matP, godF, godP,
      resF: runningF, resP: runningP,
      totale: runningF + runningP
    });
  }

  return { anno, apFerie, apPermessi, apBloccato, mesi, suggerimentoF, suggerimentoP };
}

function render(dati) {
  gridBody.innerHTML = '';

  // Barra AP: visibile se AP non bloccato, oppure se bloccato ma a zero (da impostare)
  const apEffettivamenteBloccato = dati.apBloccato && !(dati.apFerie === 0 && dati.apPermessi === 0);

  if (apEffettivamenteBloccato) {
    if (apBar) apBar.style.display = 'none';
    const trAP = document.createElement('tr');
    trAP.className = 'row-ap';
    trAP.innerHTML = `
      <td>AP (Anno Prec.)</td>
      <td class="god-val">- / -</td>
      <td class="res-val">${fmtIT(dati.apFerie)}h</td>
      <td class="res-val">${fmtIT(dati.apPermessi)}h</td>
      <td class="tot-val">${fmtIT(dati.apFerie + dati.apPermessi)}h</td>
    `;
    gridBody.appendChild(trAP);
  } else {
    if (apBar) {
      apBar.style.display = 'block';
      if (apLabel) apLabel.textContent = 'AP (Anno Prec.):';
      if (apVal) apVal.textContent = 'non impostato';
    }
    const trAP = document.createElement('tr');
    trAP.className = 'row-ap';
    trAP.innerHTML = `
      <td>AP (Anno Prec.)</td>
      <td class="god-val">- / -</td>
      <td class="res-val">-</td>
      <td class="res-val">-</td>
      <td class="tot-val">-</td>
    `;
    gridBody.appendChild(trAP);
  }

  dati.mesi.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.nome}</td>
      <td class="god-val">${fmtIT(m.godF)} / ${fmtIT(m.godP)}</td>
      <td class="res-val">${fmtIT(m.resF)}h</td>
      <td class="res-val">${fmtIT(m.resP)}h</td>
      <td class="tot-val">${fmtIT(m.totale)}h</td>
    `;
    gridBody.appendChild(tr);
  });

  mese.value = MESI[new Date().getMonth()];
  ferie.value = '';
  permessi.value = '';
}

async function caricaGriglia() {
  const anno = selAnno.value;
  if (!anno) return;
  currentAnno = anno;
  show('Caricamento...', 'info');
  gridBody.innerHTML = '';
  if (apBar) apBar.style.display = 'none';

  try {
    const dati = await calcolaAnno(anno);
    render(dati);

    // Se AP non bloccato e valore zero, apri popup dopo breve ritardo
    if (!dati.apBloccato && dati.apFerie === 0 && dati.apPermessi === 0) {
      setTimeout(() => {
        apriPopupAP(anno, dati.suggerimentoF, dati.suggerimentoP);
      }, 400);
    }

    show('', 'info');
  } catch (e) {
    show('Errore nel caricamento: ' + e.message, 'err');
  }
}

async function inviaDati() {
  const anno = selAnno.value;
  const m = mese.value;
  const f = ferie.value;
  const p = permessi.value;
  btnSalva.disabled = true;
  show('Invio in corso...', 'info');

  try {
    const { error } = await sb
      .from('ferie_mensili')
      .upsert({
        anno: parseInt(anno, 10),
        mese: m,
        ferie_ore: parseFloat(f) || 0,
        permessi_ore: parseFloat(p) || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'anno, mese' });

    if (error) throw error;

    show('Salvato.', 'ok');
    btnSalva.disabled = false;
    setTimeout(() => { status.style.display = 'none'; }, 3000);
    ferie.value = '';
    permessi.value = '';
    caricaGriglia();
  } catch (e) {
    show('Errore salvataggio: ' + e.message, 'err');
    btnSalva.disabled = false;
  }
}

function impostaMeseCorrente() {
  mese.value = MESI[new Date().getMonth()];
}

async function loadAnni() {
  try {
    const r = await fetch('data/anni.json');
    if (!r.ok) throw new Error('lista anni non trovata');
    anni = await r.json();
  } catch (e) {
    anni = ["2026","2027","2028","2029","2030"];
  }

  selAnno.innerHTML = '';
  anni.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.innerText = a;
    selAnno.appendChild(opt);
  });

  const annoCorrente = new Date().getFullYear().toString();
  selAnno.value = anni.includes(annoCorrente) ? annoCorrente : anni[anni.length - 1];
  currentAnno = selAnno.value;
  impostaMeseCorrente();
  caricaGriglia();
}

loadAnni();