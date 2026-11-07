const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const ANNO_AP_TABLE = 'anno_ap';
const ANNI_TABLE = 'anni';
const MATURAZIONE_TABLE = 'maturazione_mensile';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let anni = [];
let currentAnno = null;
let ultimiDati = null;

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
const btnConfermaMaturation = document.getElementById('btnConfermaMaturation');
const maturationMsg = document.getElementById('maturationMsg');

// Messaggio di stato sotto il form. Un solo timer: un messaggio nuovo non viene
// nascosto dal timer di quello precedente; gli errori restano finché non arriva altro.
let showTimer = null;
function show(testo, tipo = 'info') {
  clearTimeout(showTimer);
  status.textContent = testo;
  status.style.color = tipo === 'ok' ? '#4ade80' : (tipo === 'err' ? '#f87171' : '#c99a4a');
  status.style.display = testo ? 'block' : 'none';
  if (testo && tipo !== 'err') showTimer = setTimeout(() => { status.style.display = 'none'; }, 3000);
}

// Popup per importazione maturazione
function apriPopupMaturation() {
  if (maturationFileInput) maturationFileInput.value = '';
  if (maturationMsg) maturationMsg.textContent = '';
  if (popupMaturation) popupMaturation.style.display = 'flex';
}
function chiudiPopupMaturation() {
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

  btnConfermaMaturation.disabled = true;
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
    btnConfermaMaturation.disabled = false;
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

// Leggi dati da Supabase. In caso di errore lanciano un'eccezione: meglio un messaggio
// d'errore che un AP "non impostato" o dei goduti a zero che sembrano veri.
async function caricaAP(anno) {
  const { data, error } = await sb
    .from(ANNO_AP_TABLE)
    .select('ap_ferie, ap_permessi, bloccato, ap_configurato')
    .eq('anno', parseInt(anno, 10))
    .maybeSingle();
  if (error) throw new Error('lettura AP ' + anno + ': ' + error.message);
  return data || { ap_ferie: 0, ap_permessi: 0, bloccato: false, ap_configurato: false };
}

async function caricaMaturazione(anno) {
  const { data, error } = await sb
    .from(MATURAZIONE_TABLE)
    .select('mese, ferie_maturata, permessi_maturati')
    .eq('anno', parseInt(anno, 10));
  if (error) throw new Error('lettura maturazione ' + anno + ': ' + error.message);
  return data || [];
}

async function caricaGoduti(anno) {
  const { data, error } = await sb
    .from('ferie_mensili')
    .select('mese, ferie_ore, permessi_ore')
    .eq('anno', parseInt(anno, 10));
  if (error) throw new Error('lettura goduti ' + anno + ': ' + error.message);
  return data || [];
}

async function salvaAP(anno, ferie, permessi) {
  const { error } = await sb
    .from(ANNO_AP_TABLE)
    .upsert({
      anno: parseInt(anno, 10),
      ap_ferie: parseFloat(ferie) || 0,
      ap_permessi: parseFloat(permessi) || 0,
      bloccato: true,
      ap_configurato: true,
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

// Esportazione backup dati Supabase (tutte le tabelle)
async function esportaBackup() {
  const tabelle = ['anni', 'ferie_mensili', 'anno_ap', 'maturazione_mensile'];
  const backup = {};
  try {
    for (const t of tabelle) {
      // Passa dal client sb così usa il token della sessione (le regole RLS lo richiedono)
      const { data, error } = await sb.from(t).select('*');
      if (error) throw new Error(`lettura ${t}: ${error.message}`);
      backup[t] = data;
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mie-ferie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    show('Backup esportato.', 'ok');
  } catch (e) {
    show('Errore export backup: ' + e.message, 'err');
  }
}

// --- Report / riepilogo annuale ---
function sommaMesi(dati) {
  let matF = 0, matP = 0, godF = 0, godP = 0;
  dati.mesi.forEach(m => { matF += m.matF; matP += m.matP; godF += m.godF; godP += m.godP; });
  const residuoFinale = dati.mesi.length ? dati.mesi[dati.mesi.length - 1].totale : 0;
  const apTot = (parseFloat(dati.apFerie) || 0) + (parseFloat(dati.apPermessi) || 0);
  return { matF, matP, godF, godP, residuoFinale, apTot };
}

async function apriReport() {
  const reportSection = document.getElementById('reportSection');
  if (!reportSection) return;
  reportSection.style.display = 'block';
  if (document.getElementById('reportAnno')) document.getElementById('reportAnno').textContent = currentAnno;
  await caricaReport();
}

function chiudiReport() {
  const reportSection = document.getElementById('reportSection');
  if (reportSection) reportSection.style.display = 'none';
}

function stampaReport() {
  window.print();
}

async function caricaReport() {
  const riepilogo = document.getElementById('reportRiepilogo');
  const confronto = document.getElementById('reportConfronto');
  if (!riepilogo || !confronto) return;

  show('Genero report...', 'info');

  // Riepilogo dell'anno selezionato (usa i dati già caricati in griglia)
  const annoSel = currentAnno;
  const datiSel = ultimiDati && String(ultimiDati.anno) === String(annoSel)
    ? ultimiDati
    : await calcolaAnno(annoSel);
  const tSel = sommaMesi(datiSel);

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

  // Confronto tra tutti gli anni
  const righe = [];
  for (const a of anni) {
    let dati;
    if (String(a) === String(annoSel)) {
      dati = datiSel;
    } else {
      try { dati = await calcolaAnno(a); } catch (e) { dati = null; }
    }
    if (!dati) continue;
    const t = sommaMesi(dati);
    righe.push({ anno: a, t, selezionato: String(a) === String(annoSel) });
  }

  confronto.innerHTML = `
    <table class="report-table">
      <thead>
        <tr>
          <th>Anno</th><th>Maturato</th><th>Goduti</th><th>AP</th><th>Residuo</th>
        </tr>
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

  show('', 'info');
}

// Gestione anni da Supabase
async function caricaAnniDaSupabase() {
  const { data, error } = await sb.from(ANNI_TABLE).select('anno').order('anno', { ascending: true });
  if (error) throw new Error('lettura anni: ' + error.message);
  return (data || []).map(r => String(r.anno));
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

// Bottone "Imposta AP" della barra: popup con il suggerimento calcolato per l'anno a video
btnModificaAP?.addEventListener('click', () => {
  if (!currentAnno) return;
  const d = ultimiDati && String(ultimiDati.anno) === String(currentAnno) ? ultimiDati : null;
  apriPopupAP(currentAnno, d ? d.suggerimentoF : '', d ? d.suggerimentoP : '');
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
  if (!/^\d{4}$/.test(anno) || anno < '2000' || anno > '2100') {
    if (anniMsg) anniMsg.textContent = 'Inserisci un anno valido (2000–2100).';
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
  const msg = `Togliere il ${anno} dalla lista degli anni?\n\n` +
    `Goduti, AP e maturazione del ${anno} restano salvati: se riaggiungi l'anno ricompaiono.`;
  if (!confirm(msg)) return;
  try {
    await rimuoviAnno(anno);
    const eraVisualizzato = currentAnno === anno;
    anni = anni.filter(a => a !== anno);
    aggiornaSelectAnni();
    aggiornaListaAnni();
    show('Anno ' + anno + ' tolto dalla lista.', 'ok');
    // aggiornaSelectAnni ha già scelto un altro anno (o nessuno): ricarica se la griglia mostrava quello tolto
    if (eraVisualizzato) caricaGriglia();
  } catch (e) {
    if (anniMsg) anniMsg.textContent = 'Errore: ' + e.message;
  }
}

// Calcola i residui di un anno replicando le formule del foglio Google.
// Tutti i dati arrivano da Supabase: maturazione_mensile, anno_ap, ferie_mensili.
// Residuo mese = residuo precedente + maturazione - goduti (ferie e permessi separati, partendo dall'AP).
async function calcolaAnno(anno, { conSuggerimento = true } = {}) {
  const [maturazione, ap, goduti] = await Promise.all([
    caricaMaturazione(anno),
    caricaAP(anno),
    caricaGoduti(anno)
  ]);

  const matMap = {};
  maturazione.forEach(r => { matMap[r.mese] = { f: parseFloat(r.ferie_maturata) || 0, p: parseFloat(r.permessi_maturati) || 0 }; });
  const godMap = {};
  goduti.forEach(r => { godMap[r.mese] = { f: parseFloat(r.ferie_ore) || 0, p: parseFloat(r.permessi_ore) || 0 }; });

  // AP valido solo se confermato dal popup (bloccato + ap_configurato)
  const apConfigurato = ap.bloccato === true && ap.ap_configurato === true;
  const apFerie = apConfigurato ? (parseFloat(ap.ap_ferie) || 0) : 0;
  const apPermessi = apConfigurato ? (parseFloat(ap.ap_permessi) || 0) : 0;

  const mesi = [];
  let runningF = apFerie;
  let runningP = apPermessi;
  for (let i = 0; i < 12; i++) {
    const mat = matMap[MESI[i]] || { f: 0, p: 0 };
    const god = godMap[MESI[i]] || { f: 0, p: 0 };
    runningF += (mat.f - god.f);
    runningP += (mat.p - god.p);
    mesi.push({
      nome: MESI_LABEL[i],
      matF: mat.f, matP: mat.p, godF: god.f, godP: god.p,
      resF: runningF, resP: runningP,
      totale: runningF + runningP
    });
  }

  // Suggerimento AP: residuo reale di dicembre dell'anno precedente (calcolato dagli stessi dati)
  let suggerimentoF = 0;
  let suggerimentoP = 0;
  const annoPrev = String(parseInt(anno, 10) - 1);
  if (conSuggerimento && !apConfigurato && anni.includes(annoPrev)) {
    try {
      const prev = await calcolaAnno(annoPrev, { conSuggerimento: false });
      const dic = prev.mesi[11];
      suggerimentoF = Math.round(dic.resF * 100) / 100;
      suggerimentoP = Math.round(dic.resP * 100) / 100;
    } catch (e) {
      console.error('Suggerimento AP non disponibile:', e);
    }
  }

  return {
    anno, apFerie, apPermessi,
    apBloccato: apConfigurato, apConfigurato,
    mesi, suggerimentoF, suggerimentoP,
    maturazioneCaricata: maturazione.length > 0
  };
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

  // Barra AP: visibile finché l'AP non è stato configurato (flag ap_configurato)
  const apEffettivamenteBloccato = dati.apBloccato && dati.apConfigurato;

  if (apEffettivamenteBloccato) {
    if (apBar) apBar.style.display = 'none';
    const trAP = document.createElement('tr');
    trAP.className = 'row-ap';
    trAP.innerHTML = `
      <td data-label="AP">AP (Anno Prec.)</td>
      <td class="god-val" data-label="Godute">- / -</td>
      <td class="res-val" data-label="Resid. Ferie">${fmtIT(dati.apFerie)}h</td>
      <td class="res-val" data-label="Resid. Permessi">${fmtIT(dati.apPermessi)}h</td>
      <td class="tot-val" data-label="Totale">${fmtIT(dati.apFerie + dati.apPermessi)}h</td>
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
      <td data-label="AP">AP (Anno Prec.)</td>
      <td class="god-val" data-label="Godute">- / -</td>
      <td class="res-val" data-label="Resid. Ferie">-</td>
      <td class="res-val" data-label="Resid. Permessi">-</td>
      <td class="tot-val" data-label="Totale">-</td>
    `;
    gridBody.appendChild(trAP);
  }

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
  const sogliaContainer = document.getElementById('sogliaAlert');
  const ultimo = dati.mesi[dati.mesi.length - 1];
  if (ultimo && ultimo.totale < 20) {
    if (sogliaContainer) {
      sogliaContainer.innerHTML = `⚠ Attenzione: residuo totale di ${fmtIT(ultimo.totale)}h (inferiore a 20h).`;
      sogliaContainer.style.display = 'block';
    }
  } else if (sogliaContainer) {
    sogliaContainer.style.display = 'none';
  }

  precompilaMese();
}

// Mostra nel form i goduti già salvati per il mese selezionato
function precompilaMese() {
  const i = MESI.indexOf(mese.value);
  const m = ultimiDati && i >= 0 ? ultimiDati.mesi[i] : null;
  ferie.value = m ? m.godF : '';
  permessi.value = m ? m.godP : '';
}
mese.addEventListener('change', precompilaMese);

// Griglia vuota quando non c'è nessun anno (es. dopo averli rimossi tutti)
function mostraNessunAnno() {
  ultimiDati = null;
  currentAnno = null;
  if (apBar) apBar.style.display = 'none';
  const soglia = document.getElementById('sogliaAlert');
  if (soglia) soglia.style.display = 'none';
  gridBody.innerHTML = `<tr class="row-info"><td colspan="5" class="info-msg">Nessun anno: aggiungine uno con ⚙.</td></tr>`;
  precompilaMese();
}

let caricamentoId = 0;
async function caricaGriglia() {
  const anno = selAnno.value;
  if (!anno) { mostraNessunAnno(); return true; }
  currentAnno = anno;
  // Se si cambia anno prima che il caricamento precedente finisca, vince l'ultimo
  const mioId = ++caricamentoId;
  ultimiDati = null;
  show('Caricamento...', 'info');
  gridBody.innerHTML = '';
  if (apBar) apBar.style.display = 'none';

  try {
    const dati = await calcolaAnno(anno);
    if (mioId !== caricamentoId) return false;
    ultimiDati = dati;
    render(dati);

    // Popup AP automatico solo per l'anno in corso; per gli altri anni basta la barra "Imposta AP"
    if (!dati.apBloccato && anno === String(new Date().getFullYear())) {
      setTimeout(() => {
        apriPopupAP(anno, dati.suggerimentoF, dati.suggerimentoP);
      }, 400);
    }

    show('', 'info');
    return true;
  } catch (e) {
    if (mioId !== caricamentoId) return false;
    show('Errore nel caricamento: ' + e.message, 'err');
    return false;
  }
}

const MAX_ORE_MESE = 200;

// Legge un campo ore: vuoto = "non modificare" (null), altrimenti numero tra 0 e MAX_ORE_MESE
function leggiOre(input, nome) {
  // Con type="number" un testo non valido arriva come stringa vuota: non va scambiato per "vuoto"
  if (input.validity && input.validity.badInput) throw new Error(`${nome}: valore non valido.`);
  const s = input.value.trim();
  if (s === '') return null;
  const n = parseFloat(s.replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new Error(`${nome}: inserisci un numero di ore maggiore o uguale a 0.`);
  if (n > MAX_ORE_MESE) throw new Error(`${nome}: ${fmtIT(n)} ore in un mese sono troppe (massimo ${MAX_ORE_MESE}).`);
  return Math.round(n * 100) / 100;
}

async function inviaDati() {
  const anno = selAnno.value;
  const m = mese.value;
  const i = MESI.indexOf(m);
  if (!anno || i < 0 || !ultimiDati || String(ultimiDati.anno) !== String(anno)) {
    show('Attendi il caricamento dell\'anno prima di salvare.', 'err');
    return;
  }

  let nuovaF, nuovaP;
  try {
    nuovaF = leggiOre(ferie, 'Ferie');
    nuovaP = leggiOre(permessi, 'Permessi');
  } catch (e) {
    show(e.message, 'err');
    return;
  }
  if (nuovaF === null && nuovaP === null) {
    show('Inserisci le ore di ferie o di permessi (0 per azzerare).', 'err');
    return;
  }

  // Campo vuoto = mantieni il valore attuale (prima veniva salvato 0, cancellando il dato)
  const attuale = ultimiDati.mesi[i];
  const f = nuovaF === null ? attuale.godF : nuovaF;
  const p = nuovaP === null ? attuale.godP : nuovaP;

  const cambi = [];
  if (f !== attuale.godF) cambi.push({ nome: 'Ferie', da: attuale.godF, a: f });
  if (p !== attuale.godP) cambi.push({ nome: 'Permessi', da: attuale.godP, a: p });
  if (cambi.length === 0) {
    show('Nessuna modifica da salvare.', 'info');
    return;
  }
  // Conferma solo se si sovrascrive un valore già registrato (diverso da 0)
  const sovrascritti = cambi.filter(c => c.da !== 0);
  if (sovrascritti.length > 0) {
    const righe = sovrascritti.map(c => `${c.nome} di ${MESI_LABEL[i]}: ${fmtIT(c.da)} → ${fmtIT(c.a)}`).join('\n');
    if (!confirm(`Modifico i valori già salvati?\n\n${righe}`)) return;
  }

  btnSalva.disabled = true;
  show('Invio in corso...', 'info');
  try {
    const { error } = await sb
      .from('ferie_mensili')
      .upsert({
        anno: parseInt(anno, 10),
        mese: m,
        ferie_ore: f,
        permessi_ore: p,
        updated_at: new Date().toISOString()
      }, { onConflict: 'anno,mese' });
    if (error) throw error;

    if (await caricaGriglia()) show(`Salvato ${MESI_LABEL[i]}.`, 'ok');
    else show(`Salvato ${MESI_LABEL[i]}, ma la griglia non si è ricaricata: aggiorna la pagina.`, 'err');
  } catch (e) {
    show('Errore salvataggio: ' + e.message, 'err');
  } finally {
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

document.getElementById('btnExportBackup')?.addEventListener('click', esportaBackup);
document.getElementById('btnReport')?.addEventListener('click', apriReport);
document.getElementById('btnChiudiReport')?.addEventListener('click', chiudiReport);
document.getElementById('btnStampaReport')?.addEventListener('click', stampaReport);

async function loadAnni() {
  // Gli anni stanno solo nella tabella "anni" (niente più anni.json né lista fissa)
  try {
    anni = await caricaAnniDaSupabase();
  } catch (e) {
    show('Errore nel caricamento: ' + e.message, 'err');
    return;
  }
  aggiornaSelectAnni();
  impostaMeseCorrente();
  caricaGriglia();
}

// --- Login (Supabase Auth) ---
// Le regole RLS concedono i dati solo all'utente autenticato: senza sessione
// si vede soltanto il riquadro di accesso.
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const btnLogin = document.getElementById('btnLogin');
const loginMsg = document.getElementById('loginMsg');
let appAvviata = false;

function mostraLogin() {
  appAvviata = false;
  document.body.classList.add('non-autenticato');
  gridBody.innerHTML = '';
  ultimiDati = null;
  chiudiReport();
  if (loginPassword) loginPassword.value = '';
  if (loginEmail) loginEmail.focus();
}

function avviaApp() {
  document.body.classList.remove('non-autenticato');
  if (loginMsg) loginMsg.textContent = '';
  if (appAvviata) return; // SIGNED_IN può arrivare più volte (es. al ritorno sulla scheda)
  appAvviata = true;
  // Fuori dalla callback di onAuthStateChange: chiamare Supabase lì dentro può bloccarsi
  setTimeout(loadAnni, 0);
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (loginMsg) loginMsg.textContent = '';
  btnLogin.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });
    if (error) throw error;
    // avviaApp() parte da onAuthStateChange (SIGNED_IN)
  } catch (err) {
    if (loginMsg) loginMsg.textContent = err.message === 'Invalid login credentials'
      ? 'Email o password errate.'
      : 'Accesso non riuscito: ' + err.message;
  } finally {
    btnLogin.disabled = false;
  }
});

document.getElementById('btnLogout')?.addEventListener('click', async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((event, session) => {
  if (session) avviaApp();
  else mostraLogin();
});