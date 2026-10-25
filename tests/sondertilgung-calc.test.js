/* Tests für sondertilgung-calc.js – ohne Dependencies.
   Ausführen:  node tests/sondertilgung-calc.test.js
   oder:       jsc sondertilgung-calc.js tests/sondertilgung-calc.test.js  (macOS JavaScriptCore)
   Nur neutrale Beispielwerte verwenden. */
"use strict";

const calc = typeof require === "function" ? require("../sondertilgung-calc.js") : globalThis.SondertilgungCalc;
const log = typeof console !== "undefined" ? (...a) => console.log(...a) : print;

const BEISPIEL = {
  kredit: 300000, zins: 4, tilgung: 2, sondertilgungPct: 5, zinsbindungJahre: 10,
  etfRendite: 6, anschlusszins: 4, steuersatz: 26.375, teilfreistellung: 30,
  horizontJahre: 20, anteilSondertilgung: 50, nachZinsbindungWeiter: true,
};
const mit = changes => ({ ...BEISPIEL, ...changes });

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; log("  ok   " + name); }
  catch (e) { failed++; log("  FAIL " + name + "\n       " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function near(actual, expected, tol, msg) {
  assert(Math.abs(actual - expected) <= tol, `${msg || ""} erwartet ${expected}, erhalten ${actual}`);
}
/** Restschuld einer Annuität ohne Sondertilgung nach n Monaten. */
function annuitaetRest(start, rate, i, n) {
  const q = Math.pow(1 + i, n);
  return start * q - rate * (q - 1) / i;
}

test("Monatsrate = Kredit × (Zins + Tilgung) / 12", () => {
  near(calc.monatsrate(BEISPIEL), 1500, 1e-9);
});

test("Jahresbetrag = max. Sondertilgung in % der Ursprungssumme", () => {
  near(calc.jahresbetrag(BEISPIEL), 15000, 1e-9);
});

test("Szenario B: Restschuld zum Ende der Zinsbindung entspricht der Annuitätenformel", () => {
  const b = calc.simulate(BEISPIEL, 0);
  near(b.schuldBindung, annuitaetRest(300000, 1500, 0.04 / 12, 120), 1e-6);
  near(b.schuldPath[1], 300000 - (1500 - 1000), 1e-9, "erster Monat:");
});

test("Szenario B: Restschuld nach Zinsbindung läuft mit Anschlusszins und gleicher Rate weiter", () => {
  const b = calc.simulate(mit({ anschlusszins: 6 }), 0);
  const nachBindung = annuitaetRest(300000, 1500, 0.04 / 12, 120);
  near(b.schuldEnde, annuitaetRest(nachBindung, 1500, 0.06 / 12, 120), 1e-6);
});

test("Szenario B: ETF-Wert und Steuer bei jährlicher Einzahlung am Jahresende", () => {
  const b = calc.simulate(mit({ horizontJahre: 10 }), 0);
  const fv = 15000 * (Math.pow(1.06, 10) - 1) / 0.06;
  near(b.etfBrutto, fv, 1e-6);
  near(b.etfEingezahlt, 150000, 1e-9);
  near(b.steuer, (fv - 150000) * 0.7 * 0.26375, 1e-6);
  near(b.nettovermoegen, b.etfBrutto - b.steuer - b.schuldEnde, 1e-9);
});

test("Szenario A: volle Sondertilgung senkt Restschuld und Zinsen gegenüber B", () => {
  const r = calc.runModel(BEISPIEL, { breakEven: false });
  assert(r.a.schuldBindung < r.b.schuldBindung, "Restschuld A < B");
  assert(r.a.zinsen < r.b.zinsen, "Zinsen A < B");
  near(r.gesparteZinsen, r.b.zinsen - r.a.zinsen, 1e-9);
  near(calc.simulate(mit({ horizontJahre: 10 }), 100).sondertilgung, 150000, 1e-6, "zehn volle Sondertilgungen in der Zinsbindung:");
});

test("Szenario C liegt bei der Restschuld zwischen A und B", () => {
  const r = calc.runModel(BEISPIEL, { breakEven: false });
  assert(r.a.schuldBindung < r.c.schuldBindung && r.c.schuldBindung < r.b.schuldBindung);
  near(calc.simulate(BEISPIEL, 100).nettovermoegen, r.a.nettovermoegen, 1e-9, "Anteil 100 % = A:");
});

test("Sondertilgung nie mehr als die Restschuld, Restschuld nie negativ", () => {
  const a = calc.simulate(mit({ sondertilgungPct: 40 }), 100);
  assert(a.schuldPath.every(s => s >= 0), "Restschuld >= 0");
  assert(a.tilgungsfreiMonat !== null && a.tilgungsfreiMonat <= 36, "nach spätestens drei Jahren getilgt");
  assert(a.sondertilgung <= 300000 + 1e-6, "Sondertilgung <= Kredit");
});

test("Geldfluss ist in allen Szenarien gleich (Zinsen + Tilgung + ETF-Einzahlungen)", () => {
  for (const p of [BEISPIEL, mit({ sondertilgungPct: 40 }), mit({ nachZinsbindungWeiter: false })]) {
    const jahre = p.nachZinsbindungWeiter ? p.horizontJahre : p.zinsbindungJahre;
    const gesamt = 1500 * p.horizontJahre * 12 + calc.jahresbetrag(p) * jahre;
    for (const anteil of [0, 50, 100]) {
      const s = calc.simulate(p, anteil);
      near(s.zinsen + (p.kredit - s.schuldEnde) + s.etfEingezahlt, gesamt, 1e-4, `Anteil ${anteil} %:`);
    }
  }
});

test("Ohne Fortführung nach der Zinsbindung fließt danach kein Jahresbetrag mehr", () => {
  const b = calc.simulate(mit({ nachZinsbindungWeiter: false }), 0);
  near(b.etfEingezahlt, 150000, 1e-9);
});

test("Horizont kürzer als die Zinsbindung wird auf die Zinsbindung verlängert", () => {
  const b = calc.simulate(mit({ horizontJahre: 5 }), 0);
  assert(b.monate === 120 && b.schuldPath.length === 121);
});

test("Nettovermögen = ETF nach Steuern − Restschuld, auch im Verlauf", () => {
  const c = calc.simulate(BEISPIEL, 50);
  for (const m of [0, 60, 120, 240]) near(c.nettoPath[m], c.etfNettoPath[m] - c.schuldPath[m], 1e-9, `Monat ${m}:`);
});

test("Break-even-Rendite: dort sind A und B gleich, darüber gewinnt der ETF", () => {
  const be = calc.breakEvenRendite(BEISPIEL);
  assert(be !== null, "Break-even vorhanden");
  near(calc.vorteilEtf(mit({ etfRendite: be })), 0, 1, "Vorteil am Break-even:");
  assert(calc.vorteilEtf(mit({ etfRendite: be + 1 })) > 0, "über Break-even ETF besser");
  assert(calc.vorteilEtf(mit({ etfRendite: be - 1 })) < 0, "unter Break-even Sondertilgung besser");
});

test("Break-even ist null ohne Jahresbetrag", () => {
  assert(calc.breakEvenRendite(mit({ sondertilgungPct: 0 })) === null);
});

test("Heatmap hat eine Zeile je Anschlusszins und eine Spalte je Rendite", () => {
  const renditen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], zinsen = [1, 2, 3, 4, 5, 6, 7, 8];
  const h = calc.heatmap(BEISPIEL, renditen, zinsen);
  assert(h.length === 8 && h.every(z => z.werte.length === 11));
  assert(h.every(z => z.werte[0] < z.werte[10]), "Vorteil ETF steigt mit der Rendite");
});

log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed) {
  if (typeof process !== "undefined") process.exitCode = 1;
  else throw new Error(`${failed} Test(s) fehlgeschlagen`);
}
