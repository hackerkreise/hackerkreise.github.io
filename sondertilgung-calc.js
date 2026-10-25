/* =====================================================================
   Sondertilgung oder ETF? – Rechenlogik (reine Funktionen ohne DOM-Zugriff)
   Wird von sondertilgung.html und tests/sondertilgung-calc.test.js genutzt.

   Alle Prozentwerte werden in Prozent übergeben (4 = 4 %).
   Kreditzinsen werden monatlich verrechnet (nominaler Jahreszins / 12),
   die ETF-Rendite monatlich als (1 + r)^(1/12) − 1.

   Parameter p:
     kredit, zins, tilgung            Ursprungsdarlehen, Sollzins, anfängliche Tilgung
     sondertilgungPct                 max. Sondertilgung pro Jahr in % der Ursprungssumme
     zinsbindungJahre, anschlusszins  Zinsbindung und Zins danach
     etfRendite, steuersatz, teilfreistellung
     horizontJahre                    Betrachtungszeitraum ab heute
     nachZinsbindungWeiter            jährlicher Betrag auch nach der Zinsbindung
   ===================================================================== */
(function (root) {
  "use strict";

  /** Konstante Monatsrate = Kredit × (Zins + Tilgung) / 12. */
  function monatsrate(p) {
    return p.kredit * (p.zins + p.tilgung) / 100 / 12;
  }

  /** Jährlicher Betrag, der in Sondertilgung und/oder ETF fließt. */
  function jahresbetrag(p) {
    return p.kredit * p.sondertilgungPct / 100;
  }

  /** Steuer bei Verkauf: Gewinn × (1 − Teilfreistellung) × Steuersatz, nie negativ. */
  function etfSteuer(wert, eingezahlt, p) {
    return Math.max(0, wert - eingezahlt) * (1 - p.teilfreistellung / 100) * p.steuersatz / 100;
  }

  /**
   * Simuliert ein Szenario Monat für Monat.
   * anteilSondertilgung (0–100 %): Anteil des Jahresbetrags, der am Jahresende
   * sondergetilgt wird (A = 100, B = 0, C = Mischung). Der Rest geht in den ETF.
   *
   * - Sondertilgung höchstens bis zur Restschuld; ein Überschuss geht in den ETF.
   * - Ist der Kredit getilgt, fließt die frei werdende Rate ebenfalls in den ETF,
   *   damit alle Szenarien jeden Monat gleich viel Geld einsetzen.
   * - Nach der Zinsbindung läuft die Restschuld mit dem Anschlusszins und
   *   gleicher Rate weiter.
   *
   * Pfade enthalten je einen Wert pro Monat (Index 0 = heute).
   */
  function simulate(p, anteilSondertilgung) {
    const anteil = Math.min(100, Math.max(0, anteilSondertilgung)) / 100;
    const rate = monatsrate(p);
    const budget = jahresbetrag(p);
    const g = Math.pow(1 + p.etfRendite / 100, 1 / 12) - 1;
    const bindung = Math.round(p.zinsbindungJahre * 12);
    const monate = Math.max(bindung, Math.round(p.horizontJahre * 12));

    let schuld = p.kredit, etf = 0, eingezahlt = 0;
    let zinsen = 0, zinsenBindung = 0, sondertilgung = 0, schuldBindung = p.kredit;
    let tilgungsfreiMonat = null, negativeTilgung = false;
    const schuldPath = [schuld], etfNettoPath = [0], nettoPath = [-schuld];

    for (let m = 1; m <= monate; m++) {
      const z = schuld * (m <= bindung ? p.zins : p.anschlusszins) / 100 / 12;
      if (schuld > 0 && rate < z) negativeTilgung = true;
      const zahlung = Math.min(rate, schuld + z);
      schuld = schuld + z - zahlung;
      zinsen += z;
      if (m <= bindung) zinsenBindung += z;

      let beitrag = rate - zahlung; // frei werdende Rate nach vollständiger Tilgung
      if (m % 12 === 0 && (m <= bindung || p.nachZinsbindungWeiter)) {
        const st = Math.min(budget * anteil, schuld);
        schuld -= st;
        sondertilgung += st;
        beitrag += budget - st;
      }
      if (schuld < 0.005) {
        schuld = 0;
        if (tilgungsfreiMonat === null) tilgungsfreiMonat = m;
      }

      etf = etf * (1 + g) + beitrag;
      eingezahlt += beitrag;
      if (m === bindung) schuldBindung = schuld;

      const etfNetto = etf - etfSteuer(etf, eingezahlt, p);
      schuldPath.push(schuld);
      etfNettoPath.push(etfNetto);
      nettoPath.push(etfNetto - schuld);
    }

    const steuer = etfSteuer(etf, eingezahlt, p);
    return {
      anteil: anteil * 100, rate, budget, monate,
      schuldBindung, schuldEnde: schuld,
      zinsen, zinsenBindung, sondertilgung,
      etfBrutto: etf, etfEingezahlt: eingezahlt, steuer, etfNetto: etf - steuer,
      nettovermoegen: etf - steuer - schuld,
      tilgungsfreiMonat, negativeTilgung,
      schuldPath, etfNettoPath, nettoPath,
    };
  }

  /** Vorteil ETF (B) gegenüber voller Sondertilgung (A) beim Nettovermögen am Horizont. */
  function vorteilEtf(p) {
    return simulate(p, 0).nettovermoegen - simulate(p, 100).nettovermoegen;
  }

  /**
   * Break-even-ETF-Rendite: Rendite, bei der B und A am Horizont dasselbe
   * Nettovermögen haben. Bisektion im Bereich −20 … 40 %; null, wenn es dort
   * keinen Vorzeichenwechsel gibt (z. B. wenn der Jahresbetrag 0 ist).
   */
  function breakEvenRendite(p) {
    const f = r => vorteilEtf({ ...p, etfRendite: r });
    let lo = -20, hi = 40, flo = f(lo), fhi = f(hi);
    if (Math.abs(flo - fhi) < 0.005 || Math.sign(flo) === Math.sign(fhi)) return null;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Komplettes Modell: Szenarien A, B, C plus Kennzahlen. */
  function runModel(p, opts = {}) {
    const a = simulate(p, 100);
    const b = simulate(p, 0);
    const c = simulate(p, p.anteilSondertilgung);
    const res = {
      p, a, b, c,
      gesparteZinsen: b.zinsen - a.zinsen,
      differenzNetto: b.nettovermoegen - a.nettovermoegen,
    };
    if (opts.breakEven !== false) res.breakEven = breakEvenRendite(p);
    return res;
  }

  /**
   * Heatmap: Vorteil ETF vs. Sondertilgung (B − A) je Anschlusszins (Zeilen)
   * und ETF-Rendite (Spalten), dazu die Break-even-Rendite je Zeile.
   */
  function heatmap(p, renditen, anschlusszinsen) {
    return anschlusszinsen.map(az => ({
      anschlusszins: az,
      werte: renditen.map(r => vorteilEtf({ ...p, etfRendite: r, anschlusszins: az })),
      breakEven: breakEvenRendite({ ...p, anschlusszins: az }),
    }));
  }

  const api = { monatsrate, jahresbetrag, etfSteuer, simulate, vorteilEtf, breakEvenRendite, runModel, heatmap };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SondertilgungCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
