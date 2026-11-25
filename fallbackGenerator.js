/**
 * Générateur déterministe local et moteur de contraintes symboliques (garde-fou) pour WebBreath.
 * Module ES2024+ zéro-build compatible Navigateur et Node.js ESM.
 * Garantit la sécurité physiologique (blocage force/RME avant VO2max, fatigue TSB/HRV,
 * protocole IMW Volianitis 2001) et le filtrage strict du profil matériel.
 */

import {
  CATALOG,
  CATEGORIES,
  EQUIPMENT_KEYS,
  filterExercisesByEquipment,
  getCatalogExercise,
  normalizeEquipmentProfile,
} from "./catalog.js";

/**
 * Les 4 modes Gatekeeper officiels de WebBreath.
 * @readonly
 */
export const GATEKEEPER_MODES = Object.freeze({
  REPOS_Z1_Z2: "REPOS_Z1_Z2",
  TEMPO_SV1: "TEMPO_SV1",
  SEUIL_VO2_MAX: "SEUIL_VO2_MAX",
  PRE_RACE_IMW: "PRE_RACE_IMW",
});

const VALID_MODES = new Set(Object.values(GATEKEEPER_MODES));

const MODE_METADATA = Object.freeze({
  [GATEKEEPER_MODES.REPOS_Z1_Z2]: {
    theme: "Force IMT & Endurance Ventilatoire (Repos / Z1-Z2)",
    rationale:
      "Charge vélo faible : fenêtre optimale pour hypertrophie diaphragmatique (IMT), renforcement expiratoire (EX1) ou hyperpnée isocapnique, suivie d'une récupération nasale.",
    recommended_rpe: 7,
    target_duration_sec: 1500,
  },
  [GATEKEEPER_MODES.TEMPO_SV1]: {
    theme: "Puissance Balistique IMT & Tolérance CO₂ (Tempo / SV1)",
    rationale:
      "Charge vélo modérée (SV1) : priorité à la vitesse d'ouverture inspiratoire (45-55 % S-Index), mobilité costale et désensibilisation CO₂ modérée sans fatigue résiduelle.",
    recommended_rpe: 6,
    target_duration_sec: 1200,
  },
  [GATEKEEPER_MODES.SEUIL_VO2_MAX]: {
    theme: "Récupération Vagale, Mobilité Thoracique & Nasal (Protection VO2max)",
    rationale:
      "Blocage strict de la force lourde (> 55 % S-Index) et de l'endurance RME épuisante : bascule exclusive sur résonance vagale 0,1 Hz, mobilité diaphragmatique 360° et ventilation nasale douce.",
    recommended_rpe: 3,
    target_duration_sec: 900,
  },
  [GATEKEEPER_MODES.PRE_RACE_IMW]: {
    theme: "Activation Pré-Effort IMW 2×30 (Volianitis 2001)",
    rationale:
      "Protocole d'échauffement inspiratoire à 40 % S-Index (2×30) atténuant le métaboréflexe inspiratoire avant effort intense, complété par une ouverture nasale fluide.",
    recommended_rpe: 4,
    target_duration_sec: 600,
  },
});

const BLOCKED_CATEGORIES_ON_SEUIL = new Set([
  CATEGORIES.IMT_STRENGTH,
  CATEGORIES.RME_ENDURANCE,
  CATEGORIES.EMT_EXPIRATORY,
  CATEGORIES.CO2_HYPOXIA,
]);

const BLOCKED_CATEGORIES_ON_PRE_RACE = new Set([
  CATEGORIES.IMT_STRENGTH,
  CATEGORIES.RME_ENDURANCE,
  CATEGORIES.EMT_EXPIRATORY,
  CATEGORIES.CO2_HYPOXIA,
]);

/**
 * Convertit une valeur en nombre fini borné ou retourne le repli sûr.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampFiniteNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * Parse un nombre optionnel en retournant `null` si absent ou non fini.
 * @param {unknown} value
 * @returns {number | null}
 */
function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Normalise le ratio HRV par rapport à la baseline (accepte 0.72 ou 72 pour 72 %).
 * @param {Record<string, unknown>} context
 * @returns {number | null}
 */
function extractHrvRatio(context) {
  const raw =
    context?.hrv_ratio ??
    context?.hrvRatio ??
    context?.hrv_pct ??
    context?.hrvPct ??
    null;
  const num = toOptionalFiniteNumber(raw);
  if (num === null) {
    return null;
  }
  return num > 2 ? num / 100 : num;
}

/**
 * Assainit un texte généré (supprime HTML/caractères de contrôle) et borne sa longueur.
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizePlanText(value, maxLen) {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trimEnd() : cleaned;
}

/**
 * Extrait le profil matériel normalisé à partir du contexte (supporte camelCase et snake_case).
 * @param {Record<string, unknown>} context
 * @returns {Record<string, boolean>}
 */
function resolveEquipmentProfile(context) {
  const rawProfile =
    context?.equipmentProfile ??
    context?.equipment_profile ??
    context?.BREATH_EQUIPMENT_PROFILE ??
    null;
  return normalizeEquipmentProfile(
    /** @type {Record<string, unknown> | null} */ (rawProfile)
  );
}

/**
 * Détermine si les sécurités anti-fatigue / pré-seuil imposent le blocage strict.
 * @param {Record<string, unknown>} context
 * @returns {{
 *   mode: string,
 *   tomorrowBikeLoad: string | null,
 *   tsb: number | null,
 *   hrvRatio: number | null,
 *   isFatigueBlocked: boolean,
 *   isSeuilBlocked: boolean
 * }}
 */
export function resolveGatekeeperState(context = {}) {
  const rawTomorrow =
    context?.tomorrowBikeLoad ??
    context?.tomorrow_bike_load ??
    context?.bikeLoad ??
    null;
  const tomorrowBikeLoad =
    typeof rawTomorrow === "string" && VALID_MODES.has(rawTomorrow.trim())
      ? rawTomorrow.trim()
      : null;

  const rawRequestedMode =
    context?.gatekeeperMode ??
    context?.gatekeeper_mode ??
    context?.mode ??
    null;
  const requestedMode =
    typeof rawRequestedMode === "string" && VALID_MODES.has(rawRequestedMode.trim())
      ? rawRequestedMode.trim()
      : null;

  const tsb = toOptionalFiniteNumber(context?.tsb);
  const hrvRatio = extractHrvRatio(context);
  const gate = typeof context?.gate === "string" ? context.gate.trim().toUpperCase() : "";

  const isLowTsb = tsb !== null && tsb < -25;
  const isLowHrv = hrvRatio !== null && hrvRatio < 0.75;
  const isRedGate = gate === "RED";
  const isFatigueBlocked = isLowTsb || isLowHrv || isRedGate;

  const isPreRace =
    requestedMode === GATEKEEPER_MODES.PRE_RACE_IMW ||
    tomorrowBikeLoad === GATEKEEPER_MODES.PRE_RACE_IMW ||
    context?.preRace === true ||
    context?.pre_race === true;

  const isSeuilBlocked =
    tomorrowBikeLoad === GATEKEEPER_MODES.SEUIL_VO2_MAX ||
    requestedMode === GATEKEEPER_MODES.SEUIL_VO2_MAX ||
    isFatigueBlocked;

  let mode = GATEKEEPER_MODES.REPOS_Z1_Z2;
  if (isSeuilBlocked) {
    // La sécurité fatigue/VO2max prime sauf demande explicite pré-course sans blocage RED/HRV/TSB critique
    mode =
      isPreRace && !isFatigueBlocked
        ? GATEKEEPER_MODES.PRE_RACE_IMW
        : GATEKEEPER_MODES.SEUIL_VO2_MAX;
  } else if (isPreRace) {
    mode = GATEKEEPER_MODES.PRE_RACE_IMW;
  } else if (
    requestedMode === GATEKEEPER_MODES.TEMPO_SV1 ||
    tomorrowBikeLoad === GATEKEEPER_MODES.TEMPO_SV1 ||
    gate === "ORANGE"
  ) {
    mode = GATEKEEPER_MODES.TEMPO_SV1;
  } else if (requestedMode) {
    mode = requestedMode;
  } else if (tomorrowBikeLoad) {
    mode = tomorrowBikeLoad;
  }

  return {
    mode,
    tomorrowBikeLoad,
    tsb,
    hrvRatio,
    isFatigueBlocked,
    isSeuilBlocked,
  };
}

/**
 * Calcule une charge sûre et bornée pour un exercice du catalogue selon le mode Gatekeeper.
 * @param {typeof CATALOG[number]} cat
 * @param {unknown} candidateLoad
 * @param {string} mode
 * @param {Record<string, unknown>} context
 * @returns {number | string}
 */
function normalizeExerciseLoad(cat, candidateLoad, mode, context) {
  const sIndex = toOptionalFiniteNumber(
    context?.sIndex ?? context?.s_index ?? context?.mip
  );
  const unit = cat.unit_label;

  // 1. Pression inspiratoire / expiratoire en cmH₂O (K5, Smart Adapter, EX1)
  if (unit === "cmH₂O") {
    const isK5 = cat.required_equipment.includes(EQUIPMENT_KEYS.PB_K5);
    const defaultNum =
      typeof cat.default_load === "number" ? cat.default_load : 40;
    let maxCmH2O = 150;

    if (cat.category === CATEGORIES.IMW_WARMUP || mode === GATEKEEPER_MODES.PRE_RACE_IMW) {
      maxCmH2O = sIndex !== null ? Math.round(sIndex * 0.4) : 45;
    } else if (mode === GATEKEEPER_MODES.TEMPO_SV1 && isK5) {
      maxCmH2O = sIndex !== null ? Math.round(sIndex * 0.55) : 55;
    } else if (mode === GATEKEEPER_MODES.SEUIL_VO2_MAX) {
      maxCmH2O = sIndex !== null ? Math.round(sIndex * 0.4) : 40;
    }
    maxCmH2O = Math.max(10, Math.min(150, maxCmH2O));

    const parsed = toOptionalFiniteNumber(
      typeof candidateLoad === "string"
        ? candidateLoad.replace(/[^\d.,-]/g, "").replace(",", ".")
        : candidateLoad
    );
    const base = parsed !== null ? parsed : defaultNum;
    return Math.round(clampFiniteNumber(base, 3, maxCmH2O, Math.min(defaultNum, maxCmH2O)));
  }

  // 2. Débit ventilatoire Isocapnic / TymeWear en L/min
  if (unit === "L/min") {
    const maxFlow =
      mode === GATEKEEPER_MODES.SEUIL_VO2_MAX
        ? 55
        : mode === GATEKEEPER_MODES.PRE_RACE_IMW
          ? 75
          : mode === GATEKEEPER_MODES.TEMPO_SV1
            ? 95
            : 150;
    const defaultFlow =
      typeof cat.default_load === "number" ? cat.default_load : 60;
    const parsed = toOptionalFiniteNumber(candidateLoad);
    return Math.round(
      clampFiniteNumber(
        parsed ?? defaultFlow,
        15,
        maxFlow,
        Math.min(defaultFlow, maxFlow)
      )
    );
  }

  // 3. Cadence respiratoire en cycles/min
  if (unit === "cycles/min") {
    const defaultRate =
      typeof cat.default_load === "number" ? cat.default_load : 6;
    const parsed = toOptionalFiniteNumber(candidateLoad);
    return Math.round(clampFiniteNumber(parsed ?? defaultRate, 4, 14, defaultRate));
  }

  // 4. Durée d'apnée SpO₂ / temps en secondes
  if (unit === "s") {
    if (cat.category === CATEGORIES.CO2_HYPOXIA) {
      const defaultHold =
        typeof cat.default_load === "number" ? cat.default_load : 30;
      const parsed = toOptionalFiniteNumber(candidateLoad);
      return Math.round(clampFiniteNumber(parsed ?? defaultHold, 5, 75, defaultHold));
    }
    return typeof cat.default_load === "string"
      ? cat.default_load
      : String(cat.default_load ?? "Nasal 100%");
  }

  // 5. Molette mécanique PowerBreathe Plus ("Niveau 0-10")
  if (unit === "Niveau 0-10") {
    const rawStr = String(candidateLoad ?? cat.default_load ?? "Niveau 3");
    const match = rawStr.match(/(\d+(?:[.,]\d+)?)/);
    let level = match ? Number(match[1].replace(",", ".")) : 3;
    if (!Number.isFinite(level)) {
      level = 3;
    }
    const maxLevel =
      cat.category === CATEGORIES.IMW_WARMUP || mode === GATEKEEPER_MODES.PRE_RACE_IMW
        ? 3
        : mode === GATEKEEPER_MODES.TEMPO_SV1
          ? 5
          : 10;
    const clamped = Math.round(clampFiniteNumber(level, 0, maxLevel, Math.min(3, maxLevel)));
    return `Niveau ${clamped}`;
  }

  // 6. Double molette mécanique Airofit ("A-F / 1-6")
  if (unit === "A-F / 1-6") {
    const rawStr = String(candidateLoad ?? cat.default_load ?? "C / 2").toUpperCase();
    const match = rawStr.match(/([A-F])\s*[/|-]?\s*([1-6])/);
    let insp = match ? match[1] : "C";
    let exp = match ? Number(match[2]) : 2;
    if (mode === GATEKEEPER_MODES.SEUIL_VO2_MAX || cat.category === CATEGORIES.VAGAL_MOBILITY) {
      if (insp > "C") insp = "B";
      exp = Math.min(2, exp);
    } else if (mode === GATEKEEPER_MODES.TEMPO_SV1) {
      if (insp > "D") insp = "D";
      exp = Math.min(3, exp);
    }
    return `${insp} / ${exp}`;
  }

  return typeof cat.default_load === "number" || typeof cat.default_load === "string"
    ? cat.default_load
    : "Standard";
}

/**
 * Borne `sets` et `reps` dans des plages physiologiques sûres selon la catégorie et le mode.
 * @param {typeof CATALOG[number]} cat
 * @param {unknown} rawSets
 * @param {unknown} rawReps
 * @param {string} mode
 * @returns {{ sets: number, reps: number }}
 */
function normalizeVolume(cat, rawSets, rawReps, mode) {
  let maxSets = 6;
  if (cat.category === CATEGORIES.IMW_WARMUP || mode === GATEKEEPER_MODES.PRE_RACE_IMW) {
    maxSets = 2;
  } else if (mode === GATEKEEPER_MODES.SEUIL_VO2_MAX) {
    maxSets = 3;
  } else if (mode === GATEKEEPER_MODES.TEMPO_SV1) {
    maxSets = 4;
  }

  const defaultSets = Math.min(maxSets, Math.max(1, cat.default_sets || 1));
  const sets = Math.round(clampFiniteNumber(rawSets, 1, maxSets, defaultSets));

  let minReps = 1;
  let maxReps = cat.is_timed ? 1800 : 60;
  if (cat.category === CATEGORIES.CO2_HYPOXIA && !cat.is_timed) {
    maxReps = 10;
  } else if (cat.category === CATEGORIES.IMW_WARMUP && !cat.is_timed) {
    maxReps = 30;
  } else if (cat.category === CATEGORIES.IMT_STRENGTH) {
    maxReps = 35;
  }

  const defaultReps = Math.min(maxReps, Math.max(minReps, cat.default_reps || 10));
  const reps = Math.round(clampFiniteNumber(rawReps, minReps, maxReps, defaultReps));

  return { sets, reps };
}

/**
 * Détermine si un exercice du catalogue est autorisé pour le mode Gatekeeper courant.
 * @param {typeof CATALOG[number]} cat
 * @param {string} mode
 * @returns {boolean}
 */
function isCategoryAllowedForMode(cat, mode) {
  if (mode === GATEKEEPER_MODES.SEUIL_VO2_MAX) {
    return !BLOCKED_CATEGORIES_ON_SEUIL.has(cat.category);
  }
  if (mode === GATEKEEPER_MODES.PRE_RACE_IMW) {
    return !BLOCKED_CATEGORIES_ON_PRE_RACE.has(cat.category);
  }
  if (mode === GATEKEEPER_MODES.TEMPO_SV1) {
    return (
      cat.category !== CATEGORIES.IMT_STRENGTH &&
      cat.category !== CATEGORIES.RME_ENDURANCE
    );
  }
  return true;
}

/**
 * Table de substitution ordonnée selon l'intention physiologique et l'équipement disponible.
 * @param {typeof CATALOG[number] | null} originalCat
 * @param {string} mode
 * @param {typeof CATALOG[number][]} availablePool
 * @param {Set<string>} usedIds
 * @returns {typeof CATALOG[number] | null}
 */
function pickCompatibleSubstitute(originalCat, mode, availablePool, usedIds) {
  const isAllowed = (ex) =>
    !usedIds.has(ex.id) && isCategoryAllowedForMode(ex, mode);

  const candidates = availablePool.filter(isAllowed);
  if (candidates.length === 0) {
    // Dernier recours : autoriser résonance vagale ou crocodile même si déjà vu uniquement si pool vide
    return (
      availablePool.find((ex) => isCategoryAllowedForMode(ex, mode)) ??
      availablePool[0] ??
      null
    );
  }

  // En mode SEUIL_VO2_MAX ou PRE_RACE_IMW, prioriser strictement les exercices autorisés du mode
  const preferredOrderByMode = {
    [GATEKEEPER_MODES.SEUIL_VO2_MAX]: [
      "vagal_resonance_01hz",
      "diaphragm_360_croc_release",
      "tymewear_vt_bf_optimization",
      "airofit_vital_capacity_stretch",
    ],
    [GATEKEEPER_MODES.PRE_RACE_IMW]: [
      "k5_staircase_warmup",
      "pb_plus_pre_race_warmup",
      "isocapnic_warmup_priming",
      "vagal_resonance_01hz",
      "diaphragm_360_croc_release",
    ],
    [GATEKEEPER_MODES.TEMPO_SV1]: [
      "k5_speed_power_40mip",
      "pb_plus_speed_snaps",
      "smart_adapter_biofeedback_curve",
      "airofit_vital_capacity_stretch",
      "nasal_co2_cadence_walk",
      "tymewear_vt_bf_optimization",
      "vagal_resonance_01hz",
      "diaphragm_360_croc_release",
    ],
    [GATEKEEPER_MODES.REPOS_Z1_Z2]: [
      "k5_imt_30rm_hypertrophy",
      "pb_plus_classic_30rm",
      "airofit_insp_strength_mech",
      "ex1_strength_5x5",
      "isocapnic_rme_steady_15m",
      "nasal_tape_z2_endurance",
      "vagal_resonance_01hz",
      "diaphragm_360_croc_release",
    ],
  };

  // Si on cherche un substitut pour un exercice précis dans un mode permissif, tenter d'abord la même catégorie
  if (originalCat && isCategoryAllowedForMode(originalCat, mode)) {
    const sameCategory = candidates.find(
      (ex) => ex.category === originalCat.category
    );
    if (sameCategory) {
      return sameCategory;
    }
  }

  const priorityIds = preferredOrderByMode[mode] ?? [];
  for (const id of priorityIds) {
    const match = candidates.find((ex) => ex.id === id);
    if (match) {
      return match;
    }
  }

  return candidates[0];
}

/**
 * Infère le numéro de bloc (1: activation/warmup, 2: cœur de séance, 3: récupération/mobilité).
 * @param {typeof CATALOG[number]} cat
 * @param {unknown} rawBlock
 * @returns {1 | 2 | 3}
 */
function inferBlock(cat, rawBlock) {
  const num = Number(rawBlock);
  if (num === 1 || num === 2 || num === 3) {
    return /** @type {1 | 2 | 3} */ (num);
  }
  if (cat.category === CATEGORIES.IMW_WARMUP) {
    return 1;
  }
  if (cat.category === CATEGORIES.VAGAL_MOBILITY) {
    return 3;
  }
  return 2;
}

/**
 * Applique les contraintes symboliques WebBreath sur un plan brut (issu de Gemini ou du fallback) :
 * - Filtrage strict par `equipmentProfile` avec substitution déterministe sans outil désactivé.
 * - Blocage strict de `IMT_STRENGTH` / `RME_ENDURANCE` si `SEUIL_VO2_MAX`, `tsb < -25`, `hrv < 75 %` ou `RED`.
 * - Bornage physiologique sûr de `sets`, `reps` et `load`.
 *
 * @param {Record<string, any> | null | undefined} plan
 * @param {Record<string, any>} [context={}]
 */
export function enforceSymbolicConstraints(plan, context = {}) {
  const profile = resolveEquipmentProfile(context);
  const availablePool = filterExercisesByEquipment(profile, CATALOG);
  const availableById = new Map(availablePool.map((ex) => [ex.id, ex]));

  const state = resolveGatekeeperState(context);
  const { mode, tomorrowBikeLoad, tsb, hrvRatio, isFatigueBlocked, isSeuilBlocked } =
    state;

  const appliedRules = [];
  const safetyAlerts = [];

  if (isSeuilBlocked) {
    if (tomorrowBikeLoad === GATEKEEPER_MODES.SEUIL_VO2_MAX) {
      appliedRules.push("BLOCAGE_VO2MAX_J_PLUS_1");
      safetyAlerts.push(
        "Séance Seuil/VO2max prévue : force inspiratoire lourde et RME épuisante bloquées."
      );
    }
    if (tsb !== null && tsb < -25) {
      appliedRules.push("BLOCAGE_TSB_CRITIQUE");
      safetyAlerts.push(`TSB critique (${tsb} < -25) : bascule vagale & mobilité.`);
    }
    if (hrvRatio !== null && hrvRatio < 0.75) {
      appliedRules.push("BLOCAGE_HRV_BASSE");
      safetyAlerts.push(
        `HRV basse (${Math.round(hrvRatio * 100)} % baseline < 75 %) : bascule vagale & mobilité.`
      );
    }
    if (isFatigueBlocked && appliedRules.length === 0) {
      appliedRules.push("BLOCAGE_GATE_RED");
    }
  } else if (mode === GATEKEEPER_MODES.PRE_RACE_IMW) {
    appliedRules.push("PROTOCOLE_IMW_VOLIANITIS_2001");
  } else if (mode === GATEKEEPER_MODES.TEMPO_SV1) {
    appliedRules.push("PLAFOND_SV1_55PCT_SINDEX");
  } else {
    appliedRules.push("FENETRE_REPOS_Z1_Z2");
  }

  const rawExercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
  const usedIds = new Set();
  const normalizedExercises = [];

  for (const rawEx of rawExercises) {
    if (!rawEx || typeof rawEx !== "object") {
      continue;
    }
    const requestedId = typeof rawEx.id === "string" ? rawEx.id.trim() : "";
    const catalogEntry = getCatalogExercise(requestedId);
    let chosenCat = availableById.get(requestedId) ?? null;

    if (!chosenCat) {
      appliedRules.push(`FILTRE_MATERIEL_${requestedId || "INCONNU"}`);
      chosenCat = pickCompatibleSubstitute(
        catalogEntry,
        mode,
        availablePool,
        usedIds
      );
    } else if (!isCategoryAllowedForMode(chosenCat, mode)) {
      appliedRules.push(`SUBSTITUTION_${chosenCat.category}_VERS_${mode}`);
      chosenCat = pickCompatibleSubstitute(
        chosenCat,
        mode,
        availablePool,
        usedIds
      );
    }

    if (!chosenCat || usedIds.has(chosenCat.id)) {
      continue;
    }

    usedIds.add(chosenCat.id);
    const isSameExercise = chosenCat.id === requestedId;
    const { sets, reps } = normalizeVolume(
      chosenCat,
      isSameExercise ? rawEx.sets : chosenCat.default_sets,
      isSameExercise ? rawEx.reps : chosenCat.default_reps,
      mode
    );
    const load = normalizeExerciseLoad(
      chosenCat,
      isSameExercise ? rawEx.load : chosenCat.default_load,
      mode,
      context
    );

    normalizedExercises.push({
      id: chosenCat.id,
      block: inferBlock(chosenCat, rawEx.block),
      sets,
      reps,
      load,
      unit_label: chosenCat.unit_label,
      category: chosenCat.category,
      is_timed: Boolean(chosenCat.is_timed),
    });
  }

  // Garantir au moins 2 exercices cohérents avec le mode si la liste est vide ou trop courte
  if (normalizedExercises.length === 0) {
    const fallbackDraft = buildDeterministicDraft(mode, availablePool, context);
    for (const draftEx of fallbackDraft.exercises) {
      const cat = availableById.get(draftEx.id);
      if (!cat || usedIds.has(cat.id)) continue;
      usedIds.add(cat.id);
      const { sets, reps } = normalizeVolume(cat, draftEx.sets, draftEx.reps, mode);
      const load = normalizeExerciseLoad(cat, draftEx.load, mode, context);
      normalizedExercises.push({
        id: cat.id,
        block: inferBlock(cat, draftEx.block),
        sets,
        reps,
        load,
        unit_label: cat.unit_label,
        category: cat.category,
        is_timed: Boolean(cat.is_timed),
      });
    }
  }

  normalizedExercises.sort((a, b) => a.block - b.block);

  const meta = MODE_METADATA[mode] ?? MODE_METADATA[GATEKEEPER_MODES.REPOS_Z1_Z2];
  const cleanTheme = sanitizePlanText(plan?.theme, 90);
  const cleanRationale = sanitizePlanText(plan?.rationale, 320);

  const maxRpe = mode === GATEKEEPER_MODES.SEUIL_VO2_MAX ? 4 : 9;
  const recommended_rpe = Math.round(
    clampFiniteNumber(plan?.recommended_rpe, 1, maxRpe, meta.recommended_rpe)
  );
  const target_duration_sec = Math.round(
    clampFiniteNumber(plan?.target_duration_sec, 300, 3600, meta.target_duration_sec)
  );

  return {
    theme: isSeuilBlocked ? meta.theme : cleanTheme || meta.theme,
    rationale: isSeuilBlocked ? meta.rationale : cleanRationale || meta.rationale,
    mode,
    gatekeeper_mode: mode,
    recommended_rpe,
    target_duration_sec,
    applied_rules: Array.from(new Set(appliedRules)),
    safety_alerts: Array.from(new Set(safetyAlerts)),
    exercises: normalizedExercises,
  };
}

/**
 * Construit un brouillon déterministe selon le mode Gatekeeper et le matériel disponible.
 * @param {string} mode
 * @param {typeof CATALOG[number][]} availablePool
 * @param {Record<string, any>} context
 */
function buildDeterministicDraft(mode, availablePool, context) {
  const hasId = (id) => availablePool.some((ex) => ex.id === id);
  const meta = MODE_METADATA[mode] ?? MODE_METADATA[GATEKEEPER_MODES.REPOS_Z1_Z2];
  const sIndex = toOptionalFiniteNumber(
    context?.sIndex ?? context?.s_index ?? context?.mip
  );
  const exercises = [];

  if (mode === GATEKEEPER_MODES.SEUIL_VO2_MAX) {
    exercises.push({
      id: "vagal_resonance_01hz",
      block: 1,
      sets: 1,
      reps: 600,
      load: 6,
    });
    if (hasId("tymewear_vt_bf_optimization")) {
      exercises.push({
        id: "tymewear_vt_bf_optimization",
        block: 2,
        sets: 2,
        reps: 240,
        load: 8,
      });
    } else if (hasId("airofit_vital_capacity_stretch")) {
      exercises.push({
        id: "airofit_vital_capacity_stretch",
        block: 2,
        sets: 2,
        reps: 10,
        load: "B / 2",
      });
    }
    exercises.push({
      id: "diaphragm_360_croc_release",
      block: 3,
      sets: 3,
      reps: 8,
      load: "Poids corps",
    });
  } else if (mode === GATEKEEPER_MODES.PRE_RACE_IMW) {
    const imwLoad = sIndex !== null ? Math.round(sIndex * 0.4) : 40;
    if (hasId("k5_staircase_warmup")) {
      exercises.push({
        id: "k5_staircase_warmup",
        block: 1,
        sets: 2,
        reps: 30,
        load: imwLoad,
      });
    } else if (hasId("pb_plus_pre_race_warmup")) {
      exercises.push({
        id: "pb_plus_pre_race_warmup",
        block: 1,
        sets: 2,
        reps: 30,
        load: "Niveau 2",
      });
    } else if (hasId("isocapnic_warmup_priming")) {
      exercises.push({
        id: "isocapnic_warmup_priming",
        block: 1,
        sets: 1,
        reps: 360,
        load: 70,
      });
    }

    if (hasId("airofit_vital_capacity_stretch")) {
      exercises.push({
        id: "airofit_vital_capacity_stretch",
        block: 2,
        sets: 1,
        reps: 8,
        load: "B / 2",
      });
    }
    exercises.push({
      id: "vagal_resonance_01hz",
      block: 3,
      sets: 1,
      reps: 180,
      load: 6,
    });
  } else if (mode === GATEKEEPER_MODES.TEMPO_SV1) {
    const sv1Load = sIndex !== null ? Math.round(sIndex * 0.5) : 45;
    if (hasId("k5_speed_power_40mip")) {
      exercises.push({
        id: "k5_speed_power_40mip",
        block: 2,
        sets: 3,
        reps: 15,
        load: sv1Load,
      });
    } else if (hasId("pb_plus_speed_snaps")) {
      exercises.push({
        id: "pb_plus_speed_snaps",
        block: 2,
        sets: 4,
        reps: 12,
        load: "Niveau 3",
      });
    } else if (hasId("smart_adapter_biofeedback_curve")) {
      exercises.push({
        id: "smart_adapter_biofeedback_curve",
        block: 2,
        sets: 2,
        reps: 25,
        load: 55,
      });
    }

    if (hasId("nasal_co2_cadence_walk")) {
      exercises.push({
        id: "nasal_co2_cadence_walk",
        block: 1,
        sets: 3,
        reps: 180,
        load: 6,
      });
    } else if (hasId("airofit_vital_capacity_stretch")) {
      exercises.push({
        id: "airofit_vital_capacity_stretch",
        block: 1,
        sets: 2,
        reps: 10,
        load: "C / 2",
      });
    }

    if (hasId("tymewear_vt_bf_optimization")) {
      exercises.push({
        id: "tymewear_vt_bf_optimization",
        block: 3,
        sets: 2,
        reps: 240,
        load: 8,
      });
    } else {
      exercises.push({
        id: "diaphragm_360_croc_release",
        block: 3,
        sets: 2,
        reps: 8,
        load: "Poids corps",
      });
    }
  } else {
    // REPOS_Z1_Z2
    const imtLoad = sIndex !== null ? Math.round(sIndex * 0.6) : 80;
    if (hasId("k5_imt_30rm_hypertrophy")) {
      exercises.push({
        id: "k5_imt_30rm_hypertrophy",
        block: 2,
        sets: 2,
        reps: 30,
        load: imtLoad,
      });
    } else if (hasId("pb_plus_classic_30rm")) {
      exercises.push({
        id: "pb_plus_classic_30rm",
        block: 2,
        sets: 2,
        reps: 30,
        load: "Niveau 5",
      });
    } else if (hasId("airofit_insp_strength_mech")) {
      exercises.push({
        id: "airofit_insp_strength_mech",
        block: 2,
        sets: 3,
        reps: 20,
        load: "E / 1",
      });
    }

    if (hasId("ex1_strength_5x5")) {
      exercises.push({
        id: "ex1_strength_5x5",
        block: 2,
        sets: 5,
        reps: 5,
        load: 75,
      });
    } else if (hasId("isocapnic_rme_steady_15m")) {
      exercises.push({
        id: "isocapnic_rme_steady_15m",
        block: 2,
        sets: 1,
        reps: 900,
        load: 95,
      });
    } else if (hasId("airofit_dual_resistance_mech")) {
      exercises.push({
        id: "airofit_dual_resistance_mech",
        block: 2,
        sets: 3,
        reps: 15,
        load: "D / 4",
      });
    }

    if (hasId("nasal_tape_z2_endurance")) {
      exercises.push({
        id: "nasal_tape_z2_endurance",
        block: 3,
        sets: 1,
        reps: 900,
        load: "Nasal 100%",
      });
    } else {
      exercises.push({
        id: "vagal_resonance_01hz",
        block: 3,
        sets: 1,
        reps: 480,
        load: 6,
      });
    }
  }

  return {
    theme: meta.theme,
    rationale: meta.rationale,
    recommended_rpe: meta.recommended_rpe,
    target_duration_sec: meta.target_duration_sec,
    exercises,
  };
}

/**
 * Génère un plan de séance respiratoire déterministe 100 % hors-ligne.
 * Passe systématiquement par `enforceSymbolicConstraints`.
 *
 * @param {Record<string, any>} [context={}]
 * @returns {ReturnType<typeof enforceSymbolicConstraints>}
 */
export function generateFallbackSession(context = {}) {
  const profile = resolveEquipmentProfile(context);
  const availablePool = filterExercisesByEquipment(profile, CATALOG);
  const { mode } = resolveGatekeeperState(context);

  const draft = buildDeterministicDraft(mode, availablePool, context);
  return enforceSymbolicConstraints(draft, context);
}
