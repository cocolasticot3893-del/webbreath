/**
 * Parseur CSV 50 Hz pour POWERbreathe K5 (compatible Navigateur & Node.js ESM).
 * Reproduit fidelement les calculs biomecaniques de k5_pipeline.py.
 */

export const DT_SECONDS = 0.020; // 50 Hz (20 ms par echantillon)
export const CMH2O_L_TO_JOULES = 0.0980665;
const MAX_K5_ROWS = 10000;
const MAX_K5_COLS = 2000;

/**
 * Borne une valeur numérique dans l'intervalle [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Nettoie une chaîne de métadonnée K5 (balises HTML, caractères de contrôle, troncature à 80 car.).
 * @param {unknown} raw
 * @param {number} [maxLen=80]
 * @returns {string}
 */
function sanitizeK5MetaText(raw, maxLen = 80) {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
}

/**
 * Arrondit un nombre a N decimales sans derive flottante triviale.
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(value, decimals) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Convertit une cellule CSV en flottant fini ou null.
 * @param {string | undefined} raw
 * @returns {number | null}
 */
function safeFloat(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse un texte CSV (RFC 4180 minimal) en tableau de lignes et cellules.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsvRows(text, maxRows = MAX_K5_ROWS, maxCols = MAX_K5_COLS) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    if (rows.length >= maxRows) {
      break;
    }
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
    } else if (ch === ",") {
      if (row.length < maxCols) {
        row.push(field);
      }
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      if (row.length < maxCols) {
        row.push(field);
      }
      rows.push(row);
      row = [];
      field = "";
    } else if (field.length < 256) {
      field += ch;
    }
  }

  if (rows.length < maxRows && (field.length > 0 || row.length > 0)) {
    if (row.length < maxCols) {
      row.push(field);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Trouve l'index de la ligne contenant les paires d'en-tetes Pressure / Flow.
 * @param {string[][]} rows
 * @returns {number}
 */
function findSignalHeaderIndex(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const r = rows[i];
    if (r.length >= 2) {
      for (let c = 0; c < r.length - 1; c += 2) {
        const hPress = (r[c] ?? "").trim();
        const hFlow = (r[c + 1] ?? "").trim();
        if (hPress.includes("Pressure") && hFlow.includes("Flow")) {
          return i;
        }
      }
    }
  }
  return -1;
}

/**
 * Parse un export CSV 50 Hz POWERbreathe K5 et calcule les metriques par cycle et resumees.
 * @param {string} csvText
 * @returns {{
 *   sessionTimestamp: string,
 *   targetLoadHeader: number | null,
 *   breaths: Array<{
 *     breathIndex: number,
 *     breathStartRaw: string,
 *     targetLoadCmh2o: number | null,
 *     inspiratoryTimeS: number,
 *     inspiredVolumeL: number,
 *     peakPressureCmh2o: number,
 *     meanPressureCmh2o: number,
 *     peakFlowLs: number,
 *     meanFlowLs: number,
 *     workOfBreathingJ: number,
 *     meanPowerW: number,
 *     peakPowerW: number,
 *   }>,
 *   summary: {
 *     breathCount: number,
 *     targetLoadCmh2o: number,
 *     peakPressureCmh2o: number,
 *     meanPressureCmh2o: number,
 *     peakFlowLs: number,
 *     meanFlowLs: number,
 *     meanVolumeL: number,
 *     totalVolumeL: number,
 *     totalWorkJ: number,
 *     meanPowerW: number,
 *     peakPowerW: number,
 *     sIndexEstimate: number,
 *     flowDropPct: number,
 *   }
 * }}
 */
export function parseK5Csv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    throw new Error("CSV K5 vide ou non textuel.");
  }

  const normalizedText = csvText.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(normalizedText);

  if (rows.length < 11) {
    throw new Error(
      `CSV K5 tronque ou malforme : ${rows.length} lignes detectees (minimum 11 requises).`,
    );
  }

  const signalHeaderIdx = findSignalHeaderIndex(rows);
  if (signalHeaderIdx < 1) {
    throw new Error(
      "Format K5 invalide : en-tetes 'Pressure (cmH2O)' / 'Flow (L/s)' introuvables.",
    );
  }

  // Detection compatible entre exports reels K5 (targetLoad en ligne 3, timestamp en ligne 4)
  // et exports simplifies a 10 lignes d'en-tete (timestamp en ligne 3).
  const row3First = rows[3]?.[0]?.trim() ?? "";
  const row3Numeric = safeFloat(row3First);
  const isRow3PureNumber =
    row3Numeric !== null && /^[+-]?\d+(?:\.\d+)?$/.test(row3First);

  const targetLoadHeader =
    isRow3PureNumber && row3Numeric !== null
      ? clampRange(row3Numeric, 0, 300)
      : null;
  const rawTimestamp = isRow3PureNumber
    ? rows[4]?.[0] || rows[signalHeaderIdx - 1]?.[0] || ""
    : row3First || "";
  const sessionTimestamp = sanitizeK5MetaText(rawTimestamp, 80) || "unknown";

  let breathHeaders = rows[signalHeaderIdx - 3] ?? [];
  for (let i = signalHeaderIdx - 1; i >= 0; i -= 1) {
    if ((rows[i]?.[0] ?? "").trim().toLowerCase().startsWith("breath")) {
      breathHeaders = rows[i];
      break;
    }
  }

  const metaValues = rows[signalHeaderIdx - 1] ?? [];
  const signalHeaders = rows[signalHeaderIdx];
  const dataRows = rows.slice(signalHeaderIdx + 1, MAX_K5_ROWS);
  const maxSignalCols = Math.min(signalHeaders.length - 1, MAX_K5_COLS);

  const breaths = [];

  for (let colIdx = 0; colIdx < maxSignalCols; colIdx += 2) {
    const hPress = (signalHeaders[colIdx] ?? "").trim();
    const hFlow = (signalHeaders[colIdx + 1] ?? "").trim();
    if (!hPress.includes("Pressure") || !hFlow.includes("Flow")) {
      continue;
    }

    const breathLabel = (breathHeaders[colIdx] ?? "").trim();
    let breathIndex = Math.floor(colIdx / 2) + 1;
    if (breathLabel.toLowerCase().startsWith("breath")) {
      const parts = breathLabel.split(/\s+/);
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        breathIndex = Number.parseInt(parts[1], 10);
      }
    }
    breathIndex = Math.round(clampRange(breathIndex, 1, 1000));

    const breathStartRaw = sanitizeK5MetaText(metaValues[colIdx] ?? "", 80);
    const rawTargetLoad = safeFloat(metaValues[colIdx + 1]);
    const targetLoadCmh2o =
      rawTargetLoad !== null ? clampRange(rawTargetLoad, 0, 300) : null;

    const pressures = [];
    const flows = [];
    for (let r = 0; r < dataRows.length; r += 1) {
      const row = dataRows[r];
      if (colIdx + 1 >= row.length) {
        continue;
      }
      const rawP = safeFloat(row[colIdx]);
      const rawF = safeFloat(row[colIdx + 1]);
      if (rawP !== null && rawF !== null) {
        const pVal = clampRange(rawP, 0, 350);
        const fVal = clampRange(rawF, 0, 25);
        pressures.push(pVal);
        flows.push(fVal);
      }
    }

    if (pressures.length < 3) {
      continue;
    }

    // Filtrage strict de la phase inspiratoire active (flow > 0) comme dans k5_pipeline.py
    let activeCount = 0;
    let sumP = 0;
    let sumF = 0;
    let peakP = -Infinity;
    let peakF = -Infinity;
    let sumInstPowerW = 0;
    let peakPowerW = -Infinity;

    for (let i = 0; i < flows.length; i += 1) {
      const f = flows[i];
      if (f > 0) {
        const p = pressures[i];
        const instPowerW = CMH2O_L_TO_JOULES * p * f;
        activeCount += 1;
        sumP += p;
        sumF += f;
        if (p > peakP) peakP = p;
        if (f > peakF) peakF = f;
        sumInstPowerW += instPowerW;
        if (instPowerW > peakPowerW) peakPowerW = instPowerW;
      }
    }

    if (activeCount === 0) {
      continue;
    }

    const tiS = activeCount * DT_SECONDS;
    const volumeL = sumF * DT_SECONDS;
    const meanP = sumP / activeCount;
    const meanF = sumF / activeCount;
    const wobJ = sumInstPowerW * DT_SECONDS;
    const meanPowerW = wobJ / tiS;

    breaths.push({
      breathIndex,
      breathStartRaw,
      targetLoadCmh2o,
      inspiratoryTimeS: roundTo(tiS, 3),
      inspiredVolumeL: roundTo(volumeL, 3),
      peakPressureCmh2o: roundTo(peakP, 2),
      meanPressureCmh2o: roundTo(meanP, 2),
      peakFlowLs: roundTo(peakF, 3),
      meanFlowLs: roundTo(meanF, 3),
      workOfBreathingJ: roundTo(wobJ, 2),
      meanPowerW: roundTo(meanPowerW, 2),
      peakPowerW: roundTo(peakPowerW, 2),
    });
  }

  if (breaths.length === 0) {
    return {
      sessionTimestamp,
      targetLoadHeader,
      breaths: [],
      summary: {
        breathCount: 0,
        targetLoadCmh2o: targetLoadHeader ?? 0,
        peakPressureCmh2o: 0,
        meanPressureCmh2o: 0,
        peakFlowLs: 0,
        meanFlowLs: 0,
        meanVolumeL: 0,
        totalVolumeL: 0,
        totalWorkJ: 0,
        meanPowerW: 0,
        peakPowerW: 0,
        sIndexEstimate: 0,
        flowDropPct: 0,
      },
    };
  }

  let maxTargetLoad = targetLoadHeader ?? 0;
  let maxPeakP = 0;
  let sumMeanP = 0;
  let maxPeakF = 0;
  let sumMeanF = 0;
  let sumVol = 0;
  let sumWork = 0;
  let sumMeanPower = 0;
  let maxPeakPower = 0;

  for (const b of breaths) {
    if (b.targetLoadCmh2o !== null && b.targetLoadCmh2o > maxTargetLoad) {
      maxTargetLoad = b.targetLoadCmh2o;
    }
    if (b.peakPressureCmh2o > maxPeakP) maxPeakP = b.peakPressureCmh2o;
    sumMeanP += b.meanPressureCmh2o;
    if (b.peakFlowLs > maxPeakF) maxPeakF = b.peakFlowLs;
    sumMeanF += b.meanFlowLs;
    sumVol += b.inspiredVolumeL;
    sumWork += b.workOfBreathingJ;
    sumMeanPower += b.meanPowerW;
    if (b.peakPowerW > maxPeakPower) maxPeakPower = b.peakPowerW;
  }

  const n = breaths.length;

  // Calcul du flowDropPct entre les 5 premiers et 5 derniers cycles (ou moities si < 10)
  let flowDropPct = 0;
  if (n >= 2) {
    const windowSize = n >= 10 ? 5 : Math.floor(n / 2);
    let firstSum = 0;
    let lastSum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      firstSum += breaths[i].peakFlowLs;
      lastSum += breaths[n - windowSize + i].peakFlowLs;
    }
    const firstAvg = firstSum / windowSize;
    const lastAvg = lastSum / windowSize;
    if (firstAvg > 0) {
      flowDropPct = roundTo(((lastAvg - firstAvg) / firstAvg) * 100, 1);
    }
  }

  // Estimation S-Index dynamique (regression PIF * 18.5 cmH2O/L.s^-1 bornee par P_peak)
  const sIndexEstimate = roundTo(
    clampRange(Math.max(maxPeakP, maxPeakF * 18.5), 10, 350),
    1
  );

  return {
    sessionTimestamp,
    targetLoadHeader,
    breaths,
    summary: {
      breathCount: n,
      targetLoadCmh2o: roundTo(clampRange(maxTargetLoad, 0, 300), 1),
      peakPressureCmh2o: roundTo(maxPeakP, 2),
      meanPressureCmh2o: roundTo(sumMeanP / n, 2),
      peakFlowLs: roundTo(maxPeakF, 3),
      meanFlowLs: roundTo(sumMeanF / n, 3),
      meanVolumeL: roundTo(sumVol / n, 3),
      totalVolumeL: roundTo(sumVol, 3),
      totalWorkJ: roundTo(clampRange(sumWork, 0, 50000), 2),
      meanPowerW: roundTo(sumMeanPower / n, 2),
      peakPowerW: roundTo(maxPeakPower, 2),
      sIndexEstimate,
      flowDropPct,
    },
  };
}
