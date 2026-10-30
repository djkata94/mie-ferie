const API_BASE = 'data';
let anni = [];
let currentAnno = null;
let cache = {}; // anno -> { anno, apFerie, apPermessi, mesi[] }

const annoSel = document.getElementById('anno');
const meseSel = document.getElementById('mese');
const ferieIn = document.getElementById('ferie');
const permessiIn = document.getElementById('permessi');
const form = document.getElementById('form');
const tbody = document.getElementById('tbody');
const msg = document.getElementById('msg');

const MESI = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
const MESI_LABEL = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

function show(testo, tipo = 'info') {
  msg.textContent = testo;
  msg.className = 'msg ' + tipo;
  msg.style.display = testo ? 'block' : 'none';
  if (tipo !== 'err') {
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
}

function parseIT(s) {
  if (s === null || s === undefined || String(s).trim() === '') return 0;
  return parseFloat(String(s).replace(',', '.')) || 0;
}

function fmtIT(n) {
  return n.toFixed(2).replace('.', ',');
}

function parseCSV(text) {
  return text.split('\n').map(line => line.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
}

// Calcola i dati per un anno. Se apFerie/apPermessi sono passati, li usa come AP
// (riporto dall'anno precedente), altrimenti legge la colonna B del CSV.
function calcola(anno, rows, apFerieOverride, apPermessiOverride) {
  const ferieRow = rows[1] || [];
  const permRow = rows[2] || [];
  const godFRow = rows[4] || [];
  const godPRow = rows[5] || [];

  const apFerie = apFerieOverride !== undefined ? apFerieOverride : parseIT(ferieRow[1]);
  const apPermessi = apPermessiOverride !== undefined ? apPermessiOverride : parseIT(permRow[1]);

  const salvati = JSON.parse(localStorage.getItem('mf_goduti_' + anno) || '{}');

  const mesi = [];
  let runningF = apFerie;
  let runningP = apPermessi;

  for (let i = 0; i < 12; i++) {
    const col = i + 2; // 0 etichetta, 1 AP, 2..13 mesi
    const matF = parseIT(ferieRow[col]);
    const matP = parseIT(permRow[col]);
    const saved = salvati[MESI[i]];
    const godF = saved !== undefined ? parseIT(saved.f) : parseIT(godFRow[col]);
    const godP = saved !== undefined ? parseIT(saved.p) : parseIT(godPRow[col]);

    runningF += (matF - godF);
    runningP += (matP - godP);

    mesi.push({
      nome: MESI[i],
      label: MESI_LABEL[i],
      matF, matP, godF, godP,
      resF: runningF, resP: runningP,
      totale: runningF + runningP
    });
  }

  return { anno, apFerie, apPermessi, mesi };
}

function render(dati) {
  tbody.innerHTML = '';

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
  tbody.appendChild(trAP);

  dati.mesi.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.label}</td>
      <td class="god-val">${fmtIT(m.godF)}</td>
      <td class="god-val">${fmtIT(m.godP)}</td>
      <td class="res-val">${fmtIT(m.resF)}h</td>
      <td class="res-val">${fmtIT(m.resP)}h</td>
      <td class="tot-val">${fmtIT(m.totale)}h</td>
    `;
    tbody.appendChild(tr);
  });

  // Preseleziona mese corrente
  meseSel.value = MESI[new Date().getMonth()];
  ferieIn.value = '';
  permessiIn.value = '';
}

async function caricaAnno(anno) {
  currentAnno = anno;
  show('Caricamento...', 'info');
  tbody.innerHTML = '';

  try {
    const r = await fetch(`data/${anno}.csv`);
    if (!r.ok) throw new Error('CSV non trovato per ' + anno);
    const text = await r.text();
    const rows = parseCSV(text);

    let apFerie = parseIT(rows[1]?.[1]);
    let apPermessi = parseIT(rows[2]?.[1]);

    // Se AP è zero/mancante e esiste l'anno precedente, usa il suo residuo di dicembre
    const annoPrev = (parseInt(anno, 10) - 1).toString();
    if ((apFerie === 0 && apPermessi === 0) && anni.includes(annoPrev)) {
      if (cache[annoPrev]) {
        apFerie = cache[annoPrev].mesi[11].resF;
        apPermessi = cache[annoPrev].mesi[11].resP;
      } else {
        const r2 = await fetch(`data/${annoPrev}.csv`);
        if (r2.ok) {
          const prev = calcola(annoPrev, parseCSV(await r2.text()));
          cache[annoPrev] = prev;
          apFerie = prev.mesi[11].resF;
          apPermessi = prev.mesi[11].resP;
        }
      }
    }

    const dati = calcola(anno, rows, apFerie, apPermessi);
    cache[anno] = dati;
    render(dati);
    show('', 'info');
  } catch (e) {
    show('Errore nel caricamento: ' + e.message, 'err');
  }
}

async function loadAnni() {
  try {
    const r = await fetch('data/anni.json');
    if (!r.ok) throw new Error('lista anni non trovata');
    anni = await r.json();
  } catch (e) {
    anni = ["2026","2027","2028","2029","2030"];
  }

  annoSel.innerHTML = '';
  anni.forEach(a => {
    const o = document.createElement('option');
    o.value = a;
    o.textContent = a;
    annoSel.appendChild(o);
  });

  currentAnno = anni[anni.length - 1] || new Date().getFullYear().toString();
  annoSel.value = currentAnno;
  caricaAnno(currentAnno);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentAnno) return;

  const mese = meseSel.value;
  const f = ferieIn.value;
  const p = permessiIn.value;

  const key = 'mf_goduti_' + currentAnno;
  const salvati = JSON.parse(localStorage.getItem(key) || '{}');
  salvati[mese] = { f: f, p: p };
  localStorage.setItem(key, JSON.stringify(salvati));

  show('Salvato per ' + meseSel.options[meseSel.selectedIndex].text, 'ok');
  ferieIn.value = '';
  permessiIn.value = '';

  caricaAnno(currentAnno);
});

annoSel.addEventListener('change', (e) => caricaAnno(e.target.value));

loadAnni();
