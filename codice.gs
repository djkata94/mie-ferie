function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Dashboard Ferie & Permessi')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Funzione che legge tutti i fogli nominati con 4 cifre (es. 2026, 2027)
function getAnni() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var anni = [];
  sheets.forEach(function(s) {
    var name = s.getName();
    if (/^\d{4}$/.test(name)) { // Cerca nomi composti solo da 4 cifre
      anni.push(name);
    }
  });
  anni.sort(); // Ordina gli anni (es. 2026, 2027...)
  if (anni.length === 0) {
    anni.push(new Date().getFullYear().toString());
  }
  return anni;
}

// Funzione di supporto per calcolare matematicamente il saldo finale di un anno specifico
function calcolaSaldiFinali(ss, anno) {
  var sheet = ss.getSheetByName(anno);
  if (!sheet) return { ferie: 0, permessi: 0 };
  
  var dataMaturazione = sheet.getRange(2, 3, 2, 12).getValues(); 
  var dataGoduto = sheet.getRange(5, 3, 2, 12).getValues();      
  
  var prevAnno = (parseInt(anno) - 1).toString();
  var apFerie = 0;
  var apPermessi = 0;
  
  // Se esiste il foglio ancora precedente, calcola ricorsivamente il suo finale
  if (ss.getSheetByName(prevAnno)) {
    var saldiPrev = calcolaSaldiFinali(ss, prevAnno);
    apFerie = saldiPrev.ferie;
    apPermessi = saldiPrev.permessi;
  } else {
    // Altrimenti prende il valore fisso di partenza in colonna B del primo foglio in assoluto
    apFerie = parseFloat(sheet.getRange("B2").getValue()) || 0;
    apPermessi = parseFloat(sheet.getRange("B3").getValue()) || 0;
  }
  
  var runningFerie = apFerie;
  var runningPermessi = apPermessi;
  
  for (var i = 0; i < 12; i++) {
    runningFerie += ((parseFloat(dataMaturazione[0][i]) || 0) - (parseFloat(dataGoduto[0][i]) || 0));
    runningPermessi += ((parseFloat(dataMaturazione[1][i]) || 0) - (parseFloat(dataGoduto[1][i]) || 0));
  }
  return { ferie: runningFerie, permessi: runningPermessi };
}

function getFullData(anno) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(anno);
  if (!sheet) return [];
  
  var mesiNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
  
  var dataMaturazione = sheet.getRange(2, 3, 2, 12).getValues(); 
  var dataGoduto = sheet.getRange(5, 3, 2, 12).getValues();      
  
  var apFerie = 0;
  var apPermessi = 0;
  var prevAnno = (parseInt(anno) - 1).toString();
  
  // Se esiste l'anno precedente, eredita il "Totalone" di Dicembre automatico
  if (ss.getSheetByName(prevAnno)) {
    var saldiPrev = calcolaSaldiFinali(ss, prevAnno);
    apFerie = saldiPrev.ferie;
    apPermessi = saldiPrev.permessi;
  } else {
    apFerie = parseFloat(sheet.getRange("B2").getValue()) || 0;
    apPermessi = parseFloat(sheet.getRange("B3").getValue()) || 0;
  }
  
  var result = [];
  result.push({
    mese: "AP (Anno Prec.)",
    isAP: true,
    godFerie: "-",
    godPermessi: "-",
    resFerie: apFerie.toFixed(2),
    resPermessi: apPermessi.toFixed(2),
    totaleH: (apFerie + apPermessi).toFixed(2)
  });

  var runningFerie = apFerie;
  var runningPermessi = apPermessi;
  
  for (var i = 0; i < 12; i++) {
    var matF = parseFloat(dataMaturazione[0][i]) || 0;
    var matP = parseFloat(dataMaturazione[1][i]) || 0;
    var godF = parseFloat(dataGoduto[0][i]) || 0;
    var godP = parseFloat(dataGoduto[1][i]) || 0;
    
    runningFerie += (matF - godF);
    runningPermessi += (matP - godP);
    
    result.push({
      mese: mesiNames[i],
      isAP: false,
      godFerie: godF.toFixed(2),
      godPermessi: godP.toFixed(2),
      resFerie: runningFerie.toFixed(2),
      resPermessi: runningPermessi.toFixed(2),
      totaleH: (runningFerie + runningPermessi).toFixed(2)
    });
  }
  
  return result;
}

function salvaDati(anno, mese, ferie, permessi) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(anno);
  if (!sheet) return "Errore: Foglio non trovato";
  
  var mesiList = ["GENNAIO", "FEBBRAIO", "MARZO", "APRILE", "MAGGIO", "GIUGNO", "LUGLIO", "AGOSTO", "SETTEMBRE", "OTTOBRE", "NOVEMBRE", "DICEMBRE"];
  
  var colIdx = mesiList.indexOf(mese.toUpperCase()) + 3;
  if (colIdx < 3) return "Errore Mese";

  var valFerie = ferie !== "" ? parseFloat(ferie) : 0;
  var valPermessi = permessi !== "" ? parseFloat(permessi) : 0;

  sheet.getRange(5, colIdx).setValue(valFerie);
  sheet.getRange(6, colIdx).setValue(valPermessi);
  
  return "Dati salvati in " + anno + " per " + mese;
}