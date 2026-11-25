import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractTymewearFromIntervalsStreams,
  fuseVentilationAndPressure,
  parseSmartAdapterData,
  parseTymewearCsv,
} from "../telemetryFusion.js";
import { fetchLatestTymewearStreams } from "../intervalsClient.js";
import {
  buildSessionMarkdownAndPayload,
  computeSessionMetrics,
  parseTelemetryJsonFromDescription,
} from "../engine.js";

describe("telemetryFusion.js — parseTymewearCsv & extractTymewearFromIntervalsStreams", () => {
  it("parse un CSV TymeWear, convertit Vt de cL en L si médiane > 10 et borne les valeurs physiologiques", () => {
    const csv = [
      "time,tyme_minute_volume,tyme_breath_rate,tyme_tidal_volume,heartrate",
      "0,40.0,20,200,130",
      "5,60.0,30,200,140",
      "10,300.0,150,250,300", // borné: ve->260, rf->100, vt->2.5L, hr->240
      "15,NaN,abc,,20", // ve/rf/vt ignorés, hr borné à 25
    ].join("\n");

    const res = parseTymewearCsv(csv);
    assert.equal(res.source, "TYMEWEAR_CSV");
    assert.equal(res.sampleCount, 3);
    assert.equal(res.veAvgLMin, 120);
    assert.equal(res.vePeakLMin, 260);
    assert.equal(res.rfAvgBrMin, 50);
    assert.equal(res.rfPeakBrMin, 100);
    assert.equal(res.vtAvgL, 2.167);
    assert.equal(res.rfVtRatio, 23.07);
    assert.equal(res.hrAvgBpm, 133.8);
  });

  it("conserve Vt en L si la médiane positive <= 10", () => {
    const csv = [
      "time;ve;rf;vt;hr",
      "0;45.0;25;1.8;145",
      "1;54.0;30;1.8;155",
    ].join("\n");

    const res = parseTymewearCsv(csv);
    assert.equal(res.sampleCount, 2);
    assert.equal(res.vtAvgL, 1.8);
    assert.equal(res.veAvgLMin, 49.5);
    assert.equal(res.rfAvgBrMin, 27.5);
  });

  it("extrait les streams TymeWear depuis le format tableau et le format map Intervals.icu", () => {
    const streamsArray = [
      { type: "tidal_volume_min", data: [36, 48] },
      { type: "respiration", data: [24, 32] },
      { type: "tidal_volume", data: [150, 150] }, // cL -> 1.5 L
      { type: "heartrate", data: [135, 145] },
    ];
    const resArr = extractTymewearFromIntervalsStreams(streamsArray);
    assert.equal(resArr.source, "INTERVALS_STREAMS");
    assert.equal(resArr.veAvgLMin, 42);
    assert.equal(resArr.vtAvgL, 1.5);
    assert.equal(resArr.hrAvgBpm, 140);

    const streamsMap = {
      minute_ventilation: [30, 40],
      breath_rate: [20, 25],
      tidal_volume: [1.5, 1.6],
    };
    const resMap = extractTymewearFromIntervalsStreams(streamsMap);
    assert.equal(resMap.source, "INTERVALS_STREAMS");
    assert.equal(resMap.vePeakLMin, 40);
    assert.equal(resMap.vtAvgL, 1.55);
  });

  it("rejette un CSV vide ou des streams sans données ventilatoires", () => {
    assert.throws(() => parseTymewearCsv(""));
    assert.throws(() => extractTymewearFromIntervalsStreams([{ type: "watts", data: [200] }]));
  });
});

describe("telemetryFusion.js — parseSmartAdapterData & fuseVentilationAndPressure", () => {
  it("délègue automatiquement à parseK5Csv si le format K5 50 Hz est détecté", () => {
    const k5Rows = [
      "[FileIO Version]",
      "1.0",
      "Header",
      "80",
      "2026-01-01",
      "Breath 1,",
      "meta,",
      "Pressure (cmH2O),Flow (L/s)",
      "80,1.0",
      "80,1.0",
      "80,1.0",
      "80,1.0",
    ].join("\n");

    const parsed = parseSmartAdapterData(k5Rows);
    assert.equal(parsed.source, "K5_50HZ");
    assert.equal(parsed.summary.breathCount, 1);
    assert.equal(parsed.summary.peakPressureCmh2o, 80);
  });

  it("parse un CSV et un JSON Smart Adapter génériques et fusionne avec TymeWear", () => {
    const smartCsv = [
      "breath,pressure_cmh2o,flow_ls,volume_l,power_w",
      "1,90,2.5,2.0,15",
      "2,400,30,2.0,20", // pressure bornée à 350, flow borné à 25
    ].join("\n");

    const parsedCsv = parseSmartAdapterData(smartCsv);
    assert.equal(parsedCsv.source, "SMART_ADAPTER_CSV");
    assert.equal(parsedCsv.summary.breathCount, 2);
    assert.equal(parsedCsv.summary.peakPressureCmh2o, 350);
    assert.equal(parsedCsv.summary.peakFlowLs, 25);
    assert.ok(parsedCsv.summary.totalWorkJ > 0);

    const parsedJson = parseSmartAdapterData(
      JSON.stringify([
        { rep: 1, cmh2o: 80, l: 2.0, w: 12 },
        { rep: 2, cmh2o: 100, l: 2.0, w: 16 },
      ])
    );
    assert.equal(parsedJson.source, "SMART_ADAPTER_JSON");
    assert.equal(parsedJson.summary.breathCount, 2);
    assert.equal(parsedJson.summary.meanPowerW, 14);

    const tw = parseTymewearCsv("time,ve,rf,vt\n0,50,25,2.0\n1,70,35,2.0");
    const fused = fuseVentilationAndPressure({ tymewear: tw, pressure: parsedJson });
    assert.equal(fused.hasTymewear, true);
    assert.equal(fused.hasPressure, true);
    assert.equal(fused.combined.veAvgLMin, 60);
    assert.equal(fused.combined.peakPressureCmh2o, 100);
    assert.ok(fused.combined.ventilatoryCostJPerL > 0);
  });
});

describe("intervalsClient.js & engine.js — fetchLatestTymewearStreams & fusion [TELEMETRY_JSON]", () => {
  it("récupère la dernière activité 48 h et extrait les streams TymeWear", async () => {
    const calls = [];
    const mockFetch = async (url) => {
      calls.push(url);
      if (url.includes("/activities?")) {
        return new Response(
          JSON.stringify([{ id: "act_99", name: "Sortie Z2 TymeWear", start_date_local: "2026-11-25T10:00:00" }]),
          { status: 200 }
        );
      }
      if (url.includes("/activity/act_99/streams")) {
        return new Response(
          JSON.stringify([
            { type: "tidal_volume_min", data: [42, 48] },
            { type: "respiration", data: [24, 26] },
            { type: "tidal_volume", data: [180, 180] },
          ]),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const summary = await fetchLatestTymewearStreams({
      athleteId: "0",
      apiKey: "test-key",
      now: new Date("2026-11-25T12:00:00Z"),
      fetchImpl: mockFetch,
    });

    assert.equal(calls.length, 2);
    assert.equal(summary.source, "INTERVALS_STREAMS");
    assert.equal(summary.activityId, "act_99");
    assert.equal(summary.veAvgLMin, 45);
    assert.equal(summary.vtAvgL, 1.8);
  });

  it("intègre tymewear_summary et pressure_summary dans computeSessionMetrics et [TELEMETRY_JSON]", () => {
    const tymewear_summary = parseTymewearCsv("time,ve,rf,vt\n0,55,25,2.2\n1,65,29,2.2");
    const smart = parseSmartAdapterData("breath,pressure_cmh2o,volume_l,power_w\n1,100,2.2,18");

    const session = {
      theme: "Fusion Test",
      borg_rpe: 6,
      tymewear_summary,
      pressure_summary: smart.summary,
      exercises: [{ id: "k5_imt_30rm_hypertrophy", sets: 1, reps: 30, load: 100, completion: 1 }],
    };

    const metrics = computeSessionMetrics(session);
    assert.ok(metrics.fusion);
    assert.equal(metrics.fusion.hasTymewear, true);
    assert.equal(metrics.fusion.hasPressure, true);

    const { payload, telemetryJson } = buildSessionMarkdownAndPayload(session, metrics);
    assert.ok(telemetryJson.tymewear);
    assert.ok(telemetryJson.fusion);
    assert.equal(telemetryJson.fusion.veAvgLMin, 60);

    const extracted = parseTelemetryJsonFromDescription(payload.description);
    assert.deepEqual(extracted, telemetryJson);
  });
});
