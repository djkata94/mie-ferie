const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let anni = [];
let currentAnno = null;

const selAnno = document.getElementById('selAnno');
const mese = document.getElementById('mese');
const ferie = document.getElementById('ferie');
const permessi = document.getElementById('permessi');
const btnSalva = document.getElementById('btnSalva');
const status = document.getElementById('status');
const gridBody = document.getElementById('gridBody');

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
  return text.split('\n').map(line => line.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
}

// Cerca in una riga del CSV l'ultimo valore numerico (residuo teorico)
function trovaResiduoTeorico(rows, etichetta) {
  for (let r = 0; r < rows.length; r++) {
    if (!rows[r]) continue;
    const trovata = rows[r].some(cell => String(cell).includes(etichetta));
    if (trovata) {
      for (let c = rows[r].length - 1; c >= 0; c--) {
        const v = parseIT(rows[r][c]);
        if (String(rows[r][c]) !== '' && !isNaN(v)) return v;
      }
    }
  }
  return 0;
}

// Calcola residui per un anno: AP + maturazione (CSV) - goduto (Supabase)
async function calcolaAnno(anno) {
  const r = await fetch(`data/Mie Ferie - ${anno}.csv`);
  if (!r.ok) throw new Error('CSV non trovato per ' + anno);
  const rows = parseCSV(await r.text());

  const ferieRow = rows[1] || [];
  const permRow = rows[2] || [];
  const godFRow = rows[4] || [];
  const godPRow = rows[5] || [];

  // AP: se presente nel CSV (colonna B, indice 1) usa quello
  let apFerie = parseIT(ferieRow[1]);
  let apPermessi = parseIT(permRow[1]);

  // Se AP mancante e esiste anno precedente, prendi residuo teorico anno precedente
  const annoPrev = (parseInt(anno, 10) - 1).toString();
  if ((apFerie === 0 && apPermessi === 0) && anni.includes(annoPrev)) {
    const r2 = await fetch(`data/Mie Ferie - ${annoPrev}.csv`);
    if (r2.ok) {
      const prevRows = parseCSV(await r2.text());
      apFerie = trovaResiduoTeorico(prevRows, 'FERIE RESIDUE TEORICHE') || 0;
      apPermessi = trovaResiduoTeorico(prevRows, 'PERMESSI RESIDUI TEORICI') || 0;
    }
  }

  // Carica goduti da Supabase
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

  return { anno, apFerie, apPermessi, mesi };
}

function render(dati) {
  gridBody.innerHTML = '';

  // Riga AP
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

  try {
    const dati = await calcolaAnno(anno);
    render(dati);
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
