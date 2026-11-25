/**
 * Module de fusion télémétrique post-séance WebBreath (ES2024+ zéro-build).
 * Parse les exports TymeWear (CSV / streams Intervals.icu) et Smart Adapter / K5 (CSV / JSON),
 * puis fusionne ventilation minute (VE, Rf, Vt) et contraintes mécaniques (Travail, Pression, Puissance).
 */

import { CMH2O_L_TO_JOULES, parseK5Csv } from "./k5Parser.js";

const MAX_FUSION_ROWS = 20000;
const MAX_FUSION_COLS = 128;

/**
 * Borne une valeur numérique dans [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Arrondit à N décimales.
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Convertit une valeur brute en nombre fini ou null.
 * @param {unknown} raw
 * @returns {number | null}
 */
function safeNumber(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcule la médiane d'un tableau de nombres finis non vide.
 * @param {number[]} values
 * @returns {number | null}
 */
function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Calcule la moyenne arithmétique d'un tableau non vide.
 * @param {number[]} values
 * @returns {number | null}
 */
function computeMean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Normalise un nom de colonne / stream pour la détection souple.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeKey(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Détecte le délimiteur CSV probable depuis la première ligne non vide.
 * @param {string} text
 * @returns {string}
 */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semis = 0;
  let tabs = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === ",") commas += 1;
      else if (ch === ";") semis += 1;
      else if (ch === "\t") tabs += 1;
    }
  }
  if (semis > commas && semis >= tabs) return ";";
  if (tabs > commas && tabs > semis) return "\t";
  return ",";
}

/**
 * Parse un texte CSV générique en lignes/cellules (max `maxRows`).
 * @param {string} text
 * @param {string} delimiter
 * @param {number} [maxRows=MAX_FUSION_ROWS + 1]
 * @returns {string[][]}
 */
function parseDelimitedRows(text, delimiter, maxRows = MAX_FUSION_ROWS + 1) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    if (rows.length >= maxRows) break;
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          if (field.length < 256) field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (field.length < 256) {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      if (row.length < MAX_FUSION_COLS) row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      if (row.length < MAX_FUSION_COLS) row.push(field);
      if (row.some((c) => c.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (field.length < 256) {
      field += ch;
    }
  }

  if (rows.length < maxRows && (field.length > 0 || row.length > 0)) {
    if (row.length < MAX_FUSION_COLS) row.push(field);
    if (row.some((c) => c.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Classifie un nom de colonne TymeWear/Intervals.icu.
 * @param {string} normKey
 * @returns {"time" | "ve" | "rf" | "vt" | "hr" | null}
 */
function classifyTymewearColumn(normKey) {
  if (!normKey) return null;
  if (
    normKey === "ve" ||
    normKey === "minute_ventilation" ||
    normKey === "tidal_volume_min" ||
    normKey === "tyme_minute_volume" ||
    normKey === "minute_volume" ||
    normKey === "ventilation" ||
    normKey === "ve_l_min" ||
    normKey.includes("minute_ventilation") ||
    normKey.includes("tidal_volume_min") ||
    normKey.includes("minute_volume")
  ) {
    return "ve";
  }
  if (
    normKey === "rf" ||
    normKey === "respiration" ||
    normKey === "breath_rate" ||
    normKey === "tyme_breath_rate" ||
    normKey === "respiratory_rate" ||
    normKey === "breathing_rate" ||
    normKey === "br" ||
    normKey.includes("breath_rate") ||
    normKey.includes("respiratory_rate")
  ) {
    return "rf";
  }
  if (
    normKey === "vt" ||
    normKey === "tidal_volume" ||
    normKey === "tyme_tidal_volume" ||
    normKey === "tv" ||
    normKey.includes("tidal_volume")
  ) {
    return "vt";
  }
  if (
    normKey === "heartrate" ||
    normKey === "hr" ||
    normKey === "heart_rate" ||
    normKey === "bpm" ||
    normKey === "fc"
  ) {
    return "hr";
  }
  if (
    normKey === "time" ||
    normKey === "timestamp" ||
    normKey === "elapsed_time" ||
    normKey === "seconds" ||
    normKey === "secs" ||
    normKey === "t"
  ) {
    return "time";
  }
  return null;
}

/**
 * Finalise le résumé TymeWear à partir des séries brutes extraites.
 * Convertit automatiquement `vt` de cL en L si la médiane positive > 10.
 * @param {{
 *   source: string,
 *   rawVe: Array<number | null>,
 *   rawRf: Array<number | null>,
 *   rawVt: Array<number | null>,
 *   rawHr: Array<number | null>,
 *   rowCount: number,
 * }} data
 */
function buildTymewearSummary({ source, rawVe, rawRf, rawVt, rawHr, rowCount }) {
  const positiveRawVt = rawVt.filter((v) => v !== null && v > 0);
  const vtMedian = computeMedian(positiveRawVt);
  const vtDivisor = vtMedian !== null && vtMedian > 10 ? 100 : 1;

  const veValues = [];
  const rfValues = [];
  const vtValues = [];
  const hrValues = [];

  const len = Math.min(rowCount, MAX_FUSION_ROWS);
  let validVentSamples = 0;

  for (let i = 0; i < len; i += 1) {
    const veRaw = rawVe[i] ?? null;
    const rfRaw = rawRf[i] ?? null;
    const vtRaw = rawVt[i] ?? null;
    const hrRaw = rawHr[i] ?? null;

    const rf = rfRaw !== null ? clampRange(rfRaw, 1, 100) : null;
    const vt = vtRaw !== null ? clampRange(vtRaw / vtDivisor, 0.05, 8) : null;
    let ve = veRaw !== null ? clampRange(veRaw, 0, 260) : null;
    if (ve === null && rf !== null && vt !== null) {
      ve = clampRange(rf * vt, 0, 260);
    }

    if (ve !== null) veValues.push(ve);
    if (rf !== null) rfValues.push(rf);
    if (vt !== null) vtValues.push(vt);
    if (hrRaw !== null) hrValues.push(clampRange(hrRaw, 25, 240));

    if (ve !== null || rf !== null || vt !== null) {
      validVentSamples += 1;
    }
  }

  if (validVentSamples === 0) {
    throw new Error("Aucune donnée ventilatoire TymeWear valide détectée.");
  }

  const veAvgRaw = computeMean(veValues);
  const vePeakRaw = veValues.length > 0 ? Math.max(...veValues) : null;
  const rfAvgRaw = computeMean(rfValues);
  const rfPeakRaw = rfValues.length > 0 ? Math.max(...rfValues) : null;
  let vtAvgRaw = computeMean(vtValues);

  if (vtAvgRaw === null && veAvgRaw !== null && rfAvgRaw !== null && rfAvgRaw > 0) {
    vtAvgRaw = clampRange(veAvgRaw / rfAvgRaw, 0.05, 8);
  }

  const veAvgLMin = veAvgRaw !== null ? roundTo(veAvgRaw, 2) : null;
  const vePeakLMin = vePeakRaw !== null ? roundTo(vePeakRaw, 2) : null;
  const rfAvgBrMin = rfAvgRaw !== null ? roundTo(rfAvgRaw, 2) : null;
  const rfPeakBrMin = rfPeakRaw !== null ? roundTo(rfPeakRaw, 2) : null;
  const vtAvgL = vtAvgRaw !== null ? roundTo(vtAvgRaw, 3) : null;
  const rfVtRatio =
    rfAvgBrMin !== null && vtAvgL !== null && vtAvgL > 0
      ? roundTo(rfAvgBrMin / vtAvgL, 2)
      : null;
  const hrAvgRaw = computeMean(hrValues);
  const hrAvgBpm = hrAvgRaw !== null ? roundTo(hrAvgRaw, 1) : null;

  return {
    source,
    sampleCount: validVentSamples,
    veAvgLMin,
    vePeakLMin,
    rfAvgBrMin,
    rfPeakBrMin,
    vtAvgL,
    rfVtRatio,
    hrAvgBpm,
  };
}

/**
 * Parse un CSV TymeWear ou export CSV Intervals.icu streams.
 * @param {string} csvText
 */
export function parseTymewearCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    throw new Error("CSV TymeWear vide ou non textuel.");
  }

  const normalizedText = csvText.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedText);
  const rows = parseDelimitedRows(normalizedText, delimiter, MAX_FUSION_ROWS + 10);

  if (rows.length < 2) {
    throw new Error("CSV TymeWear incomplet (en-tête et au moins une ligne de données requis).");
  }

  let headerRowIdx = -1;
  let colMap = {};
  const scanLimit = Math.min(rows.length - 1, 10);

  for (let r = 0; r < scanLimit; r += 1) {
    const candidateMap = {};
    const headerCells = rows[r];
    for (let c = 0; c < headerCells.length; c += 1) {
      const role = classifyTymewearColumn(normalizeKey(headerCells[c]));
      if (role && candidateMap[role] === undefined) {
        candidateMap[role] = c;
      }
    }
    if (
      candidateMap.ve !== undefined ||
      candidateMap.rf !== undefined ||
      candidateMap.vt !== undefined
    ) {
      headerRowIdx = r;
      colMap = candidateMap;
      break;
    }
  }

  if (headerRowIdx < 0) {
    throw new Error(
      "Colonnes TymeWear introuvables (attendu VE / minute_ventilation / tidal_volume_min, Rf / respiration ou Vt / tidal_volume)."
    );
  }

  const dataRows = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + MAX_FUSION_ROWS);
  const rawVe = [];
  const rawRf = [];
  const rawVt = [];
  const rawHr = [];

  for (const row of dataRows) {
    rawVe.push(colMap.ve !== undefined ? safeNumber(row[colMap.ve]) : null);
    rawRf.push(colMap.rf !== undefined ? safeNumber(row[colMap.rf]) : null);
    rawVt.push(colMap.vt !== undefined ? safeNumber(row[colMap.vt]) : null);
    rawHr.push(colMap.hr !== undefined ? safeNumber(row[colMap.hr]) : null);
  }

  return buildTymewearSummary({
    source: "TYMEWEAR_CSV",
    rawVe,
    rawRf,
    rawVt,
    rawHr,
    rowCount: dataRows.length,
  });
}

/**
 * Extrait le résumé TymeWear depuis la réponse `GET /api/v1/activity/{id}/streams` d'Intervals.icu.
 * Supporte un tableau d'objets `{ type, data }` ou une map `{ [streamType]: number[] | { data } }`.
 * @param {Array<Record<string, unknown>> | Record<string, unknown>} streams
 */
export function extractTymewearFromIntervalsStreams(streams) {
  if (!streams || typeof streams !== "object") {
    throw new Error("Streams Intervals.icu vides ou invalides.");
  }

  /** @type {Record<"ve" | "rf" | "vt" | "hr", Array<number | null>>} */
  const buckets = { ve: [], rf: [], vt: [], hr: [] };
  const found = { ve: false, rf: false, vt: false, hr: false };

  const assignStream = (rawKey, rawArr) => {
    const role = classifyTymewearColumn(normalizeKey(rawKey));
    if (!role || role === "time") return;
    if (found[role]) return;
    if (!Array.isArray(rawArr)) return;
    found[role] = true;
    const sliced = rawArr.slice(0, MAX_FUSION_ROWS);
    buckets[role] = sliced.map((v) => safeNumber(v));
  };

  if (Array.isArray(streams)) {
    for (const item of streams) {
      if (!item || typeof item !== "object") continue;
      const key = item.type ?? item.name ?? item.key ?? "";
      const arr = Array.isArray(item.data)
        ? item.data
        : Array.isArray(item.values)
          ? item.values
          : null;
      if (key && arr) {
        assignStream(String(key), arr);
      }
    }
  } else {
    for (const [key, val] of Object.entries(streams)) {
      if (Array.isArray(val)) {
        assignStream(key, val);
      } else if (val && typeof val === "object") {
        const arr = Array.isArray(val.data)
          ? val.data
          : Array.isArray(val.values)
            ? val.values
            : null;
        if (arr) assignStream(key, arr);
      }
    }
  }

  if (!found.ve && !found.rf && !found.vt) {
    throw new Error(
      "Aucun stream ventilatoire TymeWear trouvé dans l'activité Intervals.icu."
    );
  }

  const rowCount = Math.min(
    MAX_FUSION_ROWS,
    Math.max(buckets.ve.length, buckets.rf.length, buckets.vt.length, buckets.hr.length)
  );

  return buildTymewearSummary({
    source: "INTERVALS_STREAMS",
    rawVe: buckets.ve,
    rawRf: buckets.rf,
    rawVt: buckets.vt,
    rawHr: buckets.hr,
    rowCount,
  });
}

/**
 * Classifie une colonne Smart Adapter CSV/JSON.
 * @param {string} normKey
 * @returns {"pressure" | "flow" | "power" | "volume" | "breath" | "work" | "time" | null}
 */
function classifySmartAdapterColumn(normKey) {
  if (!normKey) return null;
  if (
    normKey === "pressure" ||
    normKey === "cmh2o" ||
    normKey === "p_cmh2o" ||
    normKey === "peak_pressure" ||
    normKey === "peak_pressure_cmh2o" ||
    normKey === "mean_pressure" ||
    normKey === "pressure_cmh2o" ||
    normKey.includes("pressure") ||
    normKey.includes("cmh2o")
  ) {
    return "pressure";
  }
  if (
    normKey === "flow" ||
    normKey === "l_s" ||
    normKey === "flow_ls" ||
    normKey === "peak_flow" ||
    normKey === "peak_flow_ls" ||
    normKey.includes("flow")
  ) {
    return "flow";
  }
  if (
    normKey === "power" ||
    normKey === "w" ||
    normKey === "power_w" ||
    normKey === "mean_power" ||
    normKey === "mean_power_w" ||
    normKey.includes("power")
  ) {
    return "power";
  }
  if (
    normKey === "volume" ||
    normKey === "l" ||
    normKey === "volume_l" ||
    normKey === "inspired_volume" ||
    normKey.includes("volume")
  ) {
    return "volume";
  }
  if (
    normKey === "breath" ||
    normKey === "rep" ||
    normKey === "cycle" ||
    normKey === "breath_index" ||
    normKey === "rep_index"
  ) {
    return "breath";
  }
  if (
    normKey === "work" ||
    normKey === "work_j" ||
    normKey === "work_of_breathing" ||
    normKey === "wob" ||
    normKey === "joules"
  ) {
    return "work";
  }
  if (
    normKey === "time" ||
    normKey === "t" ||
    normKey === "seconds" ||
    normKey === "secs" ||
    normKey === "timestamp"
  ) {
    return "time";
  }
  return null;
}

/**
 * Agrège des enregistrements Smart Adapter normalisés (CSV ou JSON) vers le format unifié.
 * @param {Array<{
 *   breath: number | null,
 *   pressure: number | null,
 *   flow: number | null,
 *   power: number | null,
 *   volume: number | null,
 *   work: number | null,
 *   time: number | null,
 * }>} records
 * @param {string} source
 */
function aggregateSmartAdapterRecords(records, source) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Aucune donnée Smart Adapter exploitable.");
  }

  const grouped = new Map();
  let hasExplicitBreath = false;
  for (const rec of records) {
    if (rec.breath !== null && rec.breath >= 0) {
      hasExplicitBreath = true;
      break;
    }
  }

  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    const hasAnyMetric =
      rec.pressure !== null ||
      rec.flow !== null ||
      rec.power !== null ||
      rec.volume !== null ||
      rec.work !== null;
    if (!hasAnyMetric) continue;

    const key = hasExplicitBreath && rec.breath !== null ? Math.round(rec.breath) : i + 1;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(rec);
  }

  if (grouped.size === 0) {
    throw new Error("Aucune mesure de pression, débit ou travail valide dans l'export Smart Adapter.");
  }

  const breaths = [];
  let seqIdx = 0;

  for (const [breathKey, group] of grouped.entries()) {
    seqIdx += 1;
    const pressures = [];
    const flows = [];
    const powers = [];
    const volumes = [];
    const works = [];
    const times = [];

    for (const item of group) {
      if (item.pressure !== null) pressures.push(clampRange(item.pressure, 0, 350));
      if (item.flow !== null) flows.push(clampRange(item.flow, 0, 25));
      if (item.power !== null) powers.push(clampRange(item.power, 0, 5000));
      if (item.volume !== null) volumes.push(clampRange(item.volume, 0, 20));
      if (item.work !== null) works.push(clampRange(item.work, 0, 50000));
      if (item.time !== null) times.push(item.time);
    }

    const peakPressure = pressures.length > 0 ? Math.max(...pressures) : 0;
    const meanPressure = computeMean(pressures) ?? peakPressure;
    const peakFlow = flows.length > 0 ? Math.max(...flows) : 0;
    const meanFlow = computeMean(flows) ?? peakFlow;

    let durationS = 0;
    if (times.length >= 2) {
      const dtSpan = Math.max(...times) - Math.min(...times);
      if (dtSpan > 0 && dtSpan < 60) durationS = dtSpan;
    }

    let volumeL = 0;
    if (volumes.length > 0) {
      volumeL = volumes.length === 1 ? volumes[0] : Math.max(...volumes);
    } else if (flows.length > 1 && durationS > 0) {
      const dt = durationS / flows.length;
      volumeL = flows.reduce((acc, f) => acc + f * dt, 0);
    }

    let workJ = 0;
    if (works.length > 0) {
      workJ = clampRange(
        works.reduce((acc, w) => acc + w, 0),
        0,
        50000
      );
    } else if (pressures.length > 1 && flows.length === pressures.length && durationS > 0) {
      const dt = durationS / pressures.length;
      let sum = 0;
      for (let i = 0; i < pressures.length; i += 1) {
        sum += CMH2O_L_TO_JOULES * pressures[i] * flows[i] * dt;
      }
      workJ = clampRange(sum, 0, 50000);
    } else if (meanPressure > 0 && volumeL > 0) {
      workJ = clampRange(CMH2O_L_TO_JOULES * meanPressure * volumeL, 0, 50000);
    }

    let meanPowerW = computeMean(powers) ?? 0;
    if (meanPowerW === 0 && workJ > 0 && durationS > 0) {
      meanPowerW = workJ / durationS;
    }
    const peakPowerW = powers.length > 0 ? Math.max(...powers) : meanPowerW;

    breaths.push({
      breathIndex: breathKey > 0 ? breathKey : seqIdx,
      breathStartRaw: "",
      targetLoadCmh2o: null,
      inspiratoryTimeS: roundTo(durationS, 3),
      inspiredVolumeL: roundTo(volumeL, 3),
      peakPressureCmh2o: roundTo(peakPressure, 2),
      meanPressureCmh2o: roundTo(meanPressure, 2),
      peakFlowLs: roundTo(peakFlow, 3),
      meanFlowLs: roundTo(meanFlow, 3),
      workOfBreathingJ: roundTo(workJ, 2),
      meanPowerW: roundTo(meanPowerW, 2),
      peakPowerW: roundTo(peakPowerW, 2),
    });
  }

  const n = breaths.length;
  const maxPeakP = Math.max(...breaths.map((b) => b.peakPressureCmh2o));
  const meanP = computeMean(breaths.map((b) => b.meanPressureCmh2o)) ?? 0;
  const maxPeakF = Math.max(...breaths.map((b) => b.peakFlowLs));
  const meanF = computeMean(breaths.map((b) => b.meanFlowLs)) ?? 0;
  const totalVol = breaths.reduce((acc, b) => acc + b.inspiredVolumeL, 0);
  const totalWork = clampRange(
    breaths.reduce((acc, b) => acc + b.workOfBreathingJ, 0),
    0,
    50000
  );
  const meanPower = computeMean(breaths.map((b) => b.meanPowerW)) ?? 0;
  const maxPeakPower = Math.max(...breaths.map((b) => b.peakPowerW));
  const sIndexRaw = Math.max(maxPeakP, maxPeakF * 18.5);
  const sIndexEstimate = sIndexRaw > 0 ? roundTo(clampRange(sIndexRaw, 10, 350), 1) : 0;

  return {
    source,
    sessionTimestamp: "smart_adapter",
    targetLoadHeader: null,
    breaths,
    summary: {
      breathCount: n,
      targetLoadCmh2o: 0,
      peakPressureCmh2o: roundTo(maxPeakP, 2),
      meanPressureCmh2o: roundTo(meanP, 2),
      peakFlowLs: roundTo(maxPeakF, 3),
      meanFlowLs: roundTo(meanF, 3),
      meanVolumeL: roundTo(totalVol / n, 3),
      totalVolumeL: roundTo(totalVol, 3),
      totalWorkJ: roundTo(totalWork, 2),
      meanPowerW: roundTo(meanPower, 2),
      peakPowerW: roundTo(maxPeakPower, 2),
      sIndexEstimate,
      flowDropPct: 0,
    },
  };
}

/**
 * Parse un export Smart Adapter (CSV générique ou JSON) ou délègue au format K5 50 Hz.
 * @param {string} rawText
 */
export function parseSmartAdapterData(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Données Smart Adapter vides ou non textuelles.");
  }

  const trimmed = rawText.replace(/^\uFEFF/, "").trim();

  // Délégation automatique si format POWERbreathe K5 50 Hz détecté
  if (trimmed.includes("[FileIO Version]") || /Pressure\s*\(cmH2O\)/i.test(trimmed)) {
    const k5Parsed = parseK5Csv(rawText);
    return {
      source: "K5_50HZ",
      ...k5Parsed,
    };
  }

  // Format JSON Smart Adapter
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsedJson;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`JSON Smart Adapter invalide : ${err.message}`);
    }

    if (
      parsedJson &&
      !Array.isArray(parsedJson) &&
      typeof parsedJson === "object" &&
      parsedJson.summary &&
      typeof parsedJson.summary === "object" &&
      !Array.isArray(parsedJson.breaths) &&
      !Array.isArray(parsedJson.samples) &&
      !Array.isArray(parsedJson.data)
    ) {
      const s = parsedJson.summary;
      const peakP = clampRange(safeNumber(s.peakPressureCmh2o ?? s.peakPressure) ?? 0, 0, 350);
      const meanP = clampRange(safeNumber(s.meanPressureCmh2o ?? s.meanPressure) ?? peakP, 0, 350);
      const peakF = clampRange(safeNumber(s.peakFlowLs ?? s.peakFlow) ?? 0, 0, 25);
      const meanF = clampRange(safeNumber(s.meanFlowLs ?? s.meanFlow) ?? peakF, 0, 25);
      const totalWorkJ = clampRange(safeNumber(s.totalWorkJ ?? s.workJ) ?? 0, 0, 50000);
      const meanPowerW = clampRange(safeNumber(s.meanPowerW ?? s.powerW) ?? 0, 0, 5000);
      const totalVolumeL = clampRange(safeNumber(s.totalVolumeL) ?? 0, 0, 5000);
      const breathCount = Math.max(0, Math.round(safeNumber(s.breathCount) ?? 0));
      return {
        source: "SMART_ADAPTER_JSON",
        sessionTimestamp: "smart_adapter",
        targetLoadHeader: null,
        breaths: [],
        summary: {
          breathCount,
          targetLoadCmh2o: 0,
          peakPressureCmh2o: roundTo(peakP, 2),
          meanPressureCmh2o: roundTo(meanP, 2),
          peakFlowLs: roundTo(peakF, 3),
          meanFlowLs: roundTo(meanF, 3),
          meanVolumeL: breathCount > 0 ? roundTo(totalVolumeL / breathCount, 3) : 0,
          totalVolumeL: roundTo(totalVolumeL, 3),
          totalWorkJ: roundTo(totalWorkJ, 2),
          meanPowerW: roundTo(meanPowerW, 2),
          peakPowerW: roundTo(clampRange(safeNumber(s.peakPowerW) ?? meanPowerW, 0, 5000), 2),
          sIndexEstimate: roundTo(
            clampRange(safeNumber(s.sIndexEstimate) ?? Math.max(peakP, peakF * 18.5), 0, 350),
            1
          ),
          flowDropPct: 0,
        },
      };
    }

    const rawItems = Array.isArray(parsedJson)
      ? parsedJson
      : Array.isArray(parsedJson?.breaths)
        ? parsedJson.breaths
        : Array.isArray(parsedJson?.samples)
          ? parsedJson.samples
          : Array.isArray(parsedJson?.data)
            ? parsedJson.data
            : [parsedJson];

    const records = rawItems.slice(0, MAX_FUSION_ROWS).map((item) => {
      const rec = {
        breath: null,
        pressure: null,
        flow: null,
        power: null,
        volume: null,
        work: null,
        time: null,
      };
      if (!item || typeof item !== "object") return rec;
      for (const [k, v] of Object.entries(item)) {
        const role = classifySmartAdapterColumn(normalizeKey(k));
        if (role && rec[role] === null) {
          rec[role] = safeNumber(v);
        }
      }
      return rec;
    });

    return aggregateSmartAdapterRecords(records, "SMART_ADAPTER_JSON");
  }

  // Format CSV générique Smart Adapter
  const delimiter = detectDelimiter(trimmed);
  const rows = parseDelimitedRows(trimmed, delimiter, MAX_FUSION_ROWS + 10);
  if (rows.length < 2) {
    throw new Error("CSV Smart Adapter incomplet.");
  }

  let headerRowIdx = -1;
  let colMap = {};
  const scanLimit = Math.min(rows.length - 1, 10);

  for (let r = 0; r < scanLimit; r += 1) {
    const candidateMap = {};
    for (let c = 0; c < rows[r].length; c += 1) {
      const role = classifySmartAdapterColumn(normalizeKey(rows[r][c]));
      if (role && candidateMap[role] === undefined) {
        candidateMap[role] = c;
      }
    }
    if (
      candidateMap.pressure !== undefined ||
      candidateMap.power !== undefined ||
      candidateMap.work !== undefined
    ) {
      headerRowIdx = r;
      colMap = candidateMap;
      break;
    }
  }

  if (headerRowIdx < 0) {
    throw new Error(
      "Colonnes Smart Adapter introuvables (attendu pressure/cmH2O, flow/L_s, power/W, volume/L ou work)."
    );
  }

  const dataRows = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + MAX_FUSION_ROWS);
  const records = dataRows.map((row) => ({
    breath: colMap.breath !== undefined ? safeNumber(row[colMap.breath]) : null,
    pressure: colMap.pressure !== undefined ? safeNumber(row[colMap.pressure]) : null,
    flow: colMap.flow !== undefined ? safeNumber(row[colMap.flow]) : null,
    power: colMap.power !== undefined ? safeNumber(row[colMap.power]) : null,
    volume: colMap.volume !== undefined ? safeNumber(row[colMap.volume]) : null,
    work: colMap.work !== undefined ? safeNumber(row[colMap.work]) : null,
    time: colMap.time !== undefined ? safeNumber(row[colMap.time]) : null,
  }));

  return aggregateSmartAdapterRecords(records, "SMART_ADAPTER_CSV");
}

/**
 * Fusionne les résumés post-séance TymeWear (ventilation) et Smart Adapter / K5 (pressions).
 * @param {object} [params={}]
 * @param {Record<string, unknown> | null} [params.tymewear]
 * @param {Record<string, unknown> | null} [params.pressure]
 */
export function fuseVentilationAndPressure({ tymewear = null, pressure = null } = {}) {
  const twRaw =
    tymewear && typeof tymewear === "object"
      ? tymewear.summary && typeof tymewear.summary === "object"
        ? tymewear.summary
        : tymewear
      : null;

  const prRaw =
    pressure && typeof pressure === "object"
      ? pressure.summary && typeof pressure.summary === "object"
        ? pressure.summary
        : pressure
      : null;

  const hasTymewear = Boolean(
    twRaw &&
      (safeNumber(twRaw.veAvgLMin) !== null ||
        safeNumber(twRaw.rfAvgBrMin) !== null ||
        safeNumber(twRaw.vtAvgL) !== null)
  );

  const hasPressure = Boolean(
    prRaw &&
      (safeNumber(prRaw.totalWorkJ) !== null ||
        safeNumber(prRaw.peakPressureCmh2o) !== null ||
        safeNumber(prRaw.meanPowerW) !== null)
  );

  const normTymewear = hasTymewear
    ? {
        source: typeof twRaw.source === "string" ? twRaw.source : "TYMEWEAR",
        sampleCount: safeNumber(twRaw.sampleCount) ?? 0,
        veAvgLMin: safeNumber(twRaw.veAvgLMin),
        vePeakLMin: safeNumber(twRaw.vePeakLMin),
        rfAvgBrMin: safeNumber(twRaw.rfAvgBrMin),
        rfPeakBrMin: safeNumber(twRaw.rfPeakBrMin),
        vtAvgL: safeNumber(twRaw.vtAvgL),
        rfVtRatio: safeNumber(twRaw.rfVtRatio),
        hrAvgBpm: safeNumber(twRaw.hrAvgBpm),
      }
    : null;

  const normPressure = hasPressure
    ? {
        breathCount: safeNumber(prRaw.breathCount) ?? 0,
        peakPressureCmh2o: safeNumber(prRaw.peakPressureCmh2o),
        meanPressureCmh2o: safeNumber(prRaw.meanPressureCmh2o),
        peakFlowLs: safeNumber(prRaw.peakFlowLs),
        meanFlowLs: safeNumber(prRaw.meanFlowLs),
        meanVolumeL: safeNumber(prRaw.meanVolumeL),
        totalVolumeL: safeNumber(prRaw.totalVolumeL),
        totalWorkJ: safeNumber(prRaw.totalWorkJ),
        meanPowerW: safeNumber(prRaw.meanPowerW),
        peakPowerW: safeNumber(prRaw.peakPowerW),
        sIndexEstimate: safeNumber(prRaw.sIndexEstimate),
      }
    : null;

  const veAvgLMin = normTymewear?.veAvgLMin ?? null;
  const vePeakLMin = normTymewear?.vePeakLMin ?? null;
  const rfAvgBrMin = normTymewear?.rfAvgBrMin ?? null;
  const vtAvgL = normTymewear?.vtAvgL ?? null;
  const rfVtRatio =
    normTymewear?.rfVtRatio ??
    (rfAvgBrMin !== null && vtAvgL !== null && vtAvgL > 0
      ? roundTo(rfAvgBrMin / vtAvgL, 2)
      : null);

  const workJ = normPressure?.totalWorkJ ?? null;
  const peakPressureCmh2o = normPressure?.peakPressureCmh2o ?? null;
  const meanPowerW = normPressure?.meanPowerW ?? null;

  // Coût ventilatoire (J/L) = Travail mécanique / Volume ventilé (ou Puissance moyenne * 60 / VE)
  let ventilatoryCostJPerL = null;
  if (workJ !== null && workJ > 0 && normPressure?.totalVolumeL && normPressure.totalVolumeL > 0) {
    ventilatoryCostJPerL = roundTo(workJ / normPressure.totalVolumeL, 2);
  } else if (
    workJ !== null &&
    workJ > 0 &&
    vtAvgL !== null &&
    vtAvgL > 0 &&
    normPressure?.breathCount &&
    normPressure.breathCount > 0
  ) {
    ventilatoryCostJPerL = roundTo(workJ / (vtAvgL * normPressure.breathCount), 2);
  } else if (
    meanPowerW !== null &&
    meanPowerW > 0 &&
    veAvgLMin !== null &&
    veAvgLMin > 0
  ) {
    ventilatoryCostJPerL = roundTo((meanPowerW * 60) / veAvgLMin, 2);
  }

  return {
    hasTymewear,
    hasPressure,
    tymewear: normTymewear,
    pressure: normPressure,
    combined: {
      veAvgLMin,
      vePeakLMin,
      rfAvgBrMin,
      vtAvgL,
      rfVtRatio,
      workJ,
      peakPressureCmh2o,
      meanPowerW,
      ventilatoryCostJPerL,
    },
  };
}
