/**
 * Constructeur DOM sécurisé pour l'annuaire complet du catalogue WebBreath (28 exercices).
 * Utilise exclusivement `document.createElement`, `textContent` et `sanitizeSvgMarkup` + `DOMParser`
 * (zéro `innerHTML` non sanitisé).
 */

import {
  BODYWEIGHT,
  CATALOG,
  CATEGORIES,
  EQUIPMENT_KEYS,
  normalizeEquipmentProfile,
} from "./catalog.js";
import { buildBreathExerciseSvg, sanitizeSvgMarkup } from "./svgHelper.js";

export const CATEGORY_LABELS = Object.freeze({
  ALL: "Toutes catégories",
  [CATEGORIES.IMT_STRENGTH]: "Force IMT",
  [CATEGORIES.IMT_SPEED_POWER]: "Puissance / S-Index",
  [CATEGORIES.RME_ENDURANCE]: "Endurance RME",
  [CATEGORIES.EMT_EXPIRATORY]: "Expiratoire EMT",
  [CATEGORIES.IMW_WARMUP]: "Échauffement IMW",
  [CATEGORIES.CO2_HYPOXIA]: "Tolérance CO₂ / SpO₂",
  [CATEGORIES.VAGAL_MOBILITY]: "Vagal & Mobilité",
});

export const EQUIPMENT_LABELS = Object.freeze({
  [EQUIPMENT_KEYS.PB_K5]: "POWERbreathe K5",
  [EQUIPMENT_KEYS.PB_PLUS]: "POWERbreathe Plus",
  [EQUIPMENT_KEYS.PB_SMART_ADAPTER]: "Smart Adapter",
  [EQUIPMENT_KEYS.PB_EX1]: "POWERbreathe EX1",
  [EQUIPMENT_KEYS.ISOCAPNIC]: "Isocapnic BWB",
  [EQUIPMENT_KEYS.AIROFIT_MECH]: "Airofit PRO / Active",
  [EQUIPMENT_KEYS.NASAL_MOUTH_TAPE]: "Nasal / Mouth Tape",
  [EQUIPMENT_KEYS.TYMEWEAR]: "TymeWear VitalPro",
  [EQUIPMENT_KEYS.SPO2_OXIMETER]: "Oxymètre SpO₂",
  [BODYWEIGHT]: "Sans matériel",
});

const CATEGORY_ACCENT = Object.freeze({
  [CATEGORIES.IMT_STRENGTH]: { accent: "#06b6d4", secondary: "#10b981" },
  [CATEGORIES.IMT_SPEED_POWER]: { accent: "#38bdf8", secondary: "#06b6d4" },
  [CATEGORIES.RME_ENDURANCE]: { accent: "#10b981", secondary: "#06b6d4" },
  [CATEGORIES.EMT_EXPIRATORY]: { accent: "#f59e0b", secondary: "#06b6d4" },
  [CATEGORIES.IMW_WARMUP]: { accent: "#22d3ee", secondary: "#10b981" },
  [CATEGORIES.CO2_HYPOXIA]: { accent: "#f43f5e", secondary: "#f59e0b" },
  [CATEGORIES.VAGAL_MOBILITY]: { accent: "#10b981", secondary: "#38bdf8" },
});

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "title",
  "style",
  "animate",
  "animatetransform",
]);

/**
 * Parcourt récursivement l'arbre SVG issu de `DOMParser` pour ne conserver que les balises
 * et attributs autorisés.
 * @param {Element} rootEl
 */
function sanitizeParsedSvgTree(rootEl) {
  const walk = (node) => {
    const childNodes = Array.from(node.childNodes || []);
    for (const child of childNodes) {
      if (child.nodeType !== 1) continue;
      const el = /** @type {Element} */ (child);
      const tag = String(el.localName || el.tagName || "").toLowerCase();
      if (!ALLOWED_SVG_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      if (tag === "style" && /@import|url\s*\(/i.test(el.textContent || "")) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes || [])) {
        const attrName = attr.name.toLowerCase();
        const attrLocal = String(attr.localName || attrName).toLowerCase();
        if (attrName.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          attrName === "href" ||
          attrName === "xlink:href" ||
          attrLocal === "href"
        ) {
          if (!String(attr.value || "").trim().startsWith("#")) {
            el.removeAttribute(attr.name);
          }
        }
      }
      walk(el);
    }
  };

  for (const attr of Array.from(rootEl.attributes || [])) {
    const attrName = attr.name.toLowerCase();
    const attrLocal = String(attr.localName || attrName).toLowerCase();
    if (attrName.startsWith("on")) {
      rootEl.removeAttribute(attr.name);
    } else if (
      attrName === "href" ||
      attrName === "xlink:href" ||
      attrLocal === "href"
    ) {
      if (!String(attr.value || "").trim().startsWith("#")) {
        rootEl.removeAttribute(attr.name);
      }
    }
  }
  walk(rootEl);
}

/**
 * Monte un balisage SVG assaini dans un conteneur DOM sans `innerHTML` brut.
 * @param {HTMLElement} container
 * @param {string} rawSvgMarkup
 */
export function mountSafeSvg(container, rawSvgMarkup) {
  if (!container) return;
  container.replaceChildren();
  const safeMarkup = sanitizeSvgMarkup(rawSvgMarkup);
  if (!safeMarkup) return;

  if (typeof DOMParser === "function") {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(safeMarkup, "image/svg+xml");
    const svgRoot = parsedDoc.documentElement;
    if (
      svgRoot &&
      svgRoot.tagName &&
      svgRoot.tagName.toLowerCase() === "svg" &&
      !svgRoot.querySelector("parsererror")
    ) {
      sanitizeParsedSvgTree(svgRoot);
      container.appendChild(document.importNode(svgRoot, true));
      return;
    }
  }

  const fallbackSpan = document.createElement("span");
  fallbackSpan.className = "muted-note";
  fallbackSpan.textContent = "Aperçu SVG indisponible";
  container.appendChild(fallbackSpan);
}

/**
 * Vérifie si un exercice est compatible avec le profil matériel actif.
 * @param {typeof CATALOG[number]} exercise
 * @param {Record<string, boolean>} profile
 * @returns {boolean}
 */
export function isExerciseAvailable(exercise, profile) {
  const reqs = Array.isArray(exercise?.required_equipment)
    ? exercise.required_equipment
    : [];
  return reqs.every((key) => key === BODYWEIGHT || profile[key] === true);
}

/**
 * Filtre le catalogue selon catégorie, équipement actif, disponibilité et recherche.
 * @param {object} [filters]
 * @param {readonly typeof CATALOG[number][]} [filters.exercises]
 * @param {Record<string, unknown> | null} [filters.equipmentProfile]
 * @param {string} [filters.categoryFilter="ALL"]
 * @param {string} [filters.equipmentFilter="ALL"]
 * @param {boolean} [filters.onlyAvailable=false]
 * @param {string} [filters.searchQuery=""]
 * @returns {typeof CATALOG[number][]}
 */
export function filterCatalogDirectory({
  exercises = CATALOG,
  equipmentProfile = null,
  categoryFilter = "ALL",
  equipmentFilter = "ALL",
  onlyAvailable = false,
  searchQuery = "",
} = {}) {
  const profile = normalizeEquipmentProfile(equipmentProfile);
  const query = String(searchQuery ?? "").trim().toLowerCase();

  return (Array.isArray(exercises) ? exercises : CATALOG).filter((ex) => {
    if (categoryFilter && categoryFilter !== "ALL" && ex.category !== categoryFilter) {
      return false;
    }
    const reqs = Array.isArray(ex.required_equipment) ? ex.required_equipment : [];
    if (equipmentFilter && equipmentFilter !== "ALL") {
      if (equipmentFilter === BODYWEIGHT) {
        if (reqs.length > 0 && !reqs.includes(BODYWEIGHT)) return false;
      } else if (!reqs.includes(equipmentFilter)) {
        return false;
      }
    }
    if (onlyAvailable && !isExerciseAvailable(ex, profile)) {
      return false;
    }
    if (query) {
      const haystack = [
        ex.name,
        ex.short_desc,
        ex.science_ref,
        ex.pole,
        CATEGORY_LABELS[ex.category] ?? ex.category,
        ...reqs.map((r) => EQUIPMENT_LABELS[r] ?? r),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Construit le DOM sécurisé de l'annuaire catalogue dans `container`.
 * @param {object} params
 * @param {HTMLElement} params.container
 * @param {HTMLElement | null} [params.countEl]
 * @param {readonly typeof CATALOG[number][]} [params.exercises=CATALOG]
 * @param {Record<string, unknown> | null} [params.equipmentProfile=null]
 * @param {string} [params.categoryFilter="ALL"]
 * @param {string} [params.equipmentFilter="ALL"]
 * @param {boolean} [params.onlyAvailable=false]
 * @param {string} [params.searchQuery=""]
 * @param {(exercise: typeof CATALOG[number]) => void} [params.onOpenGuide]
 * @param {(exercise: typeof CATALOG[number]) => void} [params.onAddToBuilder]
 * @param {(exercise: typeof CATALOG[number]) => void} [params.onLoadPacer]
 * @returns {number} Nombre d'exercices rendus
 */
export function renderCatalogDirectory({
  container,
  countEl = null,
  exercises = CATALOG,
  equipmentProfile = null,
  categoryFilter = "ALL",
  equipmentFilter = "ALL",
  onlyAvailable = false,
  searchQuery = "",
  onOpenGuide,
  onAddToBuilder,
  onLoadPacer,
}) {
  if (!container) return 0;

  const profile = normalizeEquipmentProfile(equipmentProfile);
  const filtered = filterCatalogDirectory({
    exercises,
    equipmentProfile: profile,
    categoryFilter,
    equipmentFilter,
    onlyAvailable,
    searchQuery,
  });

  if (countEl) {
    countEl.textContent = `${filtered.length} / ${exercises.length} exercices`;
  }

  container.replaceChildren();

  if (filtered.length === 0) {
    const emptyCard = document.createElement("div");
    emptyCard.className = "directory-empty card";
    const msg = document.createElement("p");
    msg.textContent =
      "Aucun exercice ne correspond aux filtres sélectionnés (catégorie, matériel ou recherche).";
    emptyCard.appendChild(msg);
    container.appendChild(emptyCard);
    return 0;
  }

  const fragment = document.createDocumentFragment();

  for (const ex of filtered) {
    const available = isExerciseAvailable(ex, profile);
    const card = document.createElement("article");
    card.className = `directory-card ${available ? "is-available" : "is-locked"}`;
    card.dataset.exerciseId = ex.id;

    // En-tête badges
    const head = document.createElement("div");
    head.className = "directory-card-head";

    const catBadge = document.createElement("span");
    catBadge.className = "badge badge-cyan";
    catBadge.textContent = CATEGORY_LABELS[ex.category] ?? ex.category;

    const statusBadge = document.createElement("span");
    statusBadge.className = available
      ? "badge badge-emerald"
      : "badge badge-muted";
    statusBadge.textContent = available ? "Matériel OK" : "Matériel désactivé";

    head.append(catBadge, statusBadge);

    // Aperçu SVG animé sécurisé
    const svgBox = document.createElement("div");
    svgBox.className = "directory-svg-preview";
    const palette = CATEGORY_ACCENT[ex.category] ?? {
      accent: "#06b6d4",
      secondary: "#10b981",
    };
    const p = ex.pacer_pattern ?? { inhale_s: 2, hold_in_s: 0, exhale_s: 4, hold_out_s: 0 };
    const cycleS = Math.max(
      2,
      (Number(p.inhale_s) || 0) +
        (Number(p.hold_in_s) || 0) +
        (Number(p.exhale_s) || 0) +
        (Number(p.hold_out_s) || 0)
    );
    const svgMarkup = buildBreathExerciseSvg(ex.guide?.svg_type ?? "diaphragm_360", {
      width: 280,
      height: 150,
      accentColor: palette.accent,
      secondaryColor: palette.secondary,
      cycleDurationS: cycleS,
      title: ex.name,
      showLabels: false,
    });
    mountSafeSvg(svgBox, svgMarkup);

    // Titre et description
    const title = document.createElement("h3");
    title.className = "directory-card-title";
    title.textContent = ex.name;

    const desc = document.createElement("p");
    desc.className = "directory-card-desc";
    desc.textContent = ex.short_desc;

    // Métadonnées prescription + référence scientifique
    const metaRow = document.createElement("div");
    metaRow.className = "directory-card-meta";

    const volPill = document.createElement("span");
    volPill.className = "meta-chip";
    const unitSuffix = ex.is_timed ? "s" : "";
    const unitLabel = ex.unit_label ? ` ${ex.unit_label}` : "";
    volPill.textContent = `${ex.default_sets}×${ex.default_reps}${unitSuffix} · ${ex.default_load}${unitLabel}`;

    const tempoPill = document.createElement("span");
    tempoPill.className = "meta-chip";
    tempoPill.textContent = `Tempo ${ex.guide?.tempo_badge ?? `${p.inhale_s}/${p.hold_in_s}/${p.exhale_s}/${p.hold_out_s}`}`;

    metaRow.append(volPill, tempoPill);

    // Matériel requis
    const reqList = document.createElement("div");
    reqList.className = "directory-req-list";
    const reqs =
      Array.isArray(ex.required_equipment) && ex.required_equipment.length > 0
        ? ex.required_equipment
        : [BODYWEIGHT];
    for (const eqKey of reqs) {
      const chip = document.createElement("span");
      const eqActive = eqKey === BODYWEIGHT || profile[eqKey] === true;
      chip.className = `req-chip ${eqActive ? "is-on" : "is-off"}`;
      chip.textContent = EQUIPMENT_LABELS[eqKey] ?? eqKey;
      reqList.appendChild(chip);
    }

    const refEl = document.createElement("p");
    refEl.className = "science-ref-badge";
    refEl.textContent = `Réf. : ${ex.science_ref}`;

    // Actions
    const actions = document.createElement("div");
    actions.className = "directory-card-actions";

    const guideBtn = document.createElement("button");
    guideBtn.type = "button";
    guideBtn.className = "btn btn-ghost btn-sm";
    guideBtn.textContent = "Guide SVG";
    guideBtn.addEventListener("click", () => onOpenGuide?.(ex));

    const pacerBtn = document.createElement("button");
    pacerBtn.type = "button";
    pacerBtn.className = "btn btn-secondary btn-sm";
    pacerBtn.textContent = "Pacer";
    pacerBtn.addEventListener("click", () => onLoadPacer?.(ex));

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.textContent = "+ Séance libre";
    addBtn.addEventListener("click", () => onAddToBuilder?.(ex));

    actions.append(guideBtn, pacerBtn, addBtn);
    card.append(head, svgBox, title, desc, metaRow, reqList, refEl, actions);
    fragment.appendChild(card);
  }

  container.appendChild(fragment);
  return filtered.length;
}
