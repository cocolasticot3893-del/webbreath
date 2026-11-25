import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CMH2O_L_TO_JOULES, DT_SECONDS, parseK5Csv } from "../k5Parser.js";

const REAL_K5_CSV_PATH =
  "C:\\Workspace\\01_SPORT_BIO\\k5_telemetry\\raw_archive\\train\\Alexis_20261108_093824_NEUTRAL_2026_11_8_9_36_48.txt.csv";

describe("k5Parser.js — parsing réel export POWERbreathe K5", () => {
  it("parse le fichier K5 réel et vérifie les 19 respirations et la cohérence biomécanique", () => {
    const csvText = fs.readFileSync(REAL_K5_CSV_PATH, "utf8");
    const result = parseK5Csv(csvText);

    assert.equal(result.sessionTimestamp, "09:36:48.442 08.11.2026");
    assert.equal(result.targetLoadHeader, 111);
    assert.equal(result.breaths.length, 19);

    const { summary, breaths } = result;
    assert.equal(summary.breathCount, 19);
    assert.equal(summary.targetLoadCmh2o, 111);

    // Cohérence des valeurs attendues sur cet export réel
    assert.equal(summary.peakPressureCmh2o, 121.67);
    assert.equal(summary.meanPressureCmh2o, 78.11);
    assert.equal(summary.peakFlowLs, 9.841);
    assert.equal(summary.meanFlowLs, 3.596);
    assert.equal(summary.meanVolumeL, 3.402);
    assert.equal(summary.totalVolumeL, 64.635);
    assert.ok(
      Math.abs(summary.totalWorkJ - 498.38) < 0.05,
      `totalWorkJ attendu ~498.38 J, reçu ${summary.totalWorkJ}`
    );
    assert.ok(
      Math.abs(summary.meanPowerW - 25.67) < 0.1,
      `meanPowerW attendu ~25.67 W, reçu ${summary.meanPowerW}`
    );
    assert.equal(summary.peakPowerW, 59.45);

    // Cohérence analytique entre grandeurs agrégées
    assert.ok(summary.peakPressureCmh2o >= summary.meanPressureCmh2o);
    assert.ok(summary.peakFlowLs >= summary.meanFlowLs);
    assert.ok(summary.peakPowerW >= summary.meanPowerW);
    assert.ok(
      Math.abs(summary.totalVolumeL / summary.breathCount - summary.meanVolumeL) <
        0.005
    );

    // Vérification S-Index estimé : max(P_peak, PIF * 18.5)
    const expectedSIndex =
      Math.round(
        Math.max(summary.peakPressureCmh2o, summary.peakFlowLs * 18.5) * 10
      ) / 10;
    assert.equal(summary.sIndexEstimate, expectedSIndex);

    // Vérification flowDropPct entre les 5 premiers et les 5 derniers cycles
    const first5Avg =
      breaths.slice(0, 5).reduce((acc, b) => acc + b.peakFlowLs, 0) / 5;
    const last5Avg =
      breaths.slice(-5).reduce((acc, b) => acc + b.peakFlowLs, 0) / 5;
    const expectedDropPct =
      Math.round((((last5Avg - first5Avg) / first5Avg) * 100 + Number.EPSILON) * 10) /
      10;
    assert.equal(summary.flowDropPct, expectedDropPct);
    assert.ok(summary.flowDropPct < 0);

    // Contrôle cycle par cycle
    let workSum = 0;
    let volSum = 0;
    breaths.forEach((b, idx) => {
      assert.equal(b.breathIndex, idx + 1);
      assert.ok(b.inspiratoryTimeS > 0);
      assert.ok(b.inspiredVolumeL > 0);
      assert.ok(b.peakPressureCmh2o >= b.meanPressureCmh2o);
      assert.ok(b.peakFlowLs >= b.meanFlowLs);
      assert.ok(b.workOfBreathingJ > 0);
      assert.ok(b.peakPowerW >= b.meanPowerW);
      assert.ok(b.meanPowerW > 0);
      workSum += b.workOfBreathingJ;
      volSum += b.inspiredVolumeL;
    });

    assert.ok(Math.abs(workSum - summary.totalWorkJ) < 0.05);
    assert.ok(Math.abs(volSum - summary.totalVolumeL) < 0.01);
  });
});

describe("k5Parser.js — cas limites et tolérance aux données corrompues", () => {
  it("rejette un CSV vide, blanc ou non textuel", () => {
    assert.throws(() => parseK5Csv(""), /CSV K5 vide ou non textuel/);
    assert.throws(() => parseK5Csv("   \r\n\t  "), /CSV K5 vide ou non textuel/);
    assert.throws(() => parseK5Csv(null), /CSV K5 vide ou non textuel/);
    assert.throws(() => parseK5Csv(12345), /CSV K5 vide ou non textuel/);
  });

  it("rejette un CSV tronqué (< 11 lignes) ou sans en-têtes Pressure / Flow", () => {
    const truncated = [
      "[FileIO Version]",
      "4.2.5",
      "[NEUTRAL DATA]",
      "111",
      "09:36:48.442 08.11.2026",
      "0,657",
      "",
      "Breath 1,",
    ].join("\n");
    assert.throws(() => parseK5Csv(truncated), /tronque ou malforme/);

    const missingSignalHeaders = Array.from(
      { length: 12 },
      (_, idx) => `colA_${idx},colB_${idx}`
    ).join("\n");
    assert.throws(
      () => parseK5Csv(missingSignalHeaders),
      /Pressure \(cmH2O\).*introuvables/
    );
  });

  it("ignore les valeurs non numériques (NaN, texte, Infinity) sans produire de NaN ni planter", () => {
    const csvAllBad = [
      "[FileIO Version]",
      "4.2.5",
      "[NEUTRAL DATA]",
      "90",
      "10:00:00.000 25.11.2026",
      "0,500",
      "",
      "Breath 1,,Breath 2,",
      "Start Time / Date,Target Load,Start Time / Date,Target Load",
      "10:00:00.000,90,10:00:05.000,90",
      "Pressure (cmH2O),Flow (L/s),Pressure (cmH2O),Flow (L/s)",
      "NaN,abc,Infinity,-Infinity",
      "invalid,,foo,bar",
      "100,-0.5,80,0",
      "95,0,82,-1.2",
    ].join("\n");

    const emptyRes = parseK5Csv(csvAllBad);
    assert.equal(emptyRes.breaths.length, 0);
    assert.equal(emptyRes.summary.breathCount, 0);
    assert.equal(emptyRes.summary.targetLoadCmh2o, 90);
    assert.equal(emptyRes.summary.totalWorkJ, 0);
    assert.equal(emptyRes.summary.meanPowerW, 0);
    assert.equal(emptyRes.summary.sIndexEstimate, 0);

    // Mélange : Breath 1 valide (4 échantillons actifs avec 1 ligne NaN filtrée) + Breath 2 invalide + BOM UTF-8
    const csvMixed =
      "\uFEFF" +
      [
        "[FileIO Version]",
        "4.2.5",
        "[NEUTRAL DATA]",
        "100",
        "10:05:00.000 25.11.2026",
        "0,500",
        "",
        "Breath 1,,Breath 2,",
        "Start Time / Date,Target Load,Start Time / Date,Target Load",
        "10:05:00.000,100,10:05:05.000,100",
        "Pressure (cmH2O),Flow (L/s),Pressure (cmH2O),Flow (L/s)",
        "100,2.0,NaN,2.0",
        "100,2.0,100,bad",
        "100,NaN,90,1.0",
        "100,2.0,90,-0.5",
        "100,2.0,,",
      ].join("\n");

    const mixedRes = parseK5Csv(csvMixed);
    assert.equal(mixedRes.breaths.length, 1);
    assert.equal(mixedRes.summary.breathCount, 1);

    const b1 = mixedRes.breaths[0];
    // 4 échantillons actifs à 50 Hz (0.08 s), débit 2.0 L/s, pression 100 cmH2O
    const expectedTi = 4 * DT_SECONDS;
    const expectedVol = 4 * 2.0 * DT_SECONDS;
    const expectedWork = 4 * CMH2O_L_TO_JOULES * 100 * 2.0 * DT_SECONDS;
    assert.equal(b1.inspiratoryTimeS, Math.round(expectedTi * 1000) / 1000);
    assert.equal(b1.inspiredVolumeL, Math.round(expectedVol * 1000) / 1000);
    assert.equal(
      b1.workOfBreathingJ,
      Math.round((expectedWork + Number.EPSILON) * 100) / 100
    );
    assert.ok(Number.isFinite(mixedRes.summary.meanPowerW));
    assert.equal(mixedRes.summary.flowDropPct, 0);
  });
});
