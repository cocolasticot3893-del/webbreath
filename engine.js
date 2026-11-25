/**
 * Moteur mathématique déterministe et générateur de télémétrie Intervals.icu pour WebBreath.
 * Compatible ES2024+ natif zéro-build (Navigateur & Node.js ESM).
 */

import { CATEGORIES, getCatalogExercise } from "./catalog.js";
import { CMH2O_L_TO_JOULES } from "./k5Parser.js";
import { fuseVentilationAndPressure } from "./telemetryFusion.js";

const DEFAULT_BREATH_VOLUME_L = 2.5;

const RESISTANCE_CATEGORIES = new Set([
  CATEGORIES.IMT_STRENGTH,
  CATEGORIES.IMT_SPEED_POWER,
  CATEGORIES.RME_ENDURANCE,
  CATEGORIES.EMT_EXPIRATORY,
  CATEGORIES.IMW_WARMUP,
]);

/**
 * Formate un entier sur 2 chiffres.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Contraint un nombre dans l'intervalle `[min, max]`.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Retourne un nombre fini ou la valeur de repli.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Retourne un nombre fini ou `null`.
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formate une date en ISO local sans fuseau (`YYYY-MM-DDTHH:mm:ss`).
 * @param {Date | string | number} dateObj
 * @returns {string}
 */
function formatLocalIsoDateTime(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj ?? Date.now());
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}T${pad2(safe.getHours())}:${pad2(safe.getMinutes())}:${pad2(safe.getSeconds())}`;
}

/**
 * Formate l'identifiant externe unique Intervals.icu en heure locale.
 * Format : `pwa_breath_YYYY-MM-DD_HHmm`.
 * @param {Date | string | number} [dateObj=new Date()]
 * @returns {string}
 */
export function formatExternalId(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `pwa_breath_${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}_${pad2(safe.getHours())}${pad2(safe.getMinutes())}`;
}

/**
 * Convertit la dyspnée Borg CR-10 (0..10) en échelle de ressenti Intervals.icu (1..5).
 * <=3 -> 1, <=5 -> 2, <=7 -> 3, <=9 -> 4, 10 -> 5.
 * @param {number} borgRpe
 * @returns {1 | 2 | 3 | 4 | 5}
 */
export function mapDyspneaToFeeling(borgRpe) {
  const rpe = toFiniteNumber(borgRpe, 5);
  if (rpe <= 3) return 1;
  if (rpe <= 5) return 2;
  if (rpe <= 7) return 3;
  if (rpe <= 9) return 4;
  return 5;
}

/**
 * Assainit un libellé personnalisé (supprime balises HTML, caractères de contrôle et pipes `|`)
 * puis tronque à 80 caractères.
 * @param {unknown} label
 * @returns {string}
 */
export function sanitizeCustomLabel(label) {
  if (typeof label !== "string") return "";
  return label
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

/**
 * Assainit les notes libres de séance (retire les balises `[TELEMETRY_JSON]`, contrôles, max 500 car.).
 * @param {unknown} notes
 * @returns {string}
 */
function sanitizeSessionNotes(notes) {
  if (typeof notes !== "string") return "";
  return notes
    .replace(/\[\/?TELEMETRY_JSON\]/gi, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .trim();
}

/**
 * Supprime récursivement les clés dangereuses (`__proto__`, `constructor`, `prototype`)
 * d'un objet JSON parsé.
 * @param {unknown} value
 * @returns {unknown}
 */
function stripDangerousJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripDangerousJsonKeys);
  }
  if (value && typeof value === "object") {
    const clean = {};
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      clean[key] = stripDangerousJsonKeys(value[key]);
    }
    return clean;
  }
  return value;
}

/**
 * Extrait un niveau numérique depuis une charge brute (cmH2O, Niveau 0-10, ou A-F / 1-6).
 * @param {unknown} rawLoad
 * @returns {number}
 */
function parseNumericLoad(rawLoad) {
  if (typeof rawLoad === "number") {
    return Number.isFinite(rawLoad) ? Math.max(0, rawLoad) : 0;
  }
  if (typeof rawLoad !== "string") {
    return 0;
  }
  const trimmed = rawLoad.trim();
  if (!trimmed) return 0;

  // Format Airofit mécanique "A-F / 1-6" (ex. "E / 1" ou "D / 4")
  const airofitMatch = trimmed.match(/^([A-F])\s*\/\s*(\d+(?:\.\d+)?)$/i);
  if (airofitMatch) {
    const letterVal = airofitMatch[1].toUpperCase().charCodeAt(0) - 64; // A=1..F=6
    const numVal = clamp(Number(airofitMatch[2]) || 1, 1, 6);
    return Math.round(((letterVal + numVal) / 1.2) * 10) / 10; // ~1.7 à 10.0
  }

  // Format "Niveau 5" ou nombre simple
  const numMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (numMatch && !/nasal/i.test(trimmed)) {
    return Math.max(0, Number(numMatch[1]) || 0);
  }
  return 0;
}

/**
 * Calcule la durée d'un cycle respiratoire à partir du pacer catalogue.
 * @param {ReturnType<typeof getCatalogExercise>} cat
 * @returns {number}
 */
function getCycleDurationSec(cat) {
  const p = cat?.pacer_pattern;
  if (!p) return 5;
  const total =
    toFiniteNumber(p.inhale_s, 0) +
    toFiniteNumber(p.hold_in_s, 0) +
    toFiniteNumber(p.exhale_s, 0) +
    toFiniteNumber(p.hold_out_s, 0);
  return total > 0 ? total : 5;
}

/**
 * Détermine si un exercice exerce une résistance mécanique de valve.
 * @param {ReturnType<typeof getCatalogExercise>} cat
 * @param {number} numericLoad
 * @returns {boolean}
 */
function isPressureResistanceExercise(cat, numericLoad) {
  if (!cat || !RESISTANCE_CATEGORIES.has(cat.category)) {
    return false;
  }
  const unit = String(cat.unit_label || "");
  if (unit === "cmH₂O" || unit === "cmH2O" || unit === "Niveau 0-10" || unit === "A-F / 1-6") {
    return numericLoad > 0;
  }
  return false;
}

/**
 * Calcule les contributions unitaires d'un exercice (travail J, strain AU, durée s).
 * @param {Record<string, unknown>} ex
 * @param {object} context
 * @param {number} context.sIndex
 * @param {number} context.mep
 * @param {object | null} context.sessionK5Summary
 * @param {boolean} context.sessionK5Used
 */
function computeExerciseContribution(ex, { sIndex, mep, sessionK5Summary, sessionK5Used }) {
  const cat = getCatalogExercise(String(ex.id ?? ""));
  const sets = Math.max(0, toFiniteNumber(ex.sets ?? cat?.default_sets, 0));
  const reps = Math.max(0, toFiniteNumber(ex.reps ?? cat?.default_reps, 0));
  const completion = clamp(toFiniteNumber(ex.completion, 1), 0, 1);
  const rawLoad = ex.load ?? cat?.default_load ?? 0;
  const numericLoad = parseNumericLoad(rawLoad);

  const stimulusWeight = toFiniteNumber(cat?.stimulus_weight, 1.0);
  const diaphragmTax = toFiniteNumber(cat?.diaphragm_tax, 1.0);
  const isTimed = typeof ex.is_timed === "boolean" ? ex.is_timed : Boolean(cat?.is_timed);
  const unit = String(cat?.unit_label ?? "");

  // Durée effective de l'exercice en secondes
  let durationSec = 0;
  if (isTimed && unit === "s" && reps <= 10 && numericLoad > 0) {
    const pacer = cat?.pacer_pattern ?? { inhale_s: 3, exhale_s: 3 };
    const breathTransition = toFiniteNumber(pacer.inhale_s, 3) + toFiniteNumber(pacer.exhale_s, 3);
    durationSec = sets * completion * reps * (numericLoad + breathTransition);
  } else if (isTimed) {
    durationSec = sets * completion * reps;
  } else {
    durationSec = sets * completion * reps * getCycleDurationSec(cat);
  }

  // Travail mécanique (Joules) : priorité au CSV K5 réel si présent
  let workJ = 0;
  let usedSessionK5 = false;
  const exK5Work = toFiniteOrNull(ex.k5_summary?.totalWorkJ);
  const sessK5Work = toFiniteOrNull(sessionK5Summary?.totalWorkJ);

  if (exK5Work !== null && exK5Work >= 0) {
    workJ = clamp(exK5Work, 0, 50000) * completion;
  } else if (
    !sessionK5Used &&
    sessK5Work !== null &&
    sessK5Work >= 0 &&
    (String(ex.id ?? "").startsWith("k5_") || isPressureResistanceExercise(cat, numericLoad))
  ) {
    workJ = clamp(sessK5Work, 0, 50000);
    usedSessionK5 = true;
  } else if (isPressureResistanceExercise(cat, numericLoad)) {
    const isMechanical = unit === "Niveau 0-10" || unit === "A-F / 1-6";
    const loadFactor = isMechanical ? numericLoad * 10 : numericLoad;
    workJ = sets * completion * reps * loadFactor * DEFAULT_BREATH_VOLUME_L * CMH2O_L_TO_JOULES;
  } else {
    workJ = 0;
  }

  // Strain respiratoire (AU) pondéré par intensité relative, stimulus_weight, diaphragm_tax et completion
  let strain = 0;
  if (completion > 0 && sets > 0) {
    if (cat?.category === CATEGORIES.VAGAL_MOBILITY) {
      const minutes = durationSec / 60;
      strain = minutes * 0.25 * stimulusWeight * diaphragmTax;
    } else if (cat?.category === CATEGORIES.CO2_HYPOXIA) {
      const minutes = durationSec / 60;
      const relIntensity = unit === "s" ? clamp(numericLoad / 60, 0.1, 1.5) : 0.4;
      strain = minutes * 2.5 * relIntensity * stimulusWeight * diaphragmTax;
    } else if (unit === "L/min") {
      const minutes = durationSec / 60;
      const relIntensity = clamp(numericLoad / 150, 0.1, 1.3);
      strain = minutes * 2.0 * relIntensity * stimulusWeight * diaphragmTax;
    } else if (unit === "Niveau 0-10" || unit === "A-F / 1-6") {
      const relIntensity = clamp(numericLoad / 10, 0, 1.5);
      strain = sets * completion * reps * 0.6 * relIntensity * stimulusWeight * diaphragmTax;
    } else if (unit === "cmH₂O" || unit === "cmH2O") {
      const refPressure = cat?.category === CATEGORIES.EMT_EXPIRATORY ? mep : sIndex;
      const relIntensity = refPressure > 0 ? clamp(numericLoad / refPressure, 0, 1.5) : 0.5;
      strain = sets * completion * reps * 0.6 * relIntensity * stimulusWeight * diaphragmTax;
    } else {
      const minutes = durationSec / 60;
      strain = minutes * 0.8 * stimulusWeight * diaphragmTax;
    }
  }

  const weightedDone = completion * sets * diaphragmTax;
  const weightedTotal = sets * diaphragmTax;

  return {
    cat,
    sets,
    reps,
    rawLoad,
    numericLoad,
    completion,
    isTimed,
    workJ,
    strain,
    durationSec,
    weightedDone,
    weightedTotal,
    usedSessionK5,
  };
}

/**
 * Calcule de façon 100 % déterministe les métriques respiratoires d'une séance WebBreath.
 * @param {object} session
 * @returns {{
 *   respWorkJ: number,
 *   respiratoryStrain: number,
 *   effectiveDurationSec: number,
 *   compliancePct: number,
 *   intervalsLoad: number,
 *   sIndexCmh2o: number,
 *   mepCmh2o: number,
 *   boltSec: number | null,
 *   spo2Min: number | null,
 *   borgRpe: number,
 *   feeling: 1 | 2 | 3 | 4 | 5,
 *   strainZone: "GREEN" | "ORANGE" | "RED",
 *   safetyAlerts: Array<{ level: "CRITICAL" | "WARNING", code: string, message: string }>,
 *   exerciseBreakdown: Array<Record<string, unknown>>
 * }}
 */
export function computeSessionMetrics(session = {}) {
  const exercises = Array.isArray(session.exercises) ? session.exercises : [];
  const sIndex = Math.max(10, toFiniteNumber(session.s_index_cmh2o, 111));
  const mep = Math.max(10, toFiniteNumber(session.mep_cmh2o, 120));
  const borgRpe = clamp(toFiniteNumber(session.borg_rpe, 5), 0, 10);
  const spo2Min = toFiniteOrNull(session.spo2_min);
  const boltSec = toFiniteOrNull(session.bolt_sec);
  const rawPressureObj =
    session.k5_summary && typeof session.k5_summary === "object"
      ? session.k5_summary
      : session.pressure_summary && typeof session.pressure_summary === "object"
        ? session.pressure_summary
        : null;
  const sessionK5Summary = rawPressureObj
    ? rawPressureObj.summary && typeof rawPressureObj.summary === "object"
      ? rawPressureObj.summary
      : rawPressureObj
    : null;
  const tymewearRaw =
    session.tymewear_summary && typeof session.tymewear_summary === "object"
      ? session.tymewear_summary
      : null;

  let totalWorkJ = 0;
  let totalStrain = 0;
  let totalDurationSec = 0;
  let weightedDoneSum = 0;
  let weightedTotalSum = 0;
  let sessionK5Used = false;
  const exerciseBreakdown = [];

  for (const ex of exercises) {
    if (!ex || typeof ex !== "object") continue;
    const contrib = computeExerciseContribution(ex, {
      sIndex,
      mep,
      sessionK5Summary,
      sessionK5Used,
    });
    if (contrib.usedSessionK5) {
      sessionK5Used = true;
    }

    totalWorkJ += contrib.workJ;
    totalStrain += contrib.strain;
    totalDurationSec += contrib.durationSec;
    weightedDoneSum += contrib.weightedDone;
    weightedTotalSum += contrib.weightedTotal;

    exerciseBreakdown.push({
      id: String(ex.id ?? ""),
      name: sanitizeCustomLabel(ex.custom_label) || contrib.cat?.name || String(ex.id ?? ""),
      pole: contrib.cat?.pole ?? "AUTRE",
      sets: contrib.sets,
      reps: contrib.reps,
      load: contrib.rawLoad,
      completion: contrib.completion,
      is_timed: contrib.isTimed,
      workJ: Math.round(contrib.workJ * 10) / 10,
      strain: Math.round(contrib.strain * 10) / 10,
      durationSec: Math.round(contrib.durationSec),
    });
  }

  const respWorkJ = Math.round(clamp(totalWorkJ, 0, 50000) * 10) / 10;
  const respiratoryStrain = Math.round(totalStrain * 10) / 10;
  const elapsedOverride = toFiniteOrNull(session.elapsed_time_sec);
  const effectiveDurationSec = Math.round(
    elapsedOverride !== null && elapsedOverride > 0
      ? Math.max(totalDurationSec, Math.min(elapsedOverride, totalDurationSec + 180))
      : totalDurationSec
  );

  const compliancePct =
    weightedTotalSum <= 0
      ? 0
      : Math.round((100 * weightedDoneSum) / weightedTotalSum);

  const intervalsLoad = Math.max(
    1,
    Math.round(respiratoryStrain * 0.45 + (effectiveDurationSec / 60) * 0.8)
  );

  let strainZone = "GREEN";
  if (respiratoryStrain > 85) {
    strainZone = "RED";
  } else if (respiratoryStrain >= 45) {
    strainZone = "ORANGE";
  }

  /** @type {Array<{ level: "CRITICAL" | "WARNING", code: string, message: string }>} */
  const safetyAlerts = [];

  if (spo2Min !== null && spo2Min < 88) {
    safetyAlerts.push({
      level: "CRITICAL",
      code: "SPO2_CRITICAL",
      message: `Désaturation critique détectée (SpO₂ min ${spo2Min} % < 88 %) : arrêt immédiat de l'hypoxie/apnée requis.`,
    });
  } else if (spo2Min !== null && spo2Min < 92) {
    safetyAlerts.push({
      level: "WARNING",
      code: "SPO2_LOW",
      message: `SpO₂ basse (${spo2Min} % < 92 %) : allonger la récupération nasale entre les séries.`,
    });
  }

  if (respiratoryStrain > 85) {
    safetyAlerts.push({
      level: session.pre_intense_session ? "CRITICAL" : "WARNING",
      code: session.pre_intense_session
        ? "PRE_INTENSE_METABOREFLEX_RISK"
        : "HIGH_RESP_STRAIN",
      message: session.pre_intense_session
        ? `Strain respiratoire élevé (${respiratoryStrain} AU > 85) avant séance intense : risque de métaboréflexe inspiratoire.`
        : `Strain respiratoire élevé (${respiratoryStrain} AU > 85) : éviter une séance intense dans les prochaines heures.`,
    });
  }

  if (borgRpe >= 9) {
    safetyAlerts.push({
      level: "WARNING",
      code: "DYSPNEA_HIGH",
      message: `Dyspnée maximale (Borg ${borgRpe}/10) : vérifier le relâchement cervical et le temps de récupération.`,
    });
  }

  if (boltSec !== null && boltSec < 15) {
    safetyAlerts.push({
      level: "WARNING",
      code: "LOW_BOLT_SCORE",
      message: `Score BOLT bas (${boltSec} s < 15 s) : privilégier la résonance vagale 0,1 Hz et limiter les apnées.`,
    });
  }

  const rawK5SIndex = toFiniteOrNull(sessionK5Summary?.sIndexEstimate);
  const resolvedSIndex =
    rawK5SIndex !== null ? clamp(rawK5SIndex, 10, 350) : clamp(sIndex, 10, 350);

  const rawFusion =
    tymewearRaw || sessionK5Summary
      ? fuseVentilationAndPressure({
          tymewear: tymewearRaw,
          pressure: sessionK5Summary,
        })
      : null;
  const fusion =
    rawFusion && (rawFusion.hasTymewear || rawFusion.hasPressure) ? rawFusion : null;

  return {
    respWorkJ,
    respiratoryStrain,
    effectiveDurationSec,
    compliancePct,
    intervalsLoad,
    sIndexCmh2o: Math.round(resolvedSIndex * 10) / 10,
    mepCmh2o: Math.round(mep * 10) / 10,
    boltSec,
    spo2Min,
    borgRpe,
    feeling: mapDyspneaToFeeling(borgRpe),
    strainZone,
    safetyAlerts,
    exerciseBreakdown,
    tymewear: fusion?.tymewear ?? null,
    fusion,
  };
}

/**
 * Construit le compte-rendu Markdown, le JSON de télémétrie embarqué et le payload
 * Intervals.icu prêt pour `POST /api/v1/athlete/{id}/activities/manual`.
 * @param {object} session
 * @param {ReturnType<typeof computeSessionMetrics>} [metricsInput]
 * @returns {{ markdown: string, payload: Record<string, unknown>, telemetryJson: Record<string, unknown> }}
 */
export function buildSessionMarkdownAndPayload(session = {}, metricsInput = null) {
  const metrics = metricsInput ?? computeSessionMetrics(session);
  const rawDate = session.dateObj ?? session.date ?? new Date();
  const dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
  const safeDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;

  const external_id = formatExternalId(safeDate);
  const start_date_local = formatLocalIsoDateTime(safeDate);
  const theme = sanitizeCustomLabel(session.theme) || "Entraînement Respiratoire";
  const name = sanitizeCustomLabel(session.name) || `WebBreath — ${theme}`;
  const exercises = Array.isArray(session.exercises) ? session.exercises : [];

  const lines = [
    `### WebBreath Telemetry — ${theme}`,
    `- **Borg Dyspnée**: ${metrics.borgRpe}/10 (Feeling ${metrics.feeling}/5) | **Compliance**: ${metrics.compliancePct}%`,
    `- **Travail Respiratoire**: ${metrics.respWorkJ} J | **Strain**: ${metrics.respiratoryStrain} AU (${metrics.strainZone}) | **Load**: ${metrics.intervalsLoad}`,
    `- **S-Index**: ${metrics.sIndexCmh2o} cmH₂O | **MEP**: ${metrics.mepCmh2o} cmH₂O | **BOLT**: ${metrics.boltSec ?? "N/A"} s | **SpO₂ min**: ${metrics.spo2Min ?? "N/A"} %`,
  ];

  if (metrics.fusion && (metrics.fusion.hasTymewear || metrics.fusion.hasPressure)) {
    const c = metrics.fusion.combined;
    lines.push(
      `- **Fusion Ventilation / Pression**: VE moy ${c.veAvgLMin ?? "N/A"} L/min (pic ${c.vePeakLMin ?? "N/A"}) | Rf ${c.rfAvgBrMin ?? "N/A"} br/min | Vt ${c.vtAvgL ?? "N/A"} L | Coût ${c.ventilatoryCostJPerL ?? "N/A"} J/L`
    );
  }

  if (metrics.safetyAlerts.length > 0) {
    lines.push("", "**Alertes Sécurité** :");
    for (const alert of metrics.safetyAlerts) {
      lines.push(`- [${alert.level}] ${alert.message}`);
    }
  }

  if (typeof session.rationale === "string" && session.rationale.trim().length > 0) {
    lines.push("", `> ${sanitizeCustomLabel(session.rationale)}`);
  }

  lines.push(
    "",
    "| Bloc | Exercice | Charge | Séries×Reps | Statut | Travail | Strain |",
    "| :--- | :--- | :--- | :--- | :--- | ---: | ---: |"
  );

  const compactExercises = exercises.map((ex, idx) => {
    const bd = metrics.exerciseBreakdown[idx] ?? {};
    const cat = getCatalogExercise(String(ex.id ?? ""));
    const blockNum = ex.block ?? idx + 1;
    const displayName =
      sanitizeCustomLabel(ex.custom_label) || bd.name || cat?.name || String(ex.id ?? "Exercice");
    const unitSuffix = bd.is_timed ? "s" : "";
    const unitLabel = cat?.unit_label ? ` ${cat.unit_label}` : "";
    const rawLoadText =
      typeof bd.load === "string" ? bd.load : `${bd.load ?? 0}${unitLabel}`;
    const loadText = sanitizeCustomLabel(rawLoadText) || "0";
    const volText = `${bd.sets ?? 0}×${bd.reps ?? 0}${unitSuffix}`;
    const statusPct = `${Math.round((bd.completion ?? 0) * 100)}%`;

    lines.push(
      `| B${blockNum} | ${displayName} | ${loadText} | ${volText} | ${statusPct} | ${bd.workJ ?? 0} J | ${bd.strain ?? 0} |`
    );

    return {
      id: String(ex.id ?? ""),
      block: blockNum,
      sets: Number(bd.sets ?? 0),
      reps: Number(bd.reps ?? 0),
      load: bd.load ?? 0,
      c: Number(bd.completion ?? 0),
      work_j: Number(bd.workJ ?? 0),
      strain: Number(bd.strain ?? 0),
    };
  });

  const cleanNotes = sanitizeSessionNotes(session.notes);
  if (cleanNotes.length > 0) {
    lines.push("", `**Notes athlète** : ${cleanNotes}`);
  }

  const telemetryJson = {
    schema_v: 1,
    app: "webbreath",
    external_id,
    borg_rpe: metrics.borgRpe,
    resp_work_j: metrics.respWorkJ,
    respiratory_strain: metrics.respiratoryStrain,
    strain_zone: metrics.strainZone,
    s_index_cmh2o: metrics.sIndexCmh2o,
    mep_cmh2o: metrics.mepCmh2o,
    bolt_sec: metrics.boltSec,
    spo2_min: metrics.spo2Min,
    compliance: metrics.compliancePct,
    alerts: metrics.safetyAlerts.map((a) => a.code),
    ex: compactExercises,
    ...(metrics.tymewear ? { tymewear: metrics.tymewear } : {}),
    ...(metrics.fusion
      ? {
          fusion: {
            hasTymewear: metrics.fusion.hasTymewear,
            hasPressure: metrics.fusion.hasPressure,
            ...metrics.fusion.combined,
          },
        }
      : {}),
  };

  lines.push("", `[TELEMETRY_JSON] ${JSON.stringify(telemetryJson)} [/TELEMETRY_JSON]`);

  const markdown = lines.join("\n");
  const elapsedTime = Math.max(
    metrics.effectiveDurationSec,
    Math.round(toFiniteNumber(session.elapsed_time_sec, metrics.effectiveDurationSec))
  );

  const payload = {
    external_id,
    start_date_local,
    type: typeof session.activity_type === "string" && session.activity_type.trim()
      ? session.activity_type.trim()
      : "Workout",
    name,
    moving_time: metrics.effectiveDurationSec,
    elapsed_time: elapsedTime,
    icu_training_load: metrics.intervalsLoad,
    session_rpe: Math.round(metrics.borgRpe),
    feeling: metrics.feeling,
    RespWorkJ: metrics.respWorkJ,
    RespStrainIndex: metrics.respiratoryStrain,
    RespSIndex: metrics.sIndexCmh2o,
    ...(metrics.boltSec !== null ? { RespBoltSec: metrics.boltSec } : {}),
    description: markdown,
  };

  return { markdown, payload, telemetryJson };
}

/**
 * Extrait et parse proprement le JSON entre `[TELEMETRY_JSON]` et `[/TELEMETRY_JSON]`
 * (avec repli sur `[TELEMETRY_JSON] {...}` en fin de texte).
 * @param {unknown} text
 * @returns {Record<string, unknown> | null}
 */
export function parseTelemetryJsonFromDescription(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const blockRegex = /\[TELEMETRY_JSON\]\s*([\s\S]*?)\s*\[\/TELEMETRY_JSON\]/g;
  const matches = [...text.matchAll(blockRegex)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const rawBlock = matches[i][1]?.trim();
    if (!rawBlock) continue;
    try {
      const parsed = JSON.parse(rawBlock);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (stripDangerousJsonKeys(parsed));
      }
    } catch {
      // Ignorer ce bloc invalide et inspecter l'occurrence précédente
    }
  }

  // Repli compatible format ligne unique sans balise fermante
  const lines = text.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[TELEMETRY_JSON]")) {
      const jsonPart = trimmed.slice("[TELEMETRY_JSON]".length).trim();
      if (!jsonPart) continue;
      try {
        const parsed = JSON.parse(jsonPart);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return /** @type {Record<string, unknown>} */ (stripDangerousJsonKeys(parsed));
        }
      } catch {
        // Ignorer cette ligne invalide et inspecter la précédente
      }
    }
  }

  return null;
}
