// Test della logica pura, senza dipendenze: npm test  (oppure: node --test "tests/**/*.test.js")
// Riferimento: il foglio Google "Mie Ferie" 2026 (riga RESIDUO AL MESE e celle O9/O10).

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logica.js');

const MAT_2026 = L.MESI.map(mese => ({ mese, ferie_maturata: 13.33, permessi_maturati: 8.67 }));
const GODUTI_2026 = [[16, 8.5], [0, 6.5], [0, 7.5], [8, 6], [0, 5], [8, 5.5], [40, 3.75], [40, 1.5], [5, 0], [0, 6.75]]
  .map(([f, p], i) => ({ mese: L.MESI[i], ferie_ore: f, permessi_ore: p }));
const AP_2026 = { ap_ferie: -19.33, ap_permessi: -12.41, bloccato: true, ap_configurato: true };
const RESIDUI_FOGLIO_2026 = [-34.24, -18.74, -4.24, 3.76, 20.76, 29.26, 7.51, -11.99, 5.01, 20.26, 42.26, 64.26];

const anno2026 = () => L.costruisciAnno(2026, { maturazione: MAT_2026, ap: AP_2026, goduti: GODUTI_2026 });

test('2026: residui mese per mese identici al foglio Google', () => {
  const dati = anno2026();
  assert.deepEqual(dati.mesi.map(m => L.arrotonda2(m.totale)), RESIDUI_FOGLIO_2026);
});

test('2026: dicembre ferie 23,63 e permessi 40,63 (celle O9 e O10)', () => {
  const dic = anno2026().mesi[11];
  assert.equal(L.fmtIT(dic.resF), '23,63');
  assert.equal(L.fmtIT(dic.resP), '40,63');
});

test('i mesi senza goduti salvati contano 0 (novembre e dicembre 2026)', () => {
  const dati = anno2026();
  assert.equal(dati.mesi[10].godF, 0);
  assert.equal(dati.mesi[11].godP, 0);
});

test('AP non confermato (bloccato ma senza ap_configurato) = si parte da 0', () => {
  const dati = L.costruisciAnno(2027, {
    maturazione: MAT_2026, goduti: [],
    ap: { ap_ferie: 50, ap_permessi: 50, bloccato: true, ap_configurato: false }
  });
  assert.equal(dati.apConfigurato, false);
  assert.equal(dati.apFerie, 0);
  assert.equal(L.arrotonda2(dati.mesi[0].totale), 22);
  assert.equal(L.arrotonda2(dati.mesi[11].totale), 264);
});

test('anno senza maturazione: segnalato e residui solo da AP e goduti', () => {
  const dati = L.costruisciAnno(2031, { maturazione: [], ap: null, goduti: [] });
  assert.equal(dati.maturazioneCaricata, false);
  assert.equal(dati.mesi[11].totale, 0);
});

test('suggerimento AP 2027 = residuo di dicembre 2026', () => {
  assert.deepEqual(L.suggerimentoAP(anno2026()), { ferie: 23.63, permessi: 40.63 });
  assert.deepEqual(L.suggerimentoAP(null), { ferie: 0, permessi: 0 });
});

test('sommaMesi 2026: totali maturati, goduti e residuo finale', () => {
  const t = L.sommaMesi(anno2026());
  assert.equal(L.arrotonda2(t.godF), 117);
  assert.equal(L.arrotonda2(t.godP), 51);
  assert.equal(L.arrotonda2(t.residuoFinale), 64.26);
  assert.equal(L.arrotonda2(t.apTot), -31.74);
});

test('parseOre: vuoto = null, virgola decimale, limiti', () => {
  assert.equal(L.parseOre('', 'Ferie'), null);
  assert.equal(L.parseOre('  ', 'Ferie'), null);
  assert.equal(L.parseOre('7,5', 'Ferie'), 7.5);
  assert.equal(L.parseOre('0', 'Ferie'), 0);
  assert.equal(L.parseOre('3.333', 'Ferie'), 3.33);
  assert.throws(() => L.parseOre('-1', 'Ferie'), L.ErroreValidazione);
  assert.throws(() => L.parseOre('201', 'Ferie'), /troppe/);
  assert.throws(() => L.parseOre('abc', 'Ferie'), L.ErroreValidazione);
});

test('pianificaSalvataggio: campo vuoto non azzera il valore salvato (bug TODO 4)', () => {
  const piano = L.pianificaSalvataggio({ godF: 8, godP: 6 }, 10, null);
  assert.equal(piano.f, 10);
  assert.equal(piano.p, 6);
  assert.deepEqual(piano.cambi.map(c => c.nome), ['Ferie']);
  assert.equal(piano.sovrascritti.length, 1);
});

test('pianificaSalvataggio: 0 esplicito azzera, conferma solo se c\'era un valore', () => {
  const azzera = L.pianificaSalvataggio({ godF: 8, godP: 6 }, null, 0);
  assert.equal(azzera.p, 0);
  assert.equal(azzera.sovrascritti.length, 1);
  const nuovo = L.pianificaSalvataggio({ godF: 0, godP: 0 }, 8, null);
  assert.equal(nuovo.sovrascritti.length, 0);
  assert.equal(L.pianificaSalvataggio({ godF: 8, godP: 6 }, 8, 6).cambi.length, 0);
  assert.throws(() => L.pianificaSalvataggio({ godF: 0, godP: 0 }, null, null), L.ErroreValidazione);
});

test('classificaErrore: rete, sessione, permessi, tabella mancante, validazione', () => {
  assert.equal(L.classificaErrore({ message: 'TypeError: Failed to fetch', code: '' }).tipo, 'rete');
  assert.equal(L.classificaErrore({ name: 'TimeoutError', message: 'signal timed out' }).tipo, 'rete');
  assert.equal(L.classificaErrore({ code: 'PGRST301', message: 'JWT expired' }).tipo, 'sessione');
  assert.equal(L.classificaErrore({ code: '42501', message: 'new row violates row-level security policy' }).tipo, 'permesso');
  assert.equal(L.classificaErrore({ code: 'PGRST205', message: "Could not find the table 'public.storico_goduti' in the schema cache" }).tipo, 'tabella-mancante');
  assert.equal(L.classificaErrore(new L.ErroreValidazione('Ferie: no')).tipo, 'validazione');
  // l'errore originale passato come cause viene riconosciuto
  assert.equal(L.classificaErrore(new Error('lettura anni', { cause: { code: 'PGRST301', message: 'JWT expired' } })).tipo, 'sessione');
  assert.equal(L.classificaErrore({ message: 'boh' }).tipo, 'altro');
});

test('parseCSV: virgole decimali tra virgolette e celle vuote', () => {
  const righe = L.parseCSV('FERIE,"-19,33","13,33",,\r\nPERM. GOD,,"8,5",6\n\n');
  assert.equal(righe.length, 2);
  assert.deepEqual(righe[0], ['FERIE', '-19,33', '13,33', '']);
  assert.equal(L.parseIT(righe[0][1]), -19.33);
  assert.equal(L.parseIT(righe[1][1]), 0);
  assert.equal(L.parseIT('-'), 0);
});

// --- Goduti per giorno ---

test('meseDaData e limitiMese: date valide, anni bisestili, date impossibili', () => {
  assert.deepEqual(L.meseDaData('2026-03-15'), { anno: 2026, i: 2 });
  assert.equal(L.meseDaData('2026-02-29'), null);
  assert.deepEqual(L.meseDaData('2028-02-29'), { anno: 2028, i: 1 });
  assert.equal(L.meseDaData('2026-13-01'), null);
  assert.equal(L.meseDaData(''), null);
  assert.deepEqual(L.limitiMese(2026, 1), { min: '2026-02-01', max: '2026-02-28' });
  assert.deepEqual(L.limitiMese(2026, 11), { min: '2026-12-01', max: '2026-12-31' });
});

test('giornateDelMese: filtra per anno e mese e ordina per data', () => {
  const g = [
    { id: 3, data: '2026-03-20' }, { id: 1, data: '2026-03-02' },
    { id: 2, data: '2026-04-01' }, { id: 4, data: '2027-03-05' }
  ];
  assert.deepEqual(L.giornateDelMese(g, 2026, 2).map(x => x.id), [1, 3]);
  assert.deepEqual(L.giornateDelMese(g, '2027', 2).map(x => x.id), [4]);
});

test('pianificaGiornata: mese con totale e senza giornate → voce di riporto col totale', () => {
  const piano = L.pianificaGiornata(
    { data: '2026-03-16', ferie: '', permessi: '2', nota: ' dentista ' },
    { anno: 2026, i: 2, godF: 0, godP: 7.5, numeroGiornate: 0 }
  );
  assert.deepEqual(piano.riga, { data: '2026-03-16', ferie_ore: 0, permessi_ore: 2, nota: 'dentista', riporto: false });
  assert.deepEqual(piano.riporto, { data: '2026-03-01', ferie_ore: 0, permessi_ore: 7.5, nota: L.NOTA_RIPORTO, riporto: true });
});

test('pianificaGiornata: niente riporto se il mese è vuoto o ha già giornate', () => {
  assert.equal(L.pianificaGiornata({ data: '2026-11-03', ferie: '8' }, { anno: 2026, i: 10, godF: 0, godP: 0, numeroGiornate: 0 }).riporto, null);
  assert.equal(L.pianificaGiornata({ data: '2026-03-03', ferie: '8' }, { anno: 2026, i: 2, godF: 8, godP: 7.5, numeroGiornate: 2 }).riporto, null);
});

test('pianificaGiornata: validazioni', () => {
  const mese = { anno: 2026, i: 2, godF: 0, godP: 0, numeroGiornate: 0 };
  assert.throws(() => L.pianificaGiornata({ data: '2026-04-01', ferie: '8' }, mese), /Marzo 2026/);
  assert.throws(() => L.pianificaGiornata({ data: '2026-03-01', ferie: '', permessi: '0' }, mese), L.ErroreValidazione);
  assert.throws(() => L.pianificaGiornata({ data: '2026-03-01', ferie: '25' }, mese), /24 ore/);
  assert.throws(() => L.pianificaGiornata({ data: '2026-03-01', ferie: '8', nota: 'x'.repeat(201) }, mese), /troppo lunga/);
  assert.throws(() => L.pianificaGiornata({ data: 'boh', ferie: '8' }, mese), /Data non valida/);
});
