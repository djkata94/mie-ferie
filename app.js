const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const ANNO_AP_TABLE = 'anno_ap';
const ANNI_TABLE = 'anni';
const MATURAZIONE_TABLE = 'maturazione_mensile';

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
const popupAnni = document.getElementById('popupAnni');
const listaAnni = document.getElementById('listaAnni');
const nuovoAnnoInput = document.getElementById('nuovoAnno');
const btnAggiungiAnno = document.getElementById('btnAggiungiAnno');
const btnChiudiAnni = document.getElementById('btnChiudiAnni');
const anniMsg = document.getElementById('anniMsg');
const popupMaturation = document.getElementById('popupMaturation');
const maturationFileInput = document.getElementById('maturationFileInput');
const btnImportaMaturation = document.getElementById('btnImportaMaturation');
const btnChiudiMaturation = document.getElementById('btnChiudiMaturation');
const maturationMsg = document.getElementById('maturationMsg');

function show(testo, tipo = 'info') {
  status.textContent = testo;
  status.style.color = tipo === 'ok' ? '#4ade80' : (tipo === 'err' ? '#f87171' : '#c99a4a');
  status.style.display = testo ? 'block' : 'none';
  if (tipo !== 'err') setTimeout(() => { status.style.display = 'none'; }, 3000);
}

// Popup per importazione maturazione
function apriPopupMaturation() {
  importMaturationOpen = true;
  if (maturationFileInput) maturationFileInput.value = '';
  if (maturationMsg) maturationMsg.textContent = '';
  if (popupMaturation) popupMaturation.style.display = 'flex';
}
function chiudiPopupMaturation() {
  importMaturationOpen = false;
  if (maturationMsg) maturationMsg.textContent = '';
  if (popupMaturation) popupMaturation.style.display = 'none';
}
async function importaMaturationDaFile() {
  if (!maturationFileInput || !maturationFileInput.files || maturationFileInput.files.length === 0) {
    if (maturationMsg) maturationMsg.textContent = 'Seleziona un file CSV';
    return;
  }
  const file = maturationFileInput.files[0];
  const testo = await new Promise((r, j) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.onerror = () => j(fr.error);
    fr.readAsText(file);
  });

  // Estrai l'anno dal nome del file (es. "Mie Ferie - 2026.csv")
  const nomeFile = file.name;
  const match = nomeFile.match(/Mie Ferie\s*-\s*(\d{4})\.csv/);
  if (!match) {
    if (maturationMsg) maturationMsg.textContent = 'Nome file non valido. Usa il formato "Mie Ferie - YYYY.csv"';
    return;
  }
  const anno = match[1];

  const rows = parseCSV(testo);
  // Le righe 2 e 3 (indici 1,2) contengono le maturazioni per ogni mese (col C-N)
  const rowFerie = rows[1] || [];
  const rowPermessi = rows[2] || [];

  const upsertRows = [];
  for (let i = 0; i < 12; i++) {
    const col = i + 2; // colonna C (indice 2) = Gennaio
    const mese = MESI[i];
    const f = parseIT(rowFerie[col]);
    const p = parseIT(rowPermessi[col]);
    upsertRows.push({ anno: parseInt(anno, 10), mese, ferie_maturata: f, permessi_maturati: p });
  }

  btnImportaMaturation.disabled = true;
  try {
    for (const r of upsertRows) {
      await salvaMaturazione(r.anno, r.mese, r.ferie_maturata, r.permessi_maturati);
    }
    show('Dati di maturazione importati con successo per ' + anno, 'ok');
    chiudiPopupMaturation();
    caricaGriglia();
  } catch (e) {
    show('Errore durante l importazione: ' + e.message, 'err');
  } finally {
    btnImportaMaturation.disabled = false;
  }
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

// Leggi dati dal Supabase
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

async function caricaMaturazione(anno) {
  try {
    const { data, error } = await sb
      .from(MATURAZIONE_TABLE)
      .select('mese, ferie_maturata, permessi_maturati')
      .eq('anno', parseInt(anno, 10))
      .order('mese', { ascending: true });
    if (error) {
      console.error('Errore caricaMaturazione:', error);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error('Eccezione caricaMaturazione:', e);
    return null;
  }
}

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

async function salvaMaturazione(anno, mese, ferie, permessi) {
  const { error } = await sb
    .from(MATURAZIONE_TABLE)
    .upsert({
      anno: parseInt(anno, 10),
      mese,
      ferie_maturata: parseFloat(ferie) || 0,
      permessi_maturati: parseFloat(permessi) || 0,
      updated_at: new Date().toISOString()
    }, { onConflict: ['anno', 'mese'] });
  if (error) throw error;
}

// Gestione anni da Supabase
async function caricaAnniDaSupabase() {
  try {
    const { data, error } = await sb.from(ANNI_TABLE).select('anno').order('anno', { ascending: true });
    if (error) {
      console.error('Errore caricaAnniDaSupabase:', error);
      return null;
    }
    return data ? data.map(r => String(r.anno)) : null;
  } catch (e) {
    console.error('Eccezione caricaAnniDaSupabase:', e);
    return null;
  }
}

async function aggiungiAnno(anno) {
  const { error } = await sb.from(ANNI_TABLE).upsert({ anno: parseInt(anno, 10) }, { onConflict: 'anno' });
  if (error) throw error;
}

async function rimuoviAnno(anno) {
  const { error } = await sb.from(ANNI_TABLE).delete().eq('anno', parseInt(anno, 10));
  if (error) throw error;
}

// Funzioni per il popup AP
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

// Popup gestione anni
function apriPopupAnni() {
  aggiornaListaAnni();
  if (popupAnni) popupAnni.style.display = 'flex';
}

function chiudiPopupAnni() {
  if (popupAnni) popupAnni.style.display = 'none';
  if (anniMsg) anniMsg.textContent = '';
}

if (btnChiudiAnni) btnChiudiAnni.addEventListener('click', chiudiPopupAnni);
if (popupAnni) popupAnni.addEventListener('click', (e) => {
  if (e.target === popupAnni) chiudiPopupAnni();
});

function aggiornaListaAnni() {
  if (!listaAnni) return;
  listaAnni.innerHTML = '';
  anni.forEach(a => {
    const row = document.createElement('div');
    row.className = 'anno-row';
    row.innerHTML = `
      <span>${a}</span>
      <button title="Rimuovi anno" onclick="rimuoviAnnoDaUI('${a}')">✕</button>
    `;
    listaAnni.appendChild(row);
  });
}

async function aggiungiAnnoDaUI() {
  const anno = nuovoAnnoInput ? nuovoAnnoInput.value : '';
  if (!anno || isNaN(parseInt(anno, 10))) {
    if (anniMsg) anniMsg.textContent = 'Inserisci un anno valido.';
    return;
  }
  if (anni.includes(anno)) {
    if (anniMsg) anniMsg.textContent = 'Anno già presente.';
    return;
  }
  if (btnAggiungiAnno) btnAggiungiAnno.disabled = true;
  try {
    await aggiungiAnno(anno);
    anni.push(anno);
    anni.sort();
    aggiornaSelectAnni();
    aggiornaListaAnni();
    if (nuovoAnnoInput) nuovoAnnoInput.value = '';
    if (anniMsg) anniMsg.textContent = '';
    show('Anno ' + anno + ' aggiunto.', 'ok');
    // Seleziona il nuovo anno e apri popup AP
    selAnno.value = anno;
    currentAnno = anno;
    chiudiPopupAnni();
    caricaGriglia();
  } catch (e) {
    if (anniMsg) anniMsg.textContent = 'Errore: ' + e.message;
  } finally {
    if (btnAggiungiAnno) btnAggiungiAnno.disabled = false;
  }
}

async function rimuoviAnnoDaUI(anno) {
  if (!confirm('Rimuovere l\'anno ' + anno + '?')) return;
  try {
    await rimuoviAnno(anno);
    anni = anni.filter(a => a !== anno);
    aggiornaSelectAnni();
    aggiornaListaAnni();
    show('Anno ' + anno + ' rimosso.', 'ok');
    // Se l'anno rimosso era selezionato, seleziona il primo disponibile
    if (currentAnno === anno && anni.length > 0) {
      selAnno.value = anni[0];
      currentAnno = anni[0];
      caricaGriglia();
    }
  } catch (e) {
    if (anniMsg) anniMsg.textContent = 'Errore: ' + e.message;
  }
}

// Calcola residui per un anno, replicando le formule del foglio Google (maturazione da Supabase)
async function calcolaAnno(anno) {
  let ferieMaturazione = [], permMaturazione = [], godFRow = [], godPRow = [];
  let maturazioneCaricata = false;
  let csvTrovato = false;

  try {
    const r = await fetch(`data/Mie Ferie - ${anno}.csv`);
    if (r.ok) {
      csvTrovato = true;
      const rows = parseCSV(await r.text());
      // La maturazione dai CSV: righe 2 e 3 (indici 1,2)
      ferieMaturazione = rows[1] || [];
      permMaturazione = rows[2] || [];
      // Goduti: righe 5 e 6 (indici 4,5)
      godFRow = rows[4] || [];
      godPRow = rows[5] || [];
    }
  } catch (e) {}

  // Carica maturazione da Supabase (se presente, sovrascrive CSV)
  const matSupabase = await caricaMaturazione(anno);
  if (matSupabase) {
    ferieMaturazione = [];
    permMaturazione = [];
    for (let i = 0; i < 12; i++) {
      const row = matSupabase.find(m => m.mese === MESI[i]);
      if (row) {
        ferieMaturazione[i + 2] = row.ferie_maturata; // colonna C (Gennaio)
        permMaturazione[i + 2] = row.permessi_maturati;
      }
    }
    maturazioneCaricata = true;
  }

  // --- AP: leggi da CSV (colonna B, indice 1) se presente e non vuoto ---
  // Nota: con maturazione da Supabase (o senza CSV) l'indice 1 e' undefined,
  // va trattato come cella vuota altrimenti l'AP risulterebbe bloccato a zero.
  const apFStr = ferieMaturazione[1] === undefined || ferieMaturazione[1] === null ? '' : String(ferieMaturazione[1]).trim();
  const apPStr = permMaturazione[1] === undefined || permMaturazione[1] === null ? '' : String(permMaturazione[1]).trim();
  let apFerie = parseIT(ferieMaturazione[1]);
  let apPermessi = parseIT(permMaturazione[1]);
  const apCSVVuoto = apFStr === '' && apPStr === '';

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
  if (anni.includes(annoPrev)) {
    try {
      const rPrev = await fetch(`data/Mie Ferie - ${annoPrev}.csv`);
      if (rPrev.ok) {
        const prevRows = parseCSV(await rPrev.text());
        for (let r = 0; r < prevRows.length; r++) {
          const row = prevRows[r];
          const joined = row.join(' ').toUpperCase();
          if (joined.includes('FERIE RESIDUE TEORIC')) {
            for (let c = row.length - 1; c >= 0; c--) {
              const v = parseIT(row[c]);
              if (String(row[c]) !== '' && !isNaN(v)) { suggerimentoF = v; break; }
            }
          }
          if (joined.includes('PERMESSI RESIDUI TEORIC')) {
            for (let c = row.length - 1; c >= 0; c--) {
              const v = parseIT(row[c]);
              if (String(row[c]) !== '' && !isNaN(v)) { suggerimentoP = v; break; }
            }
          }
        }
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
    const matF = parseIT(ferieMaturazione[col]);
    const matP = parseIT(permMaturazione[col]);
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

  return { anno, apFerie, apPermessi, apBloccato, mesi, suggerimentoF, suggerimentoP, maturazioneCaricata, csvTrovato };
}

function render(dati) {
  gridBody.innerHTML = '';

  // Banner se maturazione da Supabase (nessun CSV)
  if (dati.maturazioneCaricata && !dati.csvTrovato) {
    const trInfo = document.createElement('tr');
    trInfo.className = 'row-info';
    trInfo.innerHTML = `<td colspan="5" class="info-msg">⚠ Maturazione caricata da Supabase. Nessun CSV per ${dati.anno}.</td>`;
    gridBody.appendChild(trInfo);
  }

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

function aggiornaSelectAnni() {
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
}

async function loadAnni() {
  // Prova da Supabase (tabella anni)
  const anniSupabase = await caricaAnniDaSupabase();
  if (anniSupabase && anniSupabase.length > 0) {
    anni = anniSupabase;
  } else {
    // Fallback a anni.json (legacy)
    try {
      const r = await fetch('data/anni.json');
      if (r.ok) anni = await r.json();
    } catch (e) {}
    if (!anni || anni.length === 0) {
      anni = ["2026","2027","2028","2029","2030"];
    }
  }
  aggiornaSelectAnni();
  impostaMeseCorrente();
  caricaGriglia();
}

loadAnni();