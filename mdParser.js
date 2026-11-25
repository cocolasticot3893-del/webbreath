/**
 * Parseur Markdown hors-ligne et normalisateur de séances libres pour WebBreath.
 * Module ES2024+ zéro-build compatible Navigateur et Node.js ESM.
 */

import {
  CATALOG,
  CATEGORIES,
  filterExercisesByEquipment,
  getCatalogExercise,
  normalizeEquipmentProfile,
} from "./catalog.js";

/**
 * Assainit un libellé libre (supprime HTML, `|`, caractères de contrôle) et le borne à 80 caractères.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeCustomLabel(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  const cleaned = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\|/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80).trimEnd() : cleaned;
}

/**
 * Normalise une chaîne pour la recherche lexicale (minuscules, sans accents, alphanumérique).
 * @param {unknown} str
 * @returns {string}
 */
function normalizeLexical(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Borne un entier fini dans `[min, max]` avec valeur de repli.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * Assainit et borne une charge (numérique ou libellé mécanique type "Niveau 5" / "E / 1").
 * @param {unknown} rawLoad
 * @param {typeof CATALOG[number]} cat
 * @returns {number | string}
 */
function sanitizeLoad(rawLoad, cat) {
  if (rawLoad === null || rawLoad === undefined || rawLoad === "") {
    return cat.default_load;
  }
  if (typeof rawLoad === "number") {
    if (!Number.isFinite(rawLoad)) return cat.default_load;
    if (cat.unit_label === "cmH₂O") {
      return Math.round(Math.min(150, Math.max(3, rawLoad)));
    }
    if (cat.unit_label === "L/min") {
      return Math.round(Math.min(160, Math.max(15, rawLoad)));
    }
    if (cat.unit_label === "cycles/min") {
      return Math.round(Math.min(20, Math.max(3, rawLoad)));
    }
    if (cat.unit_label === "s") {
      return Math.round(Math.min(90, Math.max(5, rawLoad)));
    }
    return Math.round(Math.min(200, Math.max(0, rawLoad)));
  }

  const cleanStr = sanitizeCustomLabel(String(rawLoad));
  if (!cleanStr) {
    return cat.default_load;
  }

  const numMaybe = Number(cleanStr.replace(",", "."));
  if (Number.isFinite(numMaybe) && typeof cat.default_load === "number") {
    return sanitizeLoad(numMaybe, cat);
  }
  return cleanStr;
}

/**
 * Déduit le bloc (1: warmup/prépa, 2: cœur de séance, 3: vagal/mobilité) depuis la catégorie.
 * @param {string} category
 * @returns {1 | 2 | 3}
 */
function inferDefaultBlockForCategory(category) {
  if (category === CATEGORIES.IMW_WARMUP) return 1;
  if (category === CATEGORIES.VAGAL_MOBILITY) return 3;
  return 2;
}

/**
 * Table de synonymes normalisés vers les IDs du catalogue WebBreath.
 * Ordonnée du plus spécifique au plus générique.
 */
const CATALOG_SYNONYMS = [
  {
    id: "k5_s_index_assessment",
    phrases: ["s index", "s-index", "test k5", "pif dynamique", "evaluation k5"],
  },
  {
    id: "k5_staircase_warmup",
    phrases: ["echauffement inspiratoire k5", "imw k5", "staircase warmup", "pre effort k5"],
  },
  {
    id: "k5_speed_power_40mip",
    phrases: ["puissance balistique k5", "vitesse k5", "40 mip k5", "speed power k5"],
  },
  {
    id: "k5_endurance_power_drift",
    phrases: ["derive de puissance k5", "endurance k5", "60 cycles k5"],
  },
  {
    id: "k5_imt_30rm_hypertrophy",
    phrases: ["imt force 30rm", "30rm k5", "powerbreathe k5", "imt k5", "k5 force"],
  },
  {
    id: "pb_plus_pre_race_warmup",
    phrases: ["warm up pre course", "warmup pb plus", "imw pb plus"],
  },
  {
    id: "pb_plus_speed_snaps",
    phrases: ["ouverture rapide", "speed snaps", "vitesse pb plus"],
  },
  {
    id: "pb_plus_pyramid_strength",
    phrases: ["pyramide progressive pb plus", "pyramide pb plus"],
  },
  {
    id: "pb_plus_classic_30rm",
    phrases: ["pb plus", "powerbreathe plus", "valve mecanique 2x30"],
  },
  {
    id: "smart_adapter_biofeedback_curve",
    phrases: ["biofeedback courbe", "smart adapter courbe"],
  },
  {
    id: "smart_adapter_paced_rme",
    phrases: ["endurance cadencee smart adapter", "smart adapter rme"],
  },
  {
    id: "ex1_strength_5x5",
    phrases: ["ex1 5x5", "emt force expiratoire", "ex1 force", "5x5 ex1"],
  },
  {
    id: "ex1_endurance_3x15",
    phrases: ["ex1 endurance", "emt endurance expiratoire", "3x15 ex1"],
  },
  {
    id: "ex1_trunk_brace_control",
    phrases: ["gainage sous pression", "ex1 gainage", "trunk brace ex1"],
  },
  {
    id: "isocapnic_rme_intervals_4x4",
    phrases: ["intervalles rme", "isocapnic 4x4", "4x4 isocapnic", "rme 4x4"],
  },
  {
    id: "isocapnic_warmup_priming",
    phrases: ["priming ventilatoire", "isocapnic warmup", "echauffement isocapnic"],
  },
  {
    id: "isocapnic_rme_steady_15m",
    phrases: ["isocapnic", "hyperpnee normocapnique", "sac isocapnic", "rme continue"],
  },
  {
    id: "airofit_vital_capacity_stretch",
    phrases: ["airofit mobilite", "capacite vitale airofit", "vital capacity airofit"],
  },
  {
    id: "airofit_dual_resistance_mech",
    phrases: ["airofit double resistance", "airofit dual", "insp exp airofit"],
  },
  {
    id: "airofit_insp_strength_mech",
    phrases: ["airofit force", "airofit molette", "airofit mecanique", "airofit"],
  },
  {
    id: "nasal_co2_cadence_walk",
    phrases: ["desensibilisation co2", "air hunger", "tolerance co2 nasale"],
  },
  {
    id: "nasal_tape_z2_endurance",
    phrases: ["ventilation nasale", "nasal tape", "mouth tape", "respiration nasale z2"],
  },
  {
    id: "tymewear_vt_bf_optimization",
    phrases: ["ratio vt bf", "optimisation vt bf", "tymewear biofeedback"],
  },
  {
    id: "tymewear_ve_sv1_lock",
    phrases: ["verrouillage ventilatoire", "tymewear sv1", "tymewear"],
  },
  {
    id: "spo2_co2_table_apnea",
    phrases: ["table co2", "apnee spo2", "apnee statique"],
  },
  {
    id: "spo2_walking_expiratory_hold",
    phrases: ["apnee expiratoire en marche", "apnee marche", "walking hold"],
  },
  {
    id: "vagal_resonance_01hz",
    phrases: [
      "resonanc",
      "coherence cardiaque",
      "0 1 hz",
      "01hz",
      "vagal",
      "5s 5s",
      "6 cycles min",
    ],
  },
  {
    id: "diaphragm_360_croc_release",
    phrases: [
      "expansion diaphragmatique",
      "360",
      "crocodile",
      "90 90",
      "mobilite thoracique",
      "relachement diaphragme",
    ],
  },
];

/**
 * Tente de résoudre un texte d'exercice vers un ID officiel du catalogue WebBreath.
 * @param {string} rawName
 * @returns {string | null}
 */
function matchCatalogExerciseId(rawName) {
  const trimmed = String(rawName ?? "").trim();
  if (!trimmed) return null;

  // 1. Correspondance directe par ID exact
  for (const ex of CATALOG) {
    if (trimmed.toLowerCase() === ex.id || normalizeLexical(trimmed) === normalizeLexical(ex.id)) {
      return ex.id;
    }
  }

  const norm = normalizeLexical(trimmed);
  if (!norm) return null;

  // 2. Correspondance par table de synonymes
  for (const entry of CATALOG_SYNONYMS) {
    for (const phrase of entry.phrases) {
      if (norm.includes(phrase)) {
        return entry.id;
      }
    }
  }

  // 3. Score lexical par mots-clés sur le nom officiel
  const stopWords = new Set(["avec", "pour", "dans", "sans", "sur", "mode", "test", "sous"]);
  const inputTokens = new Set(
    norm.split(" ").filter((t) => t.length >= 3 && !stopWords.has(t))
  );
  if (inputTokens.size < 2) {
    return null;
  }

  let bestId = null;
  let bestScore = 0;

  for (const ex of CATALOG) {
    const nameTokens = normalizeLexical(ex.name)
      .split(" ")
      .filter((t) => t.length >= 3 && !stopWords.has(t));
    let matches = 0;
    for (const tok of nameTokens) {
      if (inputTokens.has(tok)) {
        matches++;
      }
    }
    if (matches >= 2 && matches > bestScore) {
      bestScore = matches;
      bestId = ex.id;
    }
  }

  return bestId;
}

/**
 * Choisit un substitut compatible si l'exercice mappé requiert un équipement désactivé.
 * @param {typeof CATALOG[number]} cat
 * @param {typeof CATALOG[number][]} availablePool
 * @returns {{ cat: typeof CATALOG[number], substituted: boolean }}
 */
function ensureEquipmentCompatible(cat, availablePool) {
  if (availablePool.some((ex) => ex.id === cat.id)) {
    return { cat, substituted: false };
  }

  const sameCategory = availablePool.find((ex) => ex.category === cat.category);
  if (sameCategory) {
    return { cat: sameCategory, substituted: true };
  }

  const bodyweightFallback =
    availablePool.find((ex) => ex.id === "vagal_resonance_01hz") ??
    availablePool.find((ex) => ex.id === "diaphragm_360_croc_release") ??
    availablePool[0];

  return {
    cat: bodyweightFallback ?? cat,
    substituted: true,
  };
}

/**
 * Extrait le volume (`sets × reps` ou durée `15 min` / `600s`) et retourne le reste de la ligne.
 * @param {string} text
 * @returns {{ sets: number | null, reps: number | null, hasTimeUnit: boolean, foundVolume: boolean, rest: string }}
 */
function extractVolume(text) {
  // Format "2x30", "3 x 15", "4×240s"
  const volRegex = /(\d+)\s*[x×*]\s*(\d+)\s*(s|sec|secondes?|min|minutes?)?\b/i;
  const match = text.match(volRegex);
  if (match) {
    let repsVal = Number(match[2]);
    const unit = (match[3] ?? "").toLowerCase();
    const isMin = unit.startsWith("min");
    const hasTimeUnit = Boolean(unit);
    if (isMin) {
      repsVal *= 60;
    }
    const rest = (
      text.slice(0, match.index) +
      " " +
      text.slice(match.index + match[0].length)
    )
      .replace(/\s+/g, " ")
      .trim();

    return {
      sets: Number(match[1]),
      reps: repsVal,
      hasTimeUnit,
      foundVolume: true,
      rest,
    };
  }

  // Format durée seule : "15 min" ou "600 s"
  const timeOnlyMatch = text.match(/\b(\d+)\s*(min|minutes?|s|sec|secondes?)\b/i);
  if (timeOnlyMatch) {
    const val = Number(timeOnlyMatch[1]);
    const isMin = timeOnlyMatch[2].toLowerCase().startsWith("min");
    const rest = (
      text.slice(0, timeOnlyMatch.index) +
      " " +
      text.slice(timeOnlyMatch.index + timeOnlyMatch[0].length)
    )
      .replace(/\s+/g, " ")
      .trim();

    return {
      sets: 1,
      reps: isMin ? val * 60 : val,
      hasTimeUnit: true,
      foundVolume: true,
      rest,
    };
  }

  return {
    sets: null,
    reps: null,
    hasTimeUnit: false,
    foundVolume: false,
    rest: text,
  };
}

/**
 * Extrait une charge respiratoire (`80 cmH2O`, `Niveau 5`, `E / 1`, `95 L/min`, `40 %`, `@ 60`) et nettoie le reste.
 * @param {string} text
 * @returns {{ load: number | string | null, rest: string }}
 */
function extractLoad(text) {
  // 1. Airofit double molette ("E / 1", "D/4")
  const airofitMatch = text.match(/(?:@\s*)?\b([A-F])\s*\/\s*([1-6])\b/i);
  if (airofitMatch) {
    const rest = text
      .replace(airofitMatch[0], " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      load: `${airofitMatch[1].toUpperCase()} / ${airofitMatch[2]}`,
      rest,
    };
  }

  // 2. PowerBreathe Plus ("Niveau 5", "Niv 3")
  const levelMatch = text.match(
    /(?:@\s*)?\b(?:niveau|niv\.?)\s*(\d+(?:[.,]\d+)?)\b/i
  );
  if (levelMatch) {
    const num = Math.round(Number(levelMatch[1].replace(",", ".")));
    const rest = text
      .replace(levelMatch[0], " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      load: `Niveau ${Math.min(10, Math.max(0, num))}`,
      rest,
    };
  }

  // 3. Charge numérique avec unité explicite (cmH2O, L/min, cycles/min, %, s)
  const unitMatch = text.match(
    /(?:@\s*)?\b(\d+(?:[.,]\d+)?)\s*(?:cmh2o|cmh₂o|l\/min|cycles\/min|cpm|%|mip|s-index)\b/i
  );
  if (unitMatch) {
    const val = Number(unitMatch[1].replace(",", "."));
    const rest = text
      .replace(unitMatch[0], " ")
      .replace(/\s+/g, " ")
      .trim();
    return { load: val, rest };
  }

  // 4. Charge après `@` (ex: "@ 80")
  const atMatch = text.match(/@\s*(\d+(?:[.,]\d+)?)\b/);
  if (atMatch) {
    const val = Number(atMatch[1].replace(",", "."));
    const rest = text.replace(atMatch[0], " ").replace(/\s+/g, " ").trim();
    return { load: val, rest };
  }

  return { load: null, rest: text };
}

/**
 * Nettoie les marqueurs Markdown d'un libellé.
 * @param {string} raw
 * @returns {string}
 */
function cleanExerciseLabel(raw) {
  return raw
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s*[-–—:@]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vérifie si une ligne de tableau est un séparateur ou en-tête.
 * @param {string} line
 * @param {string[]} cells
 * @returns {boolean}
 */
function isTableHeaderOrSeparator(line, cells) {
  if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)) {
    return true;
  }
  const joined = normalizeLexical(cells.join(" "));
  return /\b(exercice|protocole|outil)\b/.test(joined) && /\b(series|reps|charge|bloc)\b/.test(joined);
}

/**
 * Construit un item normalisé à partir d'un libellé, volume, charge et pool compatible.
 */
function buildParsedItem({ nameCell, sets, reps, hasTimeUnit, foundVolume, parsedLoad, explicitBlock, availablePool }) {
  const cleanLabel = sanitizeCustomLabel(cleanExerciseLabel(nameCell));
  if (!cleanLabel) return null;

  const matchedId = matchCatalogExerciseId(cleanLabel);
  if (matchedId) {
    const originalCat = getCatalogExercise(matchedId);
    const { cat, substituted } = ensureEquipmentCompatible(originalCat, availablePool);
    const item = {
      id: cat.id,
      block: explicitBlock ?? inferDefaultBlockForCategory(cat.category),
      sets: sets ?? cat.default_sets ?? 1,
      reps: reps ?? cat.default_reps ?? (cat.is_timed ? 60 : 10),
      load: parsedLoad !== null ? sanitizeLoad(parsedLoad, cat) : cat.default_load,
      is_timed: foundVolume ? hasTimeUnit : Boolean(cat.is_timed),
    };
    if (substituted) {
      item.is_custom = true;
      item.custom_label = sanitizeCustomLabel(`${cleanLabel} (substitué)`);
    }
    return item;
  }

  // Exercice hors-catalogue sécurisé adossé au modèle sans matériel du catalogue
  const safeBaseCat =
    getCatalogExercise(hasTimeUnit ? "vagal_resonance_01hz" : "diaphragm_360_croc_release") ??
    availablePool[0];

  return {
    id: safeBaseCat.id,
    block: explicitBlock ?? 2,
    sets: clampInt(sets, 1, 10, safeBaseCat.default_sets ?? 1),
    reps: clampInt(reps, 1, 1800, hasTimeUnit ? 180 : 12),
    load: parsedLoad !== null ? sanitizeLoad(parsedLoad, safeBaseCat) : "Libre",
    is_timed: foundVolume ? hasTimeUnit : Boolean(safeBaseCat.is_timed),
    is_custom: true,
    custom_label: cleanLabel,
  };
}

/**
 * Parse une ligne de tableau Markdown (`| ... |`).
 */
function parsePipeLine(line, availablePool) {
  const rawCells = line.split("|").map((c) => c.trim());
  if (line.trim().startsWith("|") && rawCells[0] === "") rawCells.shift();
  if (line.trim().endsWith("|") && rawCells[rawCells.length - 1] === "") rawCells.pop();

  const cells = rawCells.filter((c) => c.length > 0);
  if (cells.length === 0 || isTableHeaderOrSeparator(line, cells)) {
    return null;
  }

  let explicitBlock;
  if (/^B[123]$/i.test(cells[0])) {
    explicitBlock = Number(cells[0][1]);
    cells.shift();
  }
  if (cells.length === 0) return null;

  let nameCell = "";
  let sets = null;
  let reps = null;
  let hasTimeUnit = false;
  let foundVolume = false;
  let parsedLoad = null;

  for (const cell of cells) {
    if (!foundVolume) {
      const vol = extractVolume(cell);
      if (vol.foundVolume) {
        sets = vol.sets;
        reps = vol.reps;
        hasTimeUnit = vol.hasTimeUnit;
        foundVolume = true;
        if (vol.rest && !nameCell) {
          const loadInfo = extractLoad(vol.rest);
          if (loadInfo.load !== null && parsedLoad === null) {
            parsedLoad = loadInfo.load;
          }
          if (loadInfo.rest && /[a-zA-ZÀ-ÿ]/.test(loadInfo.rest)) {
            nameCell = loadInfo.rest;
          }
        }
        continue;
      }
    }

    if (parsedLoad === null) {
      const loadInfo = extractLoad(cell);
      if (loadInfo.load !== null && !loadInfo.rest) {
        parsedLoad = loadInfo.load;
        continue;
      }
    }

    if (!nameCell) {
      nameCell = cell;
    }
  }

  if (!nameCell) return null;
  return buildParsedItem({
    nameCell,
    sets,
    reps,
    hasTimeUnit,
    foundVolume,
    parsedLoad,
    explicitBlock,
    availablePool,
  });
}

/**
 * Parse une ligne de texte ou de liste (`- ...`, `* ...`, `1. ...`).
 */
function parseTextLine(line, availablePool) {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    /^[-*_]{3,}$/.test(trimmed)
  ) {
    return null;
  }

  const isBullet = /^\s*(?:[-*+•]|\d+[.)])\s+/.test(trimmed);
  const withoutBullet = trimmed.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").trim();
  if (!withoutBullet) return null;

  const vol = extractVolume(withoutBullet);
  const loadInfo = extractLoad(vol.rest);
  const directMatch = matchCatalogExerciseId(withoutBullet);

  if (!isBullet && !vol.foundVolume && !directMatch) {
    return null;
  }

  const nameCell = cleanExerciseLabel(loadInfo.rest) || withoutBullet;
  return buildParsedItem({
    nameCell,
    sets: vol.sets,
    reps: vol.reps,
    hasTimeUnit: vol.hasTimeUnit,
    foundVolume: vol.foundVolume,
    parsedLoad: loadInfo.load,
    explicitBlock: undefined,
    availablePool,
  });
}

/**
 * Construit un plan de séance libre prêt pour l'Étape 2 WebBreath.
 * Accepte `(items, title)` ou un objet `{ exercises, title, sourceLabel, rationale }`.
 *
 * @param {Array<Record<string, any>> | { exercises?: Array<Record<string, any>>, title?: string, sourceLabel?: string, rationale?: string }} itemsOrOptions
 * @param {string} [title=""]
 * @returns {{
 *   theme: string,
 *   rationale: string,
 *   mode: string,
 *   gatekeeper_mode: string,
 *   recommended_rpe: number,
 *   target_duration_sec: number,
 *   applied_rules: string[],
 *   safety_alerts: string[],
 *   is_free_mode: boolean,
 *   exercises: Array<Record<string, any>>
 * }}
 */
export function buildFreeSessionPlan(
  itemsOrOptions,
  title = "",
  equipmentProfile = null
) {
  const isArrayArg = Array.isArray(itemsOrOptions);
  const rawItems = isArrayArg
    ? itemsOrOptions
    : Array.isArray(itemsOrOptions?.exercises)
      ? itemsOrOptions.exercises
      : [];
  const items = rawItems.slice(0, 20);
  const rawTitle = isArrayArg ? title : itemsOrOptions?.title ?? title;
  const sourceLabel = isArrayArg ? "" : itemsOrOptions?.sourceLabel ?? "";
  const rawRationale = isArrayArg ? "" : itemsOrOptions?.rationale ?? "";
  const rawEquipmentProfile = isArrayArg
    ? equipmentProfile
    : itemsOrOptions?.equipmentProfile ?? equipmentProfile ?? null;

  if (items.length === 0) {
    throw new Error("Aucun exercice valide fourni pour construire la séance libre.");
  }

  const availablePool = rawEquipmentProfile
    ? filterExercisesByEquipment(
        normalizeEquipmentProfile(rawEquipmentProfile),
        CATALOG
      )
    : null;

  const normalizedExercises = items.map((rawEx) => {
    const baseCat =
      getCatalogExercise(rawEx?.id) ??
      getCatalogExercise("vagal_resonance_01hz") ??
      CATALOG[0];
    const resolved = availablePool
      ? ensureEquipmentCompatible(baseCat, availablePool)
      : { cat: baseCat, substituted: false };
    const cat = resolved.cat;

    const isTimed =
      typeof rawEx?.is_timed === "boolean" && !resolved.substituted
        ? rawEx.is_timed
        : Boolean(cat.is_timed);
    const sets = clampInt(rawEx?.sets, 1, 10, cat.default_sets ?? 1);
    const reps = clampInt(
      rawEx?.reps,
      1,
      isTimed ? 1800 : 100,
      cat.default_reps ?? (isTimed ? 60 : 10)
    );
    const load = sanitizeLoad(rawEx?.load, cat);
    const rawBlock = Number(rawEx?.block);
    const block =
      rawBlock === 1 || rawBlock === 2 || rawBlock === 3
        ? rawBlock
        : inferDefaultBlockForCategory(cat.category);

    const entry = {
      id: cat.id,
      block,
      sets,
      reps,
      load,
      unit_label: cat.unit_label,
      category: cat.category,
      is_timed: isTimed,
    };

    const customLabel = sanitizeCustomLabel(rawEx?.custom_label);
    if (customLabel) {
      entry.custom_label = customLabel;
      entry.is_custom = true;
    } else if (rawEx?.is_custom) {
      entry.is_custom = true;
    }

    return entry;
  });

  const cleanTitle = sanitizeCustomLabel(rawTitle);
  const cleanSource = sanitizeCustomLabel(sourceLabel);
  const theme =
    cleanTitle ||
    (cleanSource ? `Séance Libre — ${cleanSource}` : "Séance Respiratoire Libre");

  const cleanRationale =
    typeof rawRationale === "string"
      ? rawRationale
          .replace(/<[^>]*>/g, " ")
          .replace(/[\u0000-\u001F\u007F]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 280)
      : "";

  const estimatedSec = normalizedExercises.reduce((acc, ex) => {
    const setDuration = ex.is_timed ? ex.reps : ex.reps * 5;
    return acc + ex.sets * (setDuration + 45);
  }, 120);

  return {
    theme,
    rationale:
      cleanRationale ||
      `Mode libre (${normalizedExercises.length} exercices${cleanSource ? `, ${cleanSource}` : ""}).`,
    mode: "MODE_LIBRE",
    gatekeeper_mode: "MODE_LIBRE",
    recommended_rpe: 6,
    target_duration_sec: Math.max(300, Math.min(3600, Math.round(estimatedSec / 60) * 60)),
    applied_rules: ["MODE_LIBRE"],
    safety_alerts: [],
    is_free_mode: true,
    exercises: normalizedExercises,
  };
}

/**
 * Parse une séance respiratoire en Markdown hors-ligne et retourne un plan prêt pour l'Étape 2.
 *
 * @param {string} mdText
 * @param {Record<string, boolean> | null} [equipmentProfile=null]
 */
export function parseMarkdownOffline(mdText, equipmentProfile = null) {
  if (typeof mdText !== "string" || mdText.trim().length === 0) {
    throw new Error("Aucun exercice reconnu dans le texte Markdown.");
  }

  const normalizedProfile = normalizeEquipmentProfile(equipmentProfile);
  const availablePool = filterExercisesByEquipment(normalizedProfile, CATALOG);

  const lines = mdText.split(/\r?\n/);
  let title = "";
  const items = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!title && /^#{1,3}\s+/.test(trimmed)) {
      title = cleanExerciseLabel(trimmed.replace(/^#{1,3}\s+/, ""));
      continue;
    }

    const parsed = trimmed.includes("|")
      ? parsePipeLine(trimmed, availablePool)
      : parseTextLine(trimmed, availablePool);

    if (parsed) {
      items.push(parsed);
    }
  }

  if (items.length === 0) {
    throw new Error("Aucun exercice reconnu dans le texte Markdown.");
  }

  return buildFreeSessionPlan(items, title, normalizedProfile);
}
