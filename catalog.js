/**
 * Catalogue scientifique immuable des exercices respiratoires WebBreath.
 * Module ES2024+ zero-build compatible Navigateur et Node.js ESM.
 */

export const EQUIPMENT_KEYS = Object.freeze({
  PB_K5: "PB_K5",
  PB_PLUS: "PB_PLUS",
  PB_SMART_ADAPTER: "PB_SMART_ADAPTER",
  PB_EX1: "PB_EX1",
  ISOCAPNIC: "ISOCAPNIC",
  AIROFIT_MECH: "AIROFIT_MECH",
  NASAL_MOUTH_TAPE: "NASAL_MOUTH_TAPE",
  TYMEWEAR: "TYMEWEAR",
  SPO2_OXIMETER: "SPO2_OXIMETER",
});

export const BODYWEIGHT = "BODYWEIGHT";

export const DEFAULT_EQUIPMENT_PROFILE = Object.freeze({
  PB_K5: true,
  PB_PLUS: true,
  PB_SMART_ADAPTER: false,
  PB_EX1: true,
  ISOCAPNIC: true,
  AIROFIT_MECH: true,
  NASAL_MOUTH_TAPE: true,
  TYMEWEAR: true,
  SPO2_OXIMETER: true,
});

export const CATEGORIES = Object.freeze({
  IMT_STRENGTH: "IMT_STRENGTH",
  IMT_SPEED_POWER: "IMT_SPEED_POWER",
  RME_ENDURANCE: "RME_ENDURANCE",
  EMT_EXPIRATORY: "EMT_EXPIRATORY",
  IMW_WARMUP: "IMW_WARMUP",
  CO2_HYPOXIA: "CO2_HYPOXIA",
  VAGAL_MOBILITY: "VAGAL_MOBILITY",
});

/**
 * Verrouille recursivement un objet ou un tableau (immuabilite stricte).
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

/**
 * Normalise un profil d'equipement utilisateur en conservant les valeurs booleennes valides.
 * @param {Record<string, unknown> | null | undefined} profile
 * @returns {Record<string, boolean>}
 */
export function normalizeEquipmentProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const normalized = {};
  for (const key of Object.values(EQUIPMENT_KEYS)) {
    normalized[key] =
      typeof source[key] === "boolean"
        ? source[key]
        : DEFAULT_EQUIPMENT_PROFILE[key];
  }
  return normalized;
}

const RAW_CATALOG = [
  // =========================================================================
  // 1. POWERBREATHE K5 (5 exercices)
  // =========================================================================
  {
    id: "k5_imt_30rm_hypertrophy",
    pole: "FORCE",
    category: CATEGORIES.IMT_STRENGTH,
    required_equipment: [EQUIPMENT_KEYS.PB_K5],
    name: "IMT Force 30RM K5 (50-70 % MIP)",
    short_desc:
      "Deux blocs de 30 inspirations chargees a valve electronique auto-ajustee pour hypertrophie diaphragmatique.",
    science_ref: "Romer et al., J Sports Sci 2002 ; McConnell 2004",
    unit_label: "cmH₂O",
    default_sets: 2,
    default_reps: 30,
    default_load: 80,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.2, exhale_s: 3.5, hold_out_s: 1.0 },
    stimulus_weight: 1.25,
    diaphragm_tax: 1.2,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Debout ou assis buste droit, pince-nez en place, reglage K5 en mode Training a 50-70 % de la MIP.",
      execution: [
        "Vider les poumons calmement jusqu'au volume residuel fonctionnel.",
        "Inspirer de facon rapide et energique pour vaincre la valve electronique.",
        "Expirer passivement et lentement (3-4 s) pour eviter l'hypocapnie.",
      ],
      errors: [
        "Hausser les epaules au lieu d'expandre les cotes basses a 360 degres.",
        "Enchainer trop vite les cycles (risque de vertige hypocapnique).",
      ],
      tempo_badge: "1.5 / 0 / 3.5 / 1",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "k5_s_index_assessment",
    pole: "PUISSANCE",
    category: CATEGORIES.IMT_SPEED_POWER,
    required_equipment: [EQUIPMENT_KEYS.PB_K5],
    name: "Test S-Index & PIF Dynamique K5",
    short_desc:
      "Evaluation de la force dynamique inspiratoire (S-Index) et du debit inspiratoire de pointe (PIF) a charge minimale.",
    science_ref: "Langer et al., Respir Med 2013 ; Minahan et al., 2015",
    unit_label: "cmH₂O",
    default_sets: 1,
    default_reps: 10,
    default_load: 3,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.0, hold_in_s: 0.0, exhale_s: 4.0, hold_out_s: 2.0 },
    stimulus_weight: 0.85,
    diaphragm_tax: 0.75,
    safety_flags: ["max_effort_fresh", "stop_if_dizzy"],
    guide: {
      setup:
        "Selectionner le mode Test sur le K5 (resistance de base 3 cmH₂O), pince-nez obligatoire.",
      execution: [
        "Effectuer une expiration complete mais sans crispation abdominale.",
        "Declencher une inspiration maximale la plus explosive possible jusqu'a la capacite pulmonaire totale.",
        "Attendre au moins 6 secondes entre deux tentatives.",
      ],
      errors: [
        "Amorcer l'inspiration avec la joue (aspiration buccale) au lieu du diaphragme.",
        "Ne pas attendre la stabilisation avant la repetition suivante.",
      ],
      tempo_badge: "MAX / 0 / 4 / 2",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "k5_speed_power_40mip",
    pole: "PUISSANCE",
    category: CATEGORIES.IMT_SPEED_POWER,
    required_equipment: [EQUIPMENT_KEYS.PB_K5],
    name: "Puissance Balistique K5 (35-45 % MIP)",
    short_desc:
      "Inspirations explosives a charge moderee ciblant la vitesse de raccourcissement et la puissance en Watts.",
    science_ref: "Tzelepis et al., J Appl Physiol 1994 ; Romer & McConnell 2003",
    unit_label: "cmH₂O",
    default_sets: 3,
    default_reps: 15,
    default_load: 45,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.0, hold_in_s: 0.0, exhale_s: 3.0, hold_out_s: 1.5 },
    stimulus_weight: 1.1,
    diaphragm_tax: 0.95,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Charger le K5 entre 35 % et 45 % de votre S-Index de reference pour privilegier la vitesse.",
      execution: [
        "Initier le tirage instantanement a partir de la position neutre basse.",
        "Maintenir la pression de crete jusqu'a l'expansion thoracique complete.",
        "Recuperer 90 secondes entre chaque serie de 15 cycles.",
      ],
      errors: [
        "Utiliser une charge trop lourde qui ralentit le temps d'ouverture (> 2 s).",
        "Bloquer le souffle en apnee haute.",
      ],
      tempo_badge: "1 / 0 / 3 / 1.5",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "k5_staircase_warmup",
    pole: "WARMUP",
    category: CATEGORIES.IMW_WARMUP,
    required_equipment: [EQUIPMENT_KEYS.PB_K5],
    name: "Echauffement Inspiratoire K5 (40 % MIP)",
    short_desc:
      "Protocole pre-effort attenuant le metaboreflexe inspiratoire et preparant la ventilation haute intensite.",
    science_ref: "Volianitis et al., Med Sci Sports Exerc 2001",
    unit_label: "cmH₂O",
    default_sets: 2,
    default_reps: 30,
    default_load: 40,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.0, exhale_s: 3.0, hold_out_s: 0.5 },
    stimulus_weight: 0.65,
    diaphragm_tax: 0.45,
    safety_flags: ["warmup_only"],
    guide: {
      setup:
        "Realiser 10 a 15 minutes avant l'echauffement principal ou la seance seuil/VO2max.",
      execution: [
        "Maintenir une charge moderee (~40 % MIP) sans fatigue musculaire residuelle.",
        "Respirer avec fluidite en ouvrant la cage thoracique sur 360 degres.",
        "Prendre 2 minutes de pause entre les deux series de 30.",
      ],
      errors: [
        "Depasser 50 % MIP et generer une fatigue diaphragmatique pre-course.",
      ],
      tempo_badge: "1.5 / 0 / 3 / 0.5",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "k5_endurance_power_drift",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.PB_K5],
    name: "Endurance & Derive de Puissance K5",
    short_desc:
      "Bloc prolonge de 60 cycles mesures sur K5 visant a limiter la perte de puissance sous 10 %.",
    science_ref: "Harms et al., J Appl Physiol 1997 ; Dempsey 2006",
    unit_label: "cmH₂O",
    default_sets: 1,
    default_reps: 60,
    default_load: 50,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.0, exhale_s: 2.5, hold_out_s: 0.5 },
    stimulus_weight: 1.15,
    diaphragm_tax: 1.1,
    safety_flags: ["stop_if_dizzy", "monitor_drift"],
    guide: {
      setup:
        "Configurer le K5 pour une serie longue (ou 2x30 enchaine) a ~50 % de votre charge habituelle.",
      execution: [
        "Conserver un volume inspire superieur a 80 % de la capacite vitale du debut a la fin.",
        "Surveiller le maintien de la puissance moyenne entre les 5 premiers et 5 derniers cycles.",
      ],
      errors: [
        "Reduire progressivement l'amplitude inspiratoire apres le 35e cycle.",
      ],
      tempo_badge: "1.5 / 0 / 2.5 / 0.5",
      svg_type: "k5_pressure",
    },
  },

  // =========================================================================
  // 2. POWERBREATHE PLUS (4 exercices)
  // =========================================================================
  {
    id: "pb_plus_classic_30rm",
    pole: "FORCE",
    category: CATEGORIES.IMT_STRENGTH,
    required_equipment: [EQUIPMENT_KEYS.PB_PLUS],
    name: "IMT Valve Mecanique 2x30 (PB Plus)",
    short_desc:
      "Protocole historique a valve ressort calibree pour augmenter la pression inspiratoire maximale (MIP).",
    science_ref: "McConnell & Romer, Int J Sports Med 2004",
    unit_label: "Niveau 0-10",
    default_sets: 2,
    default_reps: 30,
    default_load: "Niveau 5",
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.2, exhale_s: 3.5, hold_out_s: 1.0 },
    stimulus_weight: 1.2,
    diaphragm_tax: 1.15,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Regler la molette inferieure du PB Plus sur un niveau provoquant l'echec technique autour de 30 reps.",
      execution: [
        "Serrer fermement l'embout entre les levres sans mordre le silicone.",
        "Inspirer vivement pour decoller le clapet a ressort puis remplir a fond.",
        "Expirer lentement par l'embout sans retirer l'appareil.",
      ],
      errors: [
        "Laisser la valve se refermer avant la fin de l'inspiration par manque de debit.",
        "Compacter le cou (recrutement excessif des sterno-cleido-mastoidiens).",
      ],
      tempo_badge: "1.5 / 0 / 3.5 / 1",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "pb_plus_speed_snaps",
    pole: "PUISSANCE",
    category: CATEGORIES.IMT_SPEED_POWER,
    required_equipment: [EQUIPMENT_KEYS.PB_PLUS],
    name: "Ouverture Rapide de Valve (PB Plus)",
    short_desc:
      "Series courtes haute velocite a resistance legere-moderee pour ameliorer la reactivite inspiratoire.",
    science_ref: "Romer & McConnell, Eur J Appl Physiol 2003",
    unit_label: "Niveau 0-10",
    default_sets: 4,
    default_reps: 12,
    default_load: "Niveau 3",
    is_timed: false,
    pacer_pattern: { inhale_s: 0.8, hold_in_s: 0.0, exhale_s: 3.2, hold_out_s: 1.0 },
    stimulus_weight: 0.95,
    diaphragm_tax: 0.8,
    safety_flags: ["stop_if_dizzy"],
    guide: {
      setup:
        "Baisser la molette de 2 crans sous votre niveau 30RM habituel.",
      execution: [
        "Declencher le claquement net de la valve en moins de 150 ms.",
        "Completer le volume thoracique sans pause avant d'expirer doucement.",
      ],
      errors: [
        "Ralentir l'amorce inspiratoire.",
      ],
      tempo_badge: "0.8 / 0 / 3.2 / 1",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "pb_plus_pre_race_warmup",
    pole: "WARMUP",
    category: CATEGORIES.IMW_WARMUP,
    required_equipment: [EQUIPMENT_KEYS.PB_PLUS],
    name: "Warm-up Pre-Course Valve Mecanique",
    short_desc:
      "Activation inspiratoire specifique pre-echauffement reduisant la dyspnee et ameliorant la performance contre-la-montre.",
    science_ref: "Tong & Fu, Eur J Appl Physiol 2006 ; Wilson et al., 2014",
    unit_label: "Niveau 0-10",
    default_sets: 2,
    default_reps: 30,
    default_load: "Niveau 2",
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.0, exhale_s: 3.0, hold_out_s: 0.5 },
    stimulus_weight: 0.6,
    diaphragm_tax: 0.4,
    safety_flags: ["warmup_only"],
    guide: {
      setup:
        "Regler le PB Plus a ~40 % de la charge maximale (2 crans sous l'entrainement force).",
      execution: [
        "Realiser 2x30 cycles fluides avec 2 minutes de recuperation.",
        "Terminer avec une sensation d'aisance respiratoire et d'ouverture costale.",
      ],
      errors: [
        "Forcer l'intensite et entamer la reserve diaphragmatique avant le depart.",
      ],
      tempo_badge: "1.5 / 0 / 3 / 0.5",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "pb_plus_pyramid_strength",
    pole: "FORCE",
    category: CATEGORIES.IMT_STRENGTH,
    required_equipment: [EQUIPMENT_KEYS.PB_PLUS],
    name: "Pyramide Progressive PB Plus",
    short_desc:
      "Montee progressive de resistance sur 3 paliers de 10 cycles pour recruter les unites motrices a haut seuil.",
    science_ref: "Shei, Front Physiol 2018",
    unit_label: "Niveau 0-10",
    default_sets: 3,
    default_reps: 10,
    default_load: "Niveau 6",
    is_timed: false,
    pacer_pattern: { inhale_s: 1.8, hold_in_s: 0.5, exhale_s: 4.0, hold_out_s: 1.5 },
    stimulus_weight: 1.3,
    diaphragm_tax: 1.25,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Prevoir trois paliers croissants (+0.5 cran par serie, par ex. N4 -> N5 -> N6).",
      execution: [
        "Tenir 10 repetitions propres a chaque palier avec 2 minutes de repos complet.",
        "Maintenir une courte stabilisation de 0.5 s au sommet avant d'expirer.",
      ],
      errors: [
        "Perdre la verticalite lombaire sous charge maximale.",
      ],
      tempo_badge: "1.8 / 0.5 / 4 / 1.5",
      svg_type: "k5_pressure",
    },
  },

  // =========================================================================
  // 3. POWERBREATHE SMART ADAPTER (2 exercices)
  // =========================================================================
  {
    id: "smart_adapter_biofeedback_curve",
    pole: "PUISSANCE",
    category: CATEGORIES.IMT_SPEED_POWER,
    required_equipment: [EQUIPMENT_KEYS.PB_SMART_ADAPTER],
    name: "Biofeedback Courbe Smart Adapter",
    short_desc:
      "Entrainement guide par capteur pression-debit en temps reel visant la constance du volume et de l'energie par cycle.",
    science_ref: "Langer et al., Thorax 2018",
    unit_label: "cmH₂O",
    default_sets: 2,
    default_reps: 25,
    default_load: 65,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.2, exhale_s: 3.5, hold_out_s: 1.0 },
    stimulus_weight: 1.15,
    diaphragm_tax: 1.05,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Monter le Smart Adapter sur votre valve compatible et verifier le calibrage capteur.",
      execution: [
        "Viser une courbe de debit en cloche symetrique et reproductible sur chaque cycle.",
        "Atteindre le volume cible (> 80 % CV) a chaque repetition.",
      ],
      errors: [
        "Couper l'effort des que la valve claque sans finir l'amplitude pulmonaire.",
      ],
      tempo_badge: "1.5 / 0.2 / 3.5 / 1",
      svg_type: "k5_pressure",
    },
  },
  {
    id: "smart_adapter_paced_rme",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.PB_SMART_ADAPTER],
    name: "Endurance Cadencee Smart Adapter",
    short_desc:
      "Bloc d'endurance respiratoire sous contrainte de tempo avec suivi continu de la puissance moyenne.",
    science_ref: "Menzes et al., Arch Phys Med Rehabil 2016",
    unit_label: "cmH₂O",
    default_sets: 1,
    default_reps: 50,
    default_load: 45,
    is_timed: false,
    pacer_pattern: { inhale_s: 1.5, hold_in_s: 0.0, exhale_s: 2.5, hold_out_s: 0.5 },
    stimulus_weight: 1.05,
    diaphragm_tax: 1.0,
    safety_flags: ["stop_if_dizzy"],
    guide: {
      setup:
        "Regler la charge autour de 45 % MIP et suivre le metronome visuel.",
      execution: [
        "Conserver une puissance moyenne stable sur les 50 inspirations.",
        "Eviter toute pause prolongee entre l'expiration et l'inspiration suivante.",
      ],
      errors: [
        "Deriver en hyperventilation trop rapide (> 18 cycles/min).",
      ],
      tempo_badge: "1.5 / 0 / 2.5 / 0.5",
      svg_type: "k5_pressure",
    },
  },

  // =========================================================================
  // 4. POWERBREATHE EX1 EXPIRATOIRE (3 exercices)
  // =========================================================================
  {
    id: "ex1_strength_5x5",
    pole: "EXPIRATOIRE",
    category: CATEGORIES.EMT_EXPIRATORY,
    required_equipment: [EQUIPMENT_KEYS.PB_EX1],
    name: "EMT Force Expiratoire 5x5 (EX1)",
    short_desc:
      "5 series de 5 expirations maximales contre soupape reglable (70-75 % MEP) pour renforcer abdominaux et intercostaux internes.",
    science_ref: "Chiara et al., Arch Phys Med Rehabil 2006 ; Sapienza 2011",
    unit_label: "cmH₂O",
    default_sets: 5,
    default_reps: 5,
    default_load: 75,
    is_timed: false,
    pacer_pattern: { inhale_s: 2.0, hold_in_s: 0.5, exhale_s: 2.0, hold_out_s: 2.0 },
    stimulus_weight: 1.15,
    diaphragm_tax: 0.65,
    safety_flags: ["no_valsalva", "hypertension_caution", "stop_if_dizzy"],
    guide: {
      setup:
        "Regler l'EX1 Medic/LR autour de 70-75 % de la MEP. Pince-nez indispensable pour eviter les fuites velopharyngees.",
      execution: [
        "Inspirer profondement par le nez ou autour de l'embout.",
        "Maintenir les joues gainees (eventuellement soutenues par les doigts).",
        "Expirer de facon ferme et continue pour ouvrir la soupape pendant 1.5-2 s.",
      ],
      errors: [
        "Gonfler les joues sous la pression (perte d'efficacite et fatigue buccale).",
        "Bloquer le souffle sans flux d'air (manoeuvre de Valsalva).",
      ],
      tempo_badge: "2 / 0.5 / 2 / 2",
      svg_type: "ex1_expiratory",
    },
  },
  {
    id: "ex1_endurance_3x15",
    pole: "EXPIRATOIRE",
    category: CATEGORIES.EMT_EXPIRATORY,
    required_equipment: [EQUIPMENT_KEYS.PB_EX1],
    name: "EMT Endurance Expiratoire 3x15 (EX1)",
    short_desc:
      "Travail submaximal de la chaine expiratoire (50 % MEP) ameliorant le vidage pulmonaire dynamique a l'effort.",
    science_ref: "Suzuki et al., Chest 1995 ; Laciuga et al., 2014",
    unit_label: "cmH₂O",
    default_sets: 3,
    default_reps: 15,
    default_load: 50,
    is_timed: false,
    pacer_pattern: { inhale_s: 2.0, hold_in_s: 0.0, exhale_s: 2.5, hold_out_s: 1.5 },
    stimulus_weight: 0.95,
    diaphragm_tax: 0.55,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Positionner la charge de l'EX1 a 50 % MEP, posture assise ou debout stabilisee.",
      execution: [
        "Inspirer calmement a 80 % de la capacite vitale.",
        "Expirer regulierement contre la soupape jusqu'au bout du flux actif.",
      ],
      errors: [
        "Hyperventiler entre les repetitions.",
        "Flechir excessivement le tronc vers l'avant.",
      ],
      tempo_badge: "2 / 0 / 2.5 / 1.5",
      svg_type: "ex1_expiratory",
    },
  },
  {
    id: "ex1_trunk_brace_control",
    pole: "EXPIRATOIRE",
    category: CATEGORIES.EMT_EXPIRATORY,
    required_equipment: [EQUIPMENT_KEYS.PB_EX1],
    name: "Gainage Sous Pression Expiratoire (EX1)",
    short_desc:
      "Integration pression intra-abdominale et flux expiratoire controle pour stabiliser le caisson thoraco-lombaire.",
    science_ref: "Hodges & Gandevia, J Physiol 2000",
    unit_label: "cmH₂O",
    default_sets: 3,
    default_reps: 10,
    default_load: 60,
    is_timed: false,
    pacer_pattern: { inhale_s: 2.5, hold_in_s: 0.5, exhale_s: 3.0, hold_out_s: 1.5 },
    stimulus_weight: 0.9,
    diaphragm_tax: 0.6,
    safety_flags: ["no_valsalva"],
    guide: {
      setup:
        "Regler l'EX1 a 60 % MEP, mains sur les cotes laterales pour sentir le maintien.",
      execution: [
        "Inspirer a 360 degres avant de sceller l'embout.",
        "Expirer lentement sur 3 s tout en gardant la ceinture abdominale engagee vers l'interieur.",
      ],
      errors: [
        "Relacher brutalement le caisson en fin d'expiration.",
      ],
      tempo_badge: "2.5 / 0.5 / 3 / 1.5",
      svg_type: "ex1_expiratory",
    },
  },

  // =========================================================================
  // 5. ISOCAPNIC / RME (3 exercices)
  // =========================================================================
  {
    id: "isocapnic_rme_steady_15m",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.ISOCAPNIC],
    name: "Hyperpnée Normocapnique Continue (Isocapnic)",
    short_desc:
      "15 minutes d'hyperventilation ciblee en sac de rebreathing partiel maintenant la PaCO₂ physiologique sans vertige.",
    science_ref: "Boutellier & Piwko, Eur J Appl Physiol 1992 ; Markov 2001",
    unit_label: "L/min",
    default_sets: 1,
    default_reps: 900,
    default_load: 95,
    is_timed: true,
    pacer_pattern: { inhale_s: 1.0, hold_in_s: 0.0, exhale_s: 1.0, hold_out_s: 0.0 },
    stimulus_weight: 1.35,
    diaphragm_tax: 1.3,
    safety_flags: ["maintain_bag_volume", "stop_if_dizzy"],
    guide: {
      setup:
        "Ajuster la taille du sac Isocapnic a ~50-60 % de la capacite vitale et regler le tempo a 30 cycles/min.",
      execution: [
        "Vider et remplir integralement le sac a chaque cycle sur le rythme du pacer.",
        "L'air frais d'appoint maintient la normocapnie (pas d'hypocapnie).",
        "Rester attentif a la fluidite des deux phases sans forcer la glotte.",
      ],
      errors: [
        "Ne vider qu'une fraction du sac (baisse de l'efficacite RME).",
        "Depasser le tempo prescrit et perdre la coordination.",
      ],
      tempo_badge: "1 / 0 / 1 / 0",
      svg_type: "isocapnic_bag",
    },
  },
  {
    id: "isocapnic_rme_intervals_4x4",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.ISOCAPNIC],
    name: "Intervalles RME 4x4 min (Isocapnic)",
    short_desc:
      "4 blocs de 4 minutes a debit minute eleve (75-85 % MVV) avec 2 minutes de recuperation entre blocs.",
    science_ref: "Spengler et al., Eur J Appl Physiol 1999 ; Illi et al., 2012",
    unit_label: "L/min",
    default_sets: 4,
    default_reps: 240,
    default_load: 120,
    is_timed: true,
    pacer_pattern: { inhale_s: 0.85, hold_in_s: 0.0, exhale_s: 0.85, hold_out_s: 0.0 },
    stimulus_weight: 1.45,
    diaphragm_tax: 1.4,
    safety_flags: ["maintain_bag_volume", "stop_if_dizzy"],
    guide: {
      setup:
        "Sac calibre a 55 % CV, cadence reglee a ~35 cycles/min pour atteindre 75-85 % de la MVV.",
      execution: [
        "Maintenir le remplissage/vidage complet du sac pendant 4 minutes par bloc.",
        "Respirer calmement sans appareil durant les 2 minutes de recuperation.",
      ],
      errors: [
        "Surcharger la frequence des les 30 premieres secondes.",
      ],
      tempo_badge: "0.85 / 0 / 0.85 / 0",
      svg_type: "isocapnic_bag",
    },
  },
  {
    id: "isocapnic_warmup_priming",
    pole: "WARMUP",
    category: CATEGORIES.IMW_WARMUP,
    required_equipment: [EQUIPMENT_KEYS.ISOCAPNIC],
    name: "Priming Ventilatoire Isocapnique 6 min",
    short_desc:
      "Activation aerobie douce des muscles inspiratoires et expiratoires avant effort intense sans deplacer la PaCO₂.",
    science_ref: "Arend et al., Eur J Sport Sci 2015",
    unit_label: "L/min",
    default_sets: 1,
    default_reps: 360,
    default_load: 70,
    is_timed: true,
    pacer_pattern: { inhale_s: 1.25, hold_in_s: 0.0, exhale_s: 1.25, hold_out_s: 0.0 },
    stimulus_weight: 0.7,
    diaphragm_tax: 0.5,
    safety_flags: ["warmup_only", "maintain_bag_volume"],
    guide: {
      setup:
        "Regler une cadence moderee (~24 cycles/min) avec sac a 45-50 % CV.",
      execution: [
        "Respirer en continu pendant 6 minutes a effort perçu modere (RPE 4/10).",
      ],
      errors: [
        "Transformer le priming en seance d'epuisement RME.",
      ],
      tempo_badge: "1.25 / 0 / 1.25 / 0",
      svg_type: "isocapnic_bag",
    },
  },

  // =========================================================================
  // 6. AIROFIT MECANIQUE (3 exercices)
  // =========================================================================
  {
    id: "airofit_insp_strength_mech",
    pole: "FORCE",
    category: CATEGORIES.IMT_STRENGTH,
    required_equipment: [EQUIPMENT_KEYS.AIROFIT_MECH],
    name: "Airofit Force Inspiratoire (Molette A-F)",
    short_desc:
      "Entrainement a orifice restreint calibrable (molette inspiratoire D-F, expiratoire 1) pour recrutement diaphragmatique.",
    science_ref: "Enright et al., Phys Ther 2006 ; Airofit Mechanical Protocol",
    unit_label: "A-F / 1-6",
    default_sets: 3,
    default_reps: 20,
    default_load: "E / 1",
    is_timed: false,
    pacer_pattern: { inhale_s: 2.5, hold_in_s: 0.5, exhale_s: 3.0, hold_out_s: 1.0 },
    stimulus_weight: 1.0,
    diaphragm_tax: 0.95,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Positionner la roue inspiratoire sur D, E ou F selon votre niveau et la roue expiratoire sur 1 (libre).",
      execution: [
        "Inspirer regulierement pendant toute la fenetre de 2.5 s contre la restriction de debit.",
        "Expirer sans contrainte sur 3 s.",
      ],
      errors: [
        "Aspirer uniquement en fin de cycle ou fermer l'orifice avec la langue.",
      ],
      tempo_badge: "2.5 / 0.5 / 3 / 1",
      svg_type: "airofit_dual",
    },
  },
  {
    id: "airofit_dual_resistance_mech",
    pole: "EXPIRATOIRE",
    category: CATEGORIES.EMT_EXPIRATORY,
    required_equipment: [EQUIPMENT_KEYS.AIROFIT_MECH],
    name: "Airofit Double Resistance (Insp + Exp)",
    short_desc:
      "Charge combinee inspiratoire et expiratoire par orifices simultanes pour solliciter l'ensemble du caisson ventilatoire.",
    science_ref: "Wylegala et al., Eur J Appl Physiol 2007",
    unit_label: "A-F / 1-6",
    default_sets: 3,
    default_reps: 15,
    default_load: "D / 4",
    is_timed: false,
    pacer_pattern: { inhale_s: 2.5, hold_in_s: 0.5, exhale_s: 3.5, hold_out_s: 1.0 },
    stimulus_weight: 1.05,
    diaphragm_tax: 0.9,
    safety_flags: ["no_valsalva", "stop_if_dizzy"],
    guide: {
      setup:
        "Regler les deux molettes mecaniques (ex. D a l'inspiration, 4 a l'expiration).",
      execution: [
        "Maintenir un debit regulier dans les deux sens sans bloquer la glotte.",
        "Garder le menton neutre et les joues plaquees.",
      ],
      errors: [
        "Gonfler les joues lors de l'expiration resistee.",
      ],
      tempo_badge: "2.5 / 0.5 / 3.5 / 1",
      svg_type: "airofit_dual",
    },
  },
  {
    id: "airofit_vital_capacity_stretch",
    pole: "VAGAL_MOBILITE",
    category: CATEGORIES.VAGAL_MOBILITY,
    required_equipment: [EQUIPMENT_KEYS.AIROFIT_MECH],
    name: "Airofit Mobilite & Capacite Vitale",
    short_desc:
      "Inspirations lentes et profondes a faible resistance suivies d'apnees hautes courtes pour assouplir la cage thoracique.",
    science_ref: "Nield et al., J Cardiopulm Rehabil 2007",
    unit_label: "A-F / 1-6",
    default_sets: 2,
    default_reps: 10,
    default_load: "B / 2",
    is_timed: false,
    pacer_pattern: { inhale_s: 4.0, hold_in_s: 3.0, exhale_s: 5.0, hold_out_s: 1.0 },
    stimulus_weight: 0.45,
    diaphragm_tax: 0.3,
    safety_flags: ["gentle_stretch"],
    guide: {
      setup:
        "Reglage leger (B / 2) pour ralentir le flux sans creer de lutte musculaire excessive.",
      execution: [
        "Remplir de bas en haut : abdomen, cotes basses, puis clavicules sur 4 s.",
        "Tenir 3 s poitrine ouverte sans verrouiller la gorge, puis vider completement sur 5 s.",
      ],
      errors: [
        "Forcer l'apnee haute en contraction cervicale.",
      ],
      tempo_badge: "4 / 3 / 5 / 1",
      svg_type: "airofit_dual",
    },
  },

  // =========================================================================
  // 7. BANDES NASALES & MOUTH TAPE (2 exercices)
  // =========================================================================
  {
    id: "nasal_tape_z2_endurance",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.NASAL_MOUTH_TAPE],
    name: "Ventilation Nasale Calibree Zone 2",
    short_desc:
      "Maintien exclusif de la respiration nasale (dilatateur nasal + occlusion buccale douce) favorisant l'oxyde nitrique endogene.",
    science_ref: "Dallam et al., Int J Kinesiol Sports Sci 2018 ; Lundberg 1995",
    unit_label: "s",
    default_sets: 1,
    default_reps: 1200,
    default_load: "Nasal 100%",
    is_timed: true,
    pacer_pattern: { inhale_s: 3.0, hold_in_s: 0.0, exhale_s: 4.0, hold_out_s: 0.0 },
    stimulus_weight: 0.7,
    diaphragm_tax: 0.5,
    safety_flags: ["nasal_patency_required", "remove_tape_if_distress"],
    guide: {
      setup:
        "Poser la bande dilatatrice sur l'arête nasale (et bande buccale verticale legere si toleree en securite).",
      execution: [
        "Conserver une respiration nasale fluide et silencieuse pendant 20 min d'ergometre ou marche rapide.",
        "Ajuster l'allure mecanique pour ne jamais ressentir de soif d'air panique.",
      ],
      errors: [
        "Forcer en presence de congestion nasale ou d'obstruction septale.",
      ],
      tempo_badge: "3 / 0 / 4 / 0",
      svg_type: "nasal_flow",
    },
  },
  {
    id: "nasal_co2_cadence_walk",
    pole: "HYPOXIE_CO2",
    category: CATEGORIES.CO2_HYPOXIA,
    required_equipment: [EQUIPMENT_KEYS.NASAL_MOUTH_TAPE],
    name: "Desensibilisation CO₂ Nasale (Air Hunger)",
    short_desc:
      "Hypoventilation nasale douce visant a elever le seuil de tolerance au CO₂ et reduire la ventilation excessive.",
    science_ref: "Woorons et al., Eur J Appl Physiol 2008",
    unit_label: "cycles/min",
    default_sets: 3,
    default_reps: 240,
    default_load: 6,
    is_timed: true,
    pacer_pattern: { inhale_s: 3.0, hold_in_s: 0.0, exhale_s: 5.0, hold_out_s: 2.0 },
    stimulus_weight: 0.65,
    diaphragm_tax: 0.4,
    safety_flags: ["nasal_patency_required", "moderate_air_hunger_only"],
    guide: {
      setup:
        "Assis ou marche tres lente avec bande dilatatrice nasale pour stabiliser la valve nasale interne.",
      execution: [
        "Reduire le volume courant d'environ 15 % tout en suivant le rythme lent 3 / 0 / 5 / 2.",
        "Accepter une legere faim d'air stable sans crispation.",
      ],
      errors: [
        "Transformer l'exercice en apnee maximale douloureuse.",
      ],
      tempo_badge: "3 / 0 / 5 / 2",
      svg_type: "nasal_flow",
    },
  },

  // =========================================================================
  // 8. TYMEWEAR CEINTURE VENTILATOIRE (2 exercices)
  // =========================================================================
  {
    id: "tymewear_ve_sv1_lock",
    pole: "ENDURANCE",
    category: CATEGORIES.RME_ENDURANCE,
    required_equipment: [EQUIPMENT_KEYS.TYMEWEAR],
    name: "Verrouillage Ventilatoire Sous SV1 (TymeWear)",
    short_desc:
      "Pilotage en direct du debit minute (VE) et du volume courant (Vt) sous le premier seuil ventilatoire SV1.",
    science_ref: "Wasserman et al., Principles of Exercise Testing ; Nicolò et al., 2017",
    unit_label: "L/min",
    default_sets: 1,
    default_reps: 1500,
    default_load: 45,
    is_timed: true,
    pacer_pattern: { inhale_s: 2.0, hold_in_s: 0.0, exhale_s: 3.0, hold_out_s: 0.0 },
    stimulus_weight: 0.8,
    diaphragm_tax: 0.6,
    safety_flags: ["verify_strap_fit"],
    guide: {
      setup:
        "Positionner la sangle TymeWear sur le gril costal inferieur et verifier le signal Vt/Bf.",
      execution: [
        "Maintenir VE sous le plateau SV1 cible en privilegiant un Vt ample plutot qu'une Bf elevee.",
        "Controler toute derive de frequence respiratoire (tachypnee) en fin de bloc.",
      ],
      errors: [
        "Laisser la sangle glisser ou la serrer au point de limiter l'expansion costale.",
      ],
      tempo_badge: "2 / 0 / 3 / 0",
      svg_type: "tymewear_belt",
    },
  },
  {
    id: "tymewear_vt_bf_optimization",
    pole: "VAGAL_MOBILITE",
    category: CATEGORIES.VAGAL_MOBILITY,
    required_equipment: [EQUIPMENT_KEYS.TYMEWEAR],
    name: "Optimisation Ratio Vt / Bf (TymeWear)",
    short_desc:
      "Biofeedback d'expansion thoraco-abdominale augmentant le volume courant tout en abaissant l'espace mort anatomique.",
    science_ref: "Nicolò et al., Sports Med 2020",
    unit_label: "cycles/min",
    default_sets: 2,
    default_reps: 300,
    default_load: 8,
    is_timed: true,
    pacer_pattern: { inhale_s: 3.0, hold_in_s: 0.5, exhale_s: 4.0, hold_out_s: 0.0 },
    stimulus_weight: 0.45,
    diaphragm_tax: 0.3,
    safety_flags: ["verify_strap_fit"],
    guide: {
      setup:
        "Allonge ou assis face a la lecture Vt / Bf de la ceinture TymeWear.",
      execution: [
        "Maximiser l'amplitude d'ecartement de la sangle sur 3 s d'inspiration.",
        "Viser une frequence de 8 cycles/min avec expiration relachee.",
      ],
      errors: [
        "Respiration haute thoracique donnant une faible excursion du capteur.",
      ],
      tempo_badge: "3 / 0.5 / 4 / 0",
      svg_type: "tymewear_belt",
    },
  },

  // =========================================================================
  // 9. OXYMETRE SPO2 (2 exercices)
  // =========================================================================
  {
    id: "spo2_co2_table_apnea",
    pole: "HYPOXIE_CO2",
    category: CATEGORIES.CO2_HYPOXIA,
    required_equipment: [EQUIPMENT_KEYS.SPO2_OXIMETER],
    name: "Table CO₂ Sous Monitoring SpO₂",
    short_desc:
      "Apnees statiques a temps fixe avec recuperations decroissantes sous controle continu SpO₂ (plancher strict >= 88 %).",
    science_ref: "Schagatay, Respir Physiol Neurobiol 2010 ; Bain et al., 2018",
    unit_label: "s",
    default_sets: 6,
    default_reps: 1,
    default_load: 45,
    is_timed: true,
    pacer_pattern: { inhale_s: 4.0, hold_in_s: 45.0, exhale_s: 4.0, hold_out_s: 0.0 },
    stimulus_weight: 0.9,
    diaphragm_tax: 0.55,
    safety_flags: ["spo2_floor_88", "seated_or_supine_only", "never_in_water"],
    guide: {
      setup:
        "Strictement assis ou allonge hors de l'eau, oxymetre SpO₂ stabilise au doigt (mains chaudes).",
      execution: [
        "Prendre une inspiration confortable (pas de sur-ventilation prealable).",
        "Tenir l'apnee cible en relachant completement les epaules et la machoire.",
        "Interrompre immediatement si SpO₂ descend sous 88 % ou apparition de vertiges.",
      ],
      errors: [
        "Hyperventiler avant l'apnee (masque le signal d'alarme CO₂).",
        "Pratiquer debout ou en milieu aquatique sans surveillance.",
      ],
      tempo_badge: "4 / 45 / 4 / 0",
      svg_type: "spo2_apnea",
    },
  },
  {
    id: "spo2_walking_expiratory_hold",
    pole: "HYPOXIE_CO2",
    category: CATEGORIES.CO2_HYPOXIA,
    required_equipment: [EQUIPMENT_KEYS.SPO2_OXIMETER],
    name: "Apnee Expiratoire en Marche (SpO₂)",
    short_desc:
      "Courtes apnees apres expiration normale pendant une marche lente, validees par reprise nasale calme et plancher SpO₂ >= 88 %.",
    science_ref: "Lemaître et al., Med Sci Sports Exerc 2009",
    unit_label: "s",
    default_sets: 5,
    default_reps: 1,
    default_load: 20,
    is_timed: true,
    pacer_pattern: { inhale_s: 2.0, hold_in_s: 0.0, exhale_s: 3.0, hold_out_s: 20.0 },
    stimulus_weight: 0.85,
    diaphragm_tax: 0.5,
    safety_flags: ["spo2_floor_88", "calm_recovery_check", "stop_if_dizzy"],
    guide: {
      setup:
        "Oxymetre en place sur terrain plat degage, respiration nasale calme de base.",
      execution: [
        "Expirer passivement (FRC), pincer le nez et marcher a allure lente.",
        "Reprendre l'inspiration par le nez de maniere controlee (max 2 respirations profondes pour recuperer).",
        "Respecter le plancher SpO₂ >= 88 % et 60 s de marche nasale entre series.",
      ],
      errors: [
        "Haleter par la bouche a la rupture de l'apnee (signe d'exces de duree).",
      ],
      tempo_badge: "2 / 0 / 3 / 20",
      svg_type: "spo2_apnea",
    },
  },

  // =========================================================================
  // 10. SANS MATERIEL / BODYWEIGHT (2 exercices)
  // =========================================================================
  {
    id: "vagal_resonance_01hz",
    pole: "VAGAL_MOBILITE",
    category: CATEGORIES.VAGAL_MOBILITY,
    required_equipment: [],
    name: "Resonance Vagale 0,1 Hz (5s / 5s)",
    short_desc:
      "Synchronisation cardio-respiratoire a 6 cycles/min maximisant l'arythmie sinusale respiratoire (HRV / tonus vagal).",
    science_ref: "Lehrer & Gevirtz, Front Psychol 2014 ; Vaschillo et al., 2006",
    unit_label: "cycles/min",
    default_sets: 1,
    default_reps: 600,
    default_load: 6,
    is_timed: true,
    pacer_pattern: { inhale_s: 5.0, hold_in_s: 0.0, exhale_s: 5.0, hold_out_s: 0.0 },
    stimulus_weight: 0.25,
    diaphragm_tax: 0.1,
    safety_flags: ["gentle_nasal_only"],
    guide: {
      setup:
        "Assis dos detendu ou allonge, epaules basses, machoire desserree.",
      execution: [
        "Inspirer doucement par le nez sur 5 s en laissant le ventre et les flancs s'ouvrir.",
        "Expirer sans pousser sur 5 s jusqu'a la detente naturelle.",
        "Maintenir un flux faible et silencieux pour eviter l'hyperventilation.",
      ],
      errors: [
        "Prendre de trop grands volumes causant des picotements.",
      ],
      tempo_badge: "5 / 0 / 5 / 0",
      svg_type: "vagal_wave",
    },
  },
  {
    id: "diaphragm_360_croc_release",
    pole: "VAGAL_MOBILITE",
    category: CATEGORIES.VAGAL_MOBILITY,
    required_equipment: [],
    name: "Expansion Diaphragmatique 360° & Relachement",
    short_desc:
      "Mobilite costale circonferentielle (position crocodile ou 90/90) avec expiration prolongee abaissant la zone d'apposition.",
    science_ref: "Kolar et al., J Orthop Sports Phys Ther 2012",
    unit_label: "cycles/min",
    default_sets: 3,
    default_reps: 8,
    default_load: "Poids corps",
    is_timed: false,
    pacer_pattern: { inhale_s: 4.0, hold_in_s: 2.0, exhale_s: 8.0, hold_out_s: 2.0 },
    stimulus_weight: 0.3,
    diaphragm_tax: 0.15,
    safety_flags: ["gentle_stretch"],
    guide: {
      setup:
        "Allonge sur le dos jambes a 90/90 sur une chaise (ou a plat ventre en crocodile), mains sur les cotes basses.",
      execution: [
        "Inspirer par le nez sur 4 s en poussant lateralement et posterieurement contre les mains.",
        "Stabiliser 2 s sans bloquer la gorge, puis expirer lentement levres pincees sur 8 s pour abaisser les cotes.",
        "Marquer une pause relachee de 2 s poumons vides avant le cycle suivant.",
      ],
      errors: [
        "Cambrer la colonne lombaire a l'inspiration.",
        "Soulever le sternum vers le menton.",
      ],
      tempo_badge: "4 / 2 / 8 / 2",
      svg_type: "diaphragm_360",
    },
  },
];

export const CATALOG = deepFreeze(RAW_CATALOG);

const catalogByIdMap = {};
for (const exercise of CATALOG) {
  catalogByIdMap[exercise.id] = exercise;
}
export const CATALOG_BY_ID = Object.freeze(catalogByIdMap);

export const EXERCISE_IDS = Object.freeze(CATALOG.map((ex) => ex.id));

/**
 * Retourne un exercice du catalogue par son identifiant exact, ou null.
 * @param {string} id
 * @returns {typeof CATALOG[number] | null}
 */
export function getCatalogExercise(id) {
  if (typeof id !== "string" || !id) {
    return null;
  }
  return Object.hasOwn(CATALOG_BY_ID, id) ? CATALOG_BY_ID[id] : null;
}

/**
 * Retourne la liste complete immuable des exercices du catalogue.
 * @returns {readonly typeof CATALOG[number][]}
 */
export function getAllCatalogExercises() {
  return CATALOG;
}

/**
 * Filtre les exercices selon les equipements actives dans le profil utilisateur.
 * Les exercices sans materiel (`required_equipment: []` ou `BODYWEIGHT`) restent toujours disponibles.
 * @param {Record<string, unknown> | null | undefined} profile
 * @param {readonly typeof CATALOG[number][]} [exercises]
 * @returns {typeof CATALOG[number][]}
 */
export function filterExercisesByEquipment(profile, exercises = CATALOG) {
  const normalized = normalizeEquipmentProfile(profile);
  const source = Array.isArray(exercises) ? exercises : CATALOG;
  return source.filter((exercise) => {
    const reqs = Array.isArray(exercise?.required_equipment)
      ? exercise.required_equipment
      : [];
    return reqs.every((key) => key === BODYWEIGHT || normalized[key] === true);
  });
}
