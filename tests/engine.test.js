import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionMarkdownAndPayload,
  computeSessionMetrics,
  formatExternalId,
  mapDyspneaToFeeling,
  parseTelemetryJsonFromDescription,
} from "../engine.js";
import {
  GATEKEEPER_MODES,
  enforceSymbolicConstraints,
  generateFallbackSession,
  resolveGatekeeperState,
} from "../fallbackGenerator.js";
import { CATEGORIES, getCatalogExercise } from "../catalog.js";
import { CMH2O_L_TO_JOULES } from "../k5Parser.js";
import {
  VAULT_KEY,
  importVaultJson,
  loadVault,
  resetVault,
  saveVault,
} from "../vault.js";
import { buildFreeSessionPlan, parseMarkdownOffline } from "../mdParser.js";

const ORIGINAL_LOCAL_STORAGE_DESC = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);

/**
 * Crée un stockage local en mémoire simulant l'API Web Storage du navigateur.
 * @param {Record<string, string>} [initialEntries]
 */
function createMockStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    _dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

function restoreLocalStorage() {
  if (ORIGINAL_LOCAL_STORAGE_DESC) {
    Object.defineProperty(globalThis, "localStorage", ORIGINAL_LOCAL_STORAGE_DESC);
  } else {
    delete globalThis.localStorage;
  }
}

afterEach(() => {
  restoreLocalStorage();
});

describe("engine.js — computeSessionMetrics", () => {
  it("calcule de façon déterministe le travail mécanique estimé, le strain, la compliance et la charge Intervals", () => {
    const metrics = computeSessionMetrics({
      s_index_cmh2o: 111,
      mep_cmh2o: 120,
      borg_rpe: 7,
      exercises: [
        {
          id: "k5_imt_30rm_hypertrophy",
          block: 2,
          sets: 2,
          reps: 30,
          load: 80,
          completion: 1,
        },
      ],
    });

    // 2 * 30 * 80 cmH2O * 2.5 L * 0.0980665 = 1176.798 J -> 1176.8
    const expectedWork = Math.round(2 * 30 * 80 * 2.5 * CMH2O_L_TO_JOULES * 10) / 10;
    // Strain = 2 * 30 * 0.6 * (80 / 111) * 1.25 * 1.2 = 38.9189... -> 38.9
    const expectedStrain =
      Math.round(2 * 30 * 0.6 * (80 / 111) * 1.25 * 1.2 * 10) / 10;
    // Durée cycle K5 30RM = 1.5 + 0.2 + 3.5 + 1.0 = 6.2s => 60 * 6.2 = 372s
    const expectedDuration = 372;
    const expectedLoad = Math.max(
      1,
      Math.round(expectedStrain * 0.45 + (expectedDuration / 60) * 0.8)
    );

    assert.equal(metrics.respWorkJ, expectedWork);
    assert.equal(metrics.respiratoryStrain, expectedStrain);
    assert.equal(metrics.effectiveDurationSec, expectedDuration);
    assert.equal(metrics.compliancePct, 100);
    assert.equal(metrics.intervalsLoad, expectedLoad);
    assert.equal(metrics.strainZone, "GREEN");
    assert.equal(metrics.feeling, 3);
    assert.deepEqual(metrics.safetyAlerts, []);
  });

  it("donne la priorité au travail K5 réel (séance une seule fois, exercice prioritaire) et met à jour sIndexCmh2o", () => {
    const metrics = computeSessionMetrics({
      s_index_cmh2o: 111,
      borg_rpe: 6,
      k5_summary: {
        totalWorkJ: 498.38,
        sIndexEstimate: 182.1,
      },
      exercises: [
        {
          id: "k5_imt_30rm_hypertrophy",
          sets: 2,
          reps: 30,
          load: 80,
          completion: 1,
        },
        {
          id: "pb_plus_classic_30rm",
          sets: 2,
          reps: 30,
          load: "Niveau 5",
          completion: 0.5,
        },
      ],
    });

    // Le 1er exercice K5 consomme session.k5_summary.totalWorkJ (498.38 J),
    // le 2e (PB Plus mécanique Niv 5 = 50 cmH2O eq) utilise l'estimation à 50 % completion.
    const secondExWork = 2 * 0.5 * 30 * 50 * 2.5 * CMH2O_L_TO_JOULES;
    const expectedTotalWork = Math.round((498.38 + secondExWork) * 10) / 10;

    assert.equal(metrics.exerciseBreakdown[0].workJ, 498.4);
    assert.equal(metrics.exerciseBreakdown[1].workJ, Math.round(secondExWork * 10) / 10);
    assert.equal(metrics.respWorkJ, expectedTotalWork);
    assert.equal(metrics.sIndexCmh2o, 182.1);
    // Compliance pondérée par sets * diaphragm_tax : (1*2*1.2 + 0.5*2*1.15) / (2*1.2 + 2*1.15) = 3.55 / 4.7 => 76 %
    assert.equal(metrics.compliancePct, 76);

    // Surcharge explicite au niveau exercice pondérée par completion
    const perExMetrics = computeSessionMetrics({
      exercises: [
        {
          id: "k5_imt_30rm_hypertrophy",
          sets: 2,
          reps: 30,
          load: 80,
          completion: 0.5,
          k5_summary: { totalWorkJ: 498.38 },
        },
      ],
    });
    assert.equal(perExMetrics.respWorkJ, 249.2);
  });

  it("déclenche une alerte CRITICAL SPO2_CRITICAL si spo2_min < 88 et respecte les seuils", () => {
    const critical = computeSessionMetrics({
      spo2_min: 87,
      exercises: [{ id: "spo2_co2_table_apnea", sets: 4, reps: 1, load: 45, completion: 1 }],
    });
    const critAlert = critical.safetyAlerts.find((a) => a.code === "SPO2_CRITICAL");
    assert.ok(critAlert);
    assert.equal(critAlert.level, "CRITICAL");

    // Borne exacte 88 % : pas critique, bascule en WARNING SPO2_LOW
    const borderline = computeSessionMetrics({
      spo2_min: 88,
      exercises: [{ id: "spo2_co2_table_apnea", sets: 4, reps: 1, load: 45, completion: 1 }],
    });
    assert.equal(
      borderline.safetyAlerts.some((a) => a.code === "SPO2_CRITICAL"),
      false
    );
    const lowAlert = borderline.safetyAlerts.find((a) => a.code === "SPO2_LOW");
    assert.ok(lowAlert);
    assert.equal(lowAlert.level, "WARNING");

    // SpO2 normale (>= 92) : aucune alerte SpO2
    const safe = computeSessionMetrics({
      spo2_min: 92,
      exercises: [{ id: "vagal_resonance_01hz", sets: 1, reps: 300, load: 6, completion: 1 }],
    });
    assert.equal(safe.safetyAlerts.length, 0);
  });

  it("gère les zones de strain RED/ORANGE, alertes métaboréflexe/dyspnée/BOLT et valeurs NaN/nulles", () => {
    const redSession = computeSessionMetrics({
      s_index_cmh2o: 100,
      borg_rpe: 10,
      bolt_sec: 12,
      pre_intense_session: true,
      exercises: [
        { id: "k5_imt_30rm_hypertrophy", sets: 5, reps: 30, load: 110, completion: 1 },
      ],
    });

    assert.equal(redSession.strainZone, "RED");
    assert.ok(redSession.respiratoryStrain > 85);
    assert.equal(redSession.feeling, 5);
    assert.ok(
      redSession.safetyAlerts.some(
        (a) => a.code === "PRE_INTENSE_METABOREFLEX_RISK" && a.level === "CRITICAL"
      )
    );
    assert.ok(redSession.safetyAlerts.some((a) => a.code === "DYSPNEA_HIGH"));
    assert.ok(redSession.safetyAlerts.some((a) => a.code === "LOW_BOLT_SCORE"));

    // Robustesse sur NaN, Infinity et séance vide
    const edge = computeSessionMetrics({
      s_index_cmh2o: Number.NaN,
      mep_cmh2o: Number.POSITIVE_INFINITY,
      spo2_min: Number.NaN,
      bolt_sec: Number.POSITIVE_INFINITY,
      borg_rpe: Number.NaN,
      exercises: [null, undefined],
    });
    assert.equal(edge.respWorkJ, 0);
    assert.equal(edge.respiratoryStrain, 0);
    assert.equal(edge.compliancePct, 0);
    assert.equal(edge.intervalsLoad, 1);
    assert.equal(edge.spo2Min, null);
    assert.equal(edge.boltSec, null);
    assert.equal(edge.feeling, mapDyspneaToFeeling(5));
  });
});

describe("fallbackGenerator.js — garde-fous symboliques & matériel", () => {
  const BLOCKED_HEAVY_CATEGORIES = new Set([
    CATEGORIES.IMT_STRENGTH,
    CATEGORIES.RME_ENDURANCE,
    CATEGORIES.EMT_EXPIRATORY,
    CATEGORIES.CO2_HYPOXIA,
  ]);

  const riskyDraftPlan = {
    theme: "Plan agressif LLM",
    rationale: "Force maximale + hyperpnée",
    recommended_rpe: 9,
    target_duration_sec: 1800,
    exercises: [
      { id: "k5_imt_30rm_hypertrophy", block: 2, sets: 4, reps: 30, load: 95 },
      { id: "isocapnic_rme_intervals_4x4", block: 2, sets: 4, reps: 240, load: 130 },
      { id: "k5_endurance_power_drift", block: 2, sets: 2, reps: 60, load: 80 },
    ],
  };

  for (const [label, context, expectedRule] of [
    [
      'tomorrowBikeLoad === "SEUIL_VO2_MAX"',
      { tomorrowBikeLoad: "SEUIL_VO2_MAX", sIndex: 111 },
      "BLOCAGE_VO2MAX_J_PLUS_1",
    ],
    ["tsb < -25", { tsb: -26, sIndex: 111 }, "BLOCAGE_TSB_CRITIQUE"],
    ["hrv_ratio < 0.75", { hrv_ratio: 0.74, sIndex: 111 }, "BLOCAGE_HRV_BASSE"],
    ["hrv_pct < 75 (%)", { hrv_pct: 72, sIndex: 111 }, "BLOCAGE_HRV_BASSE"],
  ]) {
    it(`bloque strictement IMT lourd (>55 % S-Index) et endurance épuisante lorsque ${label}`, () => {
      const constrained = enforceSymbolicConstraints(riskyDraftPlan, context);
      const fallback = generateFallbackSession(context);

      for (const result of [constrained, fallback]) {
        assert.equal(result.mode, GATEKEEPER_MODES.SEUIL_VO2_MAX);
        assert.ok(result.applied_rules.includes(expectedRule));
        assert.ok(result.recommended_rpe <= 4);
        assert.ok(result.exercises.length >= 1);

        for (const ex of result.exercises) {
          assert.equal(
            BLOCKED_HEAVY_CATEGORIES.has(ex.category),
            false,
            `Catégorie interdite détectée : ${ex.category} (${ex.id})`
          );
          if (ex.unit_label === "cmH₂O" && typeof ex.load === "number") {
            assert.ok(
              ex.load <= Math.round(111 * 0.55),
              `Charge excessive ${ex.load} cmH2O > 55 % S-Index`
            );
          }
        }
      }
    });
  }

  it("ne déclenche pas le blocage critique aux bornes exactes tsb === -25 et hrv_ratio === 0.75", () => {
    const stateAtBoundary = resolveGatekeeperState({
      tsb: -25,
      hrv_ratio: 0.75,
      tomorrowBikeLoad: "REPOS_Z1_Z2",
    });
    assert.equal(stateAtBoundary.isFatigueBlocked, false);
    assert.equal(stateAtBoundary.isSeuilBlocked, false);
    assert.equal(stateAtBoundary.mode, GATEKEEPER_MODES.REPOS_Z1_Z2);
  });

  it("applique le protocole PRE_RACE_IMW à 40 % du S-Index (Volianitis 2001)", () => {
    const sIndex = 110;
    const expectedImwLoad = Math.round(sIndex * 0.4); // 44 cmH2O

    const fallback = generateFallbackSession({
      gatekeeperMode: GATEKEEPER_MODES.PRE_RACE_IMW,
      sIndex,
    });
    assert.equal(fallback.mode, GATEKEEPER_MODES.PRE_RACE_IMW);
    assert.ok(fallback.applied_rules.includes("PROTOCOLE_IMW_VOLIANITIS_2001"));

    const k5Warmup = fallback.exercises.find((e) => e.id === "k5_staircase_warmup");
    assert.ok(k5Warmup);
    assert.equal(k5Warmup.sets, 2);
    assert.equal(k5Warmup.reps, 30);
    assert.equal(k5Warmup.load, expectedImwLoad);

    // Plafonnement strict d'un plan brut qui tenterait 85 cmH2O et de l'IMT lourd
    const constrained = enforceSymbolicConstraints(
      {
        exercises: [
          { id: "k5_staircase_warmup", block: 1, sets: 4, reps: 30, load: 85 },
          { id: "k5_imt_30rm_hypertrophy", block: 2, sets: 2, reps: 30, load: 90 },
        ],
      },
      { preRace: true, sIndex }
    );
    const cappedWarmup = constrained.exercises.find(
      (e) => e.id === "k5_staircase_warmup"
    );
    assert.ok(cappedWarmup);
    assert.equal(cappedWarmup.load, expectedImwLoad);
    assert.equal(cappedWarmup.sets, 2);
    assert.equal(
      constrained.exercises.some((e) => e.category === CATEGORIES.IMT_STRENGTH),
      false
    );
  });

  it("filtre strictement les exercices K5 lorsque PB_K5 est false et bascule sur PB Plus / Airofit", () => {
    const noK5WithPbPlus = {
      PB_K5: false,
      PB_PLUS: true,
      AIROFIT_MECH: true,
      PB_EX1: true,
      ISOCAPNIC: true,
    };

    const fallbackPbPlus = generateFallbackSession({
      gatekeeperMode: GATEKEEPER_MODES.REPOS_Z1_Z2,
      equipmentProfile: noK5WithPbPlus,
    });
    assert.ok(fallbackPbPlus.exercises.length >= 2);
    for (const ex of fallbackPbPlus.exercises) {
      const cat = getCatalogExercise(ex.id);
      assert.equal(cat.required_equipment.includes("PB_K5"), false);
      assert.equal(ex.id.startsWith("k5_"), false);
    }
    assert.ok(fallbackPbPlus.exercises.some((e) => e.id === "pb_plus_classic_30rm"));

    // Si PB_K5 et PB_PLUS sont désactivés, bascule vers Airofit
    const onlyAirofit = {
      PB_K5: false,
      PB_PLUS: false,
      PB_SMART_ADAPTER: false,
      PB_EX1: false,
      ISOCAPNIC: false,
      AIROFIT_MECH: true,
      NASAL_MOUTH_TAPE: true,
      TYMEWEAR: false,
      SPO2_OXIMETER: false,
    };
    const constrainedAirofit = enforceSymbolicConstraints(
      {
        exercises: [
          { id: "k5_imt_30rm_hypertrophy", sets: 2, reps: 30, load: 80 },
          { id: "k5_speed_power_40mip", sets: 3, reps: 15, load: 45 },
        ],
      },
      { gatekeeperMode: GATEKEEPER_MODES.REPOS_Z1_Z2, equipmentProfile: onlyAirofit }
    );
    for (const ex of constrainedAirofit.exercises) {
      assert.equal(ex.id.startsWith("k5_"), false);
      assert.equal(ex.id.startsWith("pb_plus_"), false);
    }
    assert.ok(
      constrainedAirofit.exercises.some((e) => e.id.startsWith("airofit_"))
    );
  });
});

describe("vault.js — préservation des clés tierces dans GLOBAL_ATHLETE_VAULT_V1", () => {
  it("préserve EQUIPMENT_PROFILE, CP_WATTS et W_PRIME_J lors de saveVault et resetVault (localStorage mocké)", () => {
    const thirdPartyData = {
      EQUIPMENT_PROFILE: { KETTLEBELL: true, DUMBBELL: true, BARBELL: false },
      CP_WATTS: 325,
      W_PRIME_J: 21500,
      WEBSTRENGTH_NOTES: "Ne pas ecraser",
      INTERVALS_ATHLETE_ID: "i99999",
    };
    const mockStorage = createMockStorage({
      [VAULT_KEY]: JSON.stringify(thirdPartyData),
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      configurable: true,
      writable: true,
    });

    const saved = saveVault({
      BREATH_S_INDEX_CMH2O: 132,
      BREATH_EQUIPMENT_PROFILE: { PB_K5: false, PB_PLUS: true },
      INTERVALS_API_KEY: "fake-intervals-token-test",
    });

    assert.equal(saved.BREATH_S_INDEX_CMH2O, 132);
    assert.equal(saved.BREATH_EQUIPMENT_PROFILE.PB_K5, false);
    assert.deepEqual(saved.EQUIPMENT_PROFILE, thirdPartyData.EQUIPMENT_PROFILE);
    assert.equal(saved.CP_WATTS, 325);
    assert.equal(saved.W_PRIME_J, 21500);
    assert.equal(saved.WEBSTRENGTH_NOTES, "Ne pas ecraser");

    const loaded = loadVault();
    assert.deepEqual(loaded.EQUIPMENT_PROFILE, thirdPartyData.EQUIPMENT_PROFILE);
    assert.equal(loaded.CP_WATTS, 325);
    assert.equal(loaded.W_PRIME_J, 21500);

    const rawStored = JSON.parse(mockStorage.getItem(VAULT_KEY));
    assert.equal(rawStored.CP_WATTS, 325);
    assert.equal(rawStored.W_PRIME_J, 21500);
    assert.deepEqual(rawStored.EQUIPMENT_PROFILE, thirdPartyData.EQUIPMENT_PROFILE);

    // resetVault réinitialise WebBreath mais conserve les clés tierces
    const afterReset = resetVault();
    assert.equal(afterReset.BREATH_S_INDEX_CMH2O, 111);
    assert.equal(afterReset.BREATH_EQUIPMENT_PROFILE.PB_K5, true);
    assert.equal(afterReset.CP_WATTS, 325);
    assert.equal(afterReset.W_PRIME_J, 21500);
    assert.deepEqual(
      afterReset.EQUIPMENT_PROFILE,
      thirdPartyData.EQUIPMENT_PROFILE
    );
  });

  it("préserve les clés tierces en repli mémoire (Node sans localStorage) et neutralise la pollution de prototype", () => {
    const imported = importVaultJson(
      JSON.stringify({
        EQUIPMENT_PROFILE: { ROWER: true },
        CP_WATTS: 295,
        W_PRIME_J: 18500,
        __proto__: { polluted: true },
      })
    );
    assert.equal({}.polluted, undefined);
    assert.equal(imported.CP_WATTS, 295);
    assert.equal(imported.W_PRIME_J, 18500);

    const updated = saveVault({ BREATH_BOLT_SEC: 42 });
    assert.equal(updated.BREATH_BOLT_SEC, 42);
    assert.equal(updated.CP_WATTS, 295);
    assert.equal(updated.W_PRIME_J, 18500);
    assert.deepEqual(updated.EQUIPMENT_PROFILE, { ROWER: true });
  });
});

describe("engine.js — round-trip buildSessionMarkdownAndPayload -> parseTelemetryJsonFromDescription", () => {
  it("produit un Markdown + payload Intervals.icu et restitue exactement telemetryJson à l'extraction", () => {
    const sessionDate = new Date(2026, 10, 25, 9, 30, 0);
    const session = {
      dateObj: sessionDate,
      theme: "Activation IMW & Vagale",
      rationale: "Contrôle pré-effort <b>sans</b> métaboréflexe",
      notes: "Sensations fluides sur le K5.",
      s_index_cmh2o: 111,
      mep_cmh2o: 120,
      bolt_sec: 14,
      spo2_min: 87,
      borg_rpe: 6,
      exercises: [
        { id: "k5_staircase_warmup", block: 1, sets: 2, reps: 30, load: 44, completion: 1 },
        { id: "vagal_resonance_01hz", block: 3, sets: 1, reps: 300, load: 6, completion: 1 },
      ],
    };

    const { markdown, payload, telemetryJson } = buildSessionMarkdownAndPayload(session);
    assert.equal(payload.external_id, formatExternalId(sessionDate));
    assert.equal(payload.description, markdown);
    assert.equal(payload.RespWorkJ, telemetryJson.resp_work_j);
    assert.equal(payload.RespStrainIndex, telemetryJson.respiratory_strain);
    assert.equal(payload.RespSIndex, telemetryJson.s_index_cmh2o);
    assert.equal(payload.RespBoltSec, 14);
    assert.ok(markdown.includes("[TELEMETRY_JSON]"));
    assert.ok(markdown.includes("[/TELEMETRY_JSON]"));
    assert.equal(markdown.includes("<b>"), false);

    const extracted = parseTelemetryJsonFromDescription(payload.description);
    assert.deepEqual(extracted, telemetryJson);

    // Repli sans balise fermante et gestion des entrées corrompues
    const fallbackLine = parseTelemetryJsonFromDescription(
      "Texte\n[TELEMETRY_JSON] {\"schema_v\":1,\"app\":\"webbreath\"}"
    );
    assert.deepEqual(fallbackLine, { schema_v: 1, app: "webbreath" });
    assert.equal(parseTelemetryJsonFromDescription(""), null);
    assert.equal(parseTelemetryJsonFromDescription(null), null);
    assert.equal(
      parseTelemetryJsonFromDescription("[TELEMETRY_JSON] {invalide [/TELEMETRY_JSON]"),
      null
    );
  });
});

describe("mdParser.js — parseMarkdownOffline & buildFreeSessionPlan", () => {
  it("parse un tableau et des listes Markdown hors-ligne avec résolution catalogue et filtrage matériel", () => {
    const md = `
# Séance Mixte Perso <script>alert(1)</script>
| Bloc | Exercice | Charge | Séries×Reps |
| :--- | :--- | :--- | :--- |
| B2 | IMT Force 30RM K5 | 75 cmH2O | 2×30 |
| B3 | Résonance Vagale 0,1 Hz | 6 cycles/min | 10 min |
- Exercice Custom Diaphragme 3x12 @ 35 cmH2O
`;

    const planDefault = parseMarkdownOffline(md);
    assert.equal(planDefault.mode, "MODE_LIBRE");
    assert.equal(planDefault.is_free_mode, true);
    assert.equal(planDefault.theme.includes("<script>"), false);
    assert.equal(planDefault.exercises.length, 3);

    assert.equal(planDefault.exercises[0].id, "k5_imt_30rm_hypertrophy");
    assert.equal(planDefault.exercises[0].load, 75);
    assert.equal(planDefault.exercises[0].sets, 2);
    assert.equal(planDefault.exercises[0].reps, 30);

    assert.equal(planDefault.exercises[1].id, "vagal_resonance_01hz");
    assert.equal(planDefault.exercises[1].reps, 600);
    assert.equal(planDefault.exercises[1].is_timed, true);

    assert.equal(planDefault.exercises[2].is_custom, true);
    assert.equal(planDefault.exercises[2].sets, 3);
    assert.equal(planDefault.exercises[2].reps, 12);

    // Filtrage PB_K5: false -> substitution vers PB Plus
    const planNoK5 = parseMarkdownOffline(md, { PB_K5: false, PB_PLUS: true });
    assert.equal(
      planNoK5.exercises.some((e) => e.id.startsWith("k5_")),
      false
    );
    assert.equal(planNoK5.exercises[0].id, "pb_plus_classic_30rm");
    assert.equal(planNoK5.exercises[0].is_custom, true);
    assert.ok(planNoK5.exercises[0].custom_label.includes("(substitué)"));
  });

  it("rejette les Markdown vides ou sans exercices et normalise buildFreeSessionPlan", () => {
    assert.throws(() => parseMarkdownOffline(""), /Aucun exercice reconnu/);
    assert.throws(() => parseMarkdownOffline("# Titre seul\nTexte libre"), /Aucun exercice reconnu/);
    assert.throws(() => buildFreeSessionPlan([]), /Aucun exercice valide/);

    const plan = buildFreeSessionPlan({
      title: "  Séance | Libre <b>Test</b> ",
      sourceLabel: "Import Manuel",
      rationale: "Travail ciblé <i>endurance</i>",
      exercises: [
        { id: "pb_plus_classic_30rm", sets: 99, reps: 200, load: "Niveau 5", block: 2 },
        { id: "inconnu_id", sets: 0, reps: 5000, load: 12, custom_label: "Mon Bloc|Custom" },
      ],
    });

    assert.equal(plan.mode, "MODE_LIBRE");
    assert.equal(plan.gatekeeper_mode, "MODE_LIBRE");
    assert.equal(plan.is_free_mode, true);
    assert.deepEqual(plan.applied_rules, ["MODE_LIBRE"]);
    assert.equal(plan.theme.includes("|"), false);
    assert.equal(plan.theme.includes("<b>"), false);
    assert.ok(plan.target_duration_sec >= 300 && plan.target_duration_sec <= 3600);

    // Bornes appliquées : sets max 10, reps non-timed max 100
    assert.equal(plan.exercises[0].sets, 10);
    assert.equal(plan.exercises[0].reps, 100);
    // Fallback ID inconnu -> vagal_resonance_01hz (is_timed: true -> reps max 1800)
    assert.equal(plan.exercises[1].id, "vagal_resonance_01hz");
    assert.equal(plan.exercises[1].sets, 1);
    assert.equal(plan.exercises[1].reps, 1800);
    assert.equal(plan.exercises[1].custom_label, "Mon Bloc Custom");
  });
});
