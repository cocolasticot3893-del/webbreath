/**
 * Contrôleur principal WebBreath (ES2024+ zéro-build, CSP stricte).
 * Relie Vault, Readiness Intervals.icu, Gatekeeper Gemini/Fallback,
 * Pacer 60 fps + Chrono BOLT, Dropzone CSV K5 50 Hz, Outbox hors-ligne et Push Intervals.icu.
 */

import {
  BODYWEIGHT,
  CATALOG,
  CATEGORIES,
  EQUIPMENT_KEYS,
  getCatalogExercise,
  normalizeEquipmentProfile,
} from "./catalog.js";
import {
  CATEGORY_LABELS,
  EQUIPMENT_LABELS,
  mountSafeSvg,
  renderCatalogDirectory,
} from "./directoryBuilder.js";
import { pushCustomExercisesToDrive } from "./driveSync.js";
import {
  buildSessionMarkdownAndPayload,
  computeSessionMetrics,
} from "./engine.js";
import { generateFallbackSession } from "./fallbackGenerator.js";
import {
  fetchAvailableGeminiModels,
  generateSessionWithGemini,
  parseMarkdownWithGemini,
  pickBestAvailableModel,
} from "./geminiClient.js";
import {
  ensureCustomActivityFields,
  fetchLatestTymewearStreams,
  fetchPhysioContext,
  publishBreathWorkout,
} from "./intervalsClient.js";
import { parseK5Csv } from "./k5Parser.js";
import { buildFreeSessionPlan } from "./mdParser.js";
import { countOutbox, enqueueOutbox, flushOutbox } from "./outbox.js";
import { BoltChrono, BreathPacer } from "./pacer.js";
import { buildBreathExerciseSvg } from "./svgHelper.js";
import {
  fuseVentilationAndPressure,
  parseSmartAdapterData,
  parseTymewearCsv,
} from "./telemetryFusion.js";
import {
  exportVaultJson,
  importVaultJson,
  loadVault,
  resetVault,
  saveVault,
} from "./vault.js";

/** @type {Record<string, HTMLElement | null>} */
const dom = {};

const state = {
  activeStep: 1,
  vault: loadVault(),
  physioContext: null,
  k5Data: null,
  tymewearData: null,
  smartAdapterData: null,
  freeDraft: [],
  pacerExerciseIdx: 0,
  sessionStartMs: null,
  session: {
    theme: "Séance Respiratoire",
    rationale: "Prêt pour la génération neuro-symbolique.",
    mode: "REPOS_Z1_Z2",
    applied_rules: [],
    safety_alerts: [],
    exercises: [],
    borg_rpe: 5,
    spo2_min: null,
    bolt_sec: null,
    notes: "",
    k5_summary: null,
    tymewear_summary: null,
    pressure_summary: null,
  },
  lastBuiltReport: null,
};

const EQUIPMENT_PRESETS = Object.freeze({
  ALL_OWNED: Object.freeze({
    PB_K5: true,
    PB_PLUS: true,
    PB_SMART_ADAPTER: false,
    PB_EX1: true,
    ISOCAPNIC: true,
    AIROFIT_MECH: true,
    NASAL_MOUTH_TAPE: true,
    TYMEWEAR: true,
    SPO2_OXIMETER: true,
  }),
  TRAVEL_MECH: Object.freeze({
    PB_K5: false,
    PB_PLUS: true,
    PB_SMART_ADAPTER: false,
    PB_EX1: true,
    ISOCAPNIC: false,
    AIROFIT_MECH: true,
    NASAL_MOUTH_TAPE: true,
    TYMEWEAR: false,
    SPO2_OXIMETER: true,
  }),
  BODYWEIGHT_ONLY: Object.freeze({
    PB_K5: false,
    PB_PLUS: false,
    PB_SMART_ADAPTER: false,
    PB_EX1: false,
    ISOCAPNIC: false,
    AIROFIT_MECH: false,
    NASAL_MOUTH_TAPE: false,
    TYMEWEAR: false,
    SPO2_OXIMETER: false,
  }),
});

/** @type {BreathPacer | null} */
let pacer = null;
/** @type {BoltChrono | null} */
let boltChrono = null;
let toastTimerId = 0;

/** @param {string} id */
function $(id) {
  return document.getElementById(id);
}

function cacheDom() {
  const ids = [
    "network-badge",
    "outbox-flush-btn",
    "outbox-count",
    "intervals-status-pill",
    "gemini-status-pill",
    "open-catalog-directory-btn",
    "open-vault-btn",
    "nav-step-1",
    "nav-step-2",
    "nav-step-3",
    "step-1-view",
    "step-2-view",
    "step-3-view",
    "refresh-readiness-btn",
    "readiness-subtitle",
    "kpi-card-readiness",
    "kpi-readiness-val",
    "kpi-readiness-sub",
    "kpi-tsb-val",
    "kpi-tsb-sub",
    "kpi-sindex-val",
    "kpi-sindex-sub",
    "kpi-bolt-val",
    "kpi-bolt-sub",
    "equipment-availability-card",
    "generation-source-badge",
    "open-free-builder-btn",
    "open-md-import-btn",
    "step1-k5-import-btn",
    "step1-k5-file-input",
    "session-theme-title",
    "session-rationale-text",
    "session-rules-badge",
    "go-step-3-btn",
    "pacer-container",
    "pacer-exercise-name",
    "pacer-pattern-badge",
    "pacer-mute-btn",
    "pacer-ring-progress",
    "pacer-orb",
    "pacer-phase-label",
    "pacer-phase-timer",
    "pacer-set-counter",
    "pacer-rep-counter",
    "pacer-toggle-btn",
    "pacer-stop-btn",
    "bolt-chrono-display",
    "bolt-chrono-hint",
    "bolt-toggle-btn",
    "bolt-save-btn",
    "k5-dropzone",
    "k5-file-input",
    "k5-clear-btn",
    "fusion-clear-btn",
    "tymewear-import-csv-btn",
    "tymewear-file-input",
    "tymewear-intervals-btn",
    "smart-adapter-import-btn",
    "smart-adapter-file-input",
    "telemetry-fusion-card",
    "fusion-source-badge",
    "fusion-ve-val",
    "fusion-rf-val",
    "fusion-vt-val",
    "fusion-rfvt-val",
    "fusion-work-val",
    "fusion-pressure-val",
    "fusion-cost-val",
    "k5-summary-status",
    "k5-metrics-container",
    "k5-table-body",
    "session-exercise-list",
    "step2-add-exercise-btn",
    "input-borg-rpe",
    "input-spo2-min",
    "input-bolt-sec",
    "input-session-notes",
    "back-step-2-btn",
    "final-work-val",
    "final-duration-sub",
    "final-strain-card",
    "final-strain-val",
    "final-strain-zone",
    "final-compliance-val",
    "final-load-sub",
    "final-bio-val",
    "final-borg-sub",
    "final-safety-alerts",
    "final-markdown-preview",
    "copy-markdown-btn",
    "queue-outbox-btn",
    "push-intervals-btn",
    "catalog-directory-view",
    "close-catalog-directory-btn",
    "directory-count-label",
    "directory-search-input",
    "directory-category-select",
    "directory-equipment-select",
    "directory-only-available",
    "directory-grid",
    "vault-backdrop",
    "vault-drawer",
    "close-vault-btn",
    "vault-athlete-id",
    "vault-intervals-key",
    "vault-gemini-key",
    "vault-llm-model",
    "vault-detect-model-btn",
    "vault-s-index",
    "vault-mep",
    "vault-bolt",
    "vault-equipment-toggles",
    "vault-drive-url",
    "vault-drive-secret",
    "vault-save-btn",
    "vault-provision-fields-btn",
    "vault-drive-sync-btn",
    "vault-export-btn",
    "vault-import-btn",
    "vault-import-input",
    "vault-reset-btn",
    "guide-modal",
    "guide-modal-title",
    "guide-modal-ref",
    "close-guide-modal-btn",
    "guide-modal-svg",
    "guide-modal-setup",
    "guide-modal-execution",
    "guide-modal-errors",
    "free-builder-modal",
    "close-free-builder-btn",
    "free-builder-name-input",
    "free-builder-select",
    "free-builder-add-btn",
    "free-builder-items",
    "free-builder-start-btn",
    "md-import-modal",
    "close-md-import-btn",
    "md-import-textarea",
    "md-import-submit-btn",
    "toast-banner",
  ];
  for (const id of ids) {
    dom[id] = $(id);
  }
}

/**
 * Affiche un toast non bloquant dans `#toast-banner`.
 * @param {string} message
 * @param {"info" | "success" | "error"} [kind="info"]
 */
function showToast(message, kind = "info") {
  const el = dom["toast-banner"];
  if (!el) return;
  el.textContent = message;
  el.className = "toast-banner";
  if (kind === "error") el.classList.add("is-error");
  if (kind === "success") el.classList.add("is-success");
  el.hidden = false;
  clearTimeout(toastTimerId);
  toastTimerId = window.setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

/* =========================================================================
   SERVICE WORKER & CONNECTIVITÉ / OUTBOX
   ========================================================================= */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Silencieux en environnement local sans HTTPS/SW
    });
  }
}

function updateNetworkStatusUI() {
  const online = navigator.onLine !== false;
  const badge = dom["network-badge"];
  if (badge) {
    badge.textContent = online ? "En ligne" : "Hors-ligne";
    badge.classList.toggle("is-online", online);
    badge.classList.toggle("is-offline", !online);
  }
}

async function refreshOutboxBadge() {
  const n = await countOutbox();
  if (dom["outbox-count"]) {
    dom["outbox-count"].textContent = String(n);
  }
  if (dom["outbox-flush-btn"]) {
    dom["outbox-flush-btn"].classList.toggle("has-pending", n > 0);
  }
}

async function handleFlushOutbox() {
  const apiKey = String(state.vault.INTERVALS_API_KEY || "").trim();
  if (!apiKey) {
    showToast("Configurez votre clé Intervals.icu dans le Coffre-Fort.", "error");
    openVaultDrawer();
    return;
  }
  if (navigator.onLine === false) {
    showToast("Synchronisation impossible hors-ligne.", "error");
    return;
  }
  const res = await flushOutbox((payload) =>
    publishBreathWorkout({
      athleteId: state.vault.INTERVALS_ATHLETE_ID || "0",
      apiKey,
      payload,
    })
  );
  await refreshOutboxBadge();
  if (res.sentCount > 0 && res.failedCount === 0) {
    showToast(`${res.sentCount} séance(s) Outbox synchronisée(s).`, "success");
  } else if (res.failedCount > 0) {
    showToast(
      `Outbox : ${res.sentCount} envoyée(s), ${res.failedCount} en échec.`,
      "error"
    );
  } else {
    showToast("La file Outbox est déjà vide.", "info");
  }
}

/* =========================================================================
   NAVIGATION ÉTAPES (1, 2, 3) & TOPBAR PILLS
   ========================================================================= */
function switchStep(stepNum) {
  state.activeStep = stepNum;
  if (dom["step-1-view"]) dom["step-1-view"].hidden = stepNum !== 1;
  if (dom["step-2-view"]) dom["step-2-view"].hidden = stepNum !== 2;
  if (dom["step-3-view"]) dom["step-3-view"].hidden = stepNum !== 3;

  for (const idx of [1, 2, 3]) {
    const tab = dom[`nav-step-${idx}`];
    if (tab) {
      tab.classList.toggle("is-active", idx === stepNum);
    }
  }

  if (stepNum === 3) {
    renderStep3Report();
  }
}

function updateTopbarPills() {
  const hasIntervals = Boolean(String(state.vault.INTERVALS_API_KEY || "").trim());
  const hasGemini = Boolean(String(state.vault.GEMINI_API_KEY || "").trim());

  if (dom["intervals-status-pill"]) {
    dom["intervals-status-pill"].textContent = hasIntervals
      ? "Intervals : Prêt"
      : "Intervals : Non config.";
    dom["intervals-status-pill"].classList.toggle("is-ready", hasIntervals);
    dom["intervals-status-pill"].classList.toggle("is-muted", !hasIntervals);
  }
  if (dom["gemini-status-pill"]) {
    dom["gemini-status-pill"].textContent = hasGemini
      ? `Gemini : ${state.vault.LLM_MODEL || "Auto"}`
      : "Gemini : Hors-ligne";
    dom["gemini-status-pill"].classList.toggle("is-ready", hasGemini);
    dom["gemini-status-pill"].classList.toggle("is-muted", !hasGemini);
  }
}

/* =========================================================================
   COFFRE-FORT (VAULT DRAWER)
   ========================================================================= */
function renderVaultEquipmentToggles() {
  const container = dom["vault-equipment-toggles"];
  if (!container) return;
  container.replaceChildren();

  const profile = normalizeEquipmentProfile(state.vault.BREATH_EQUIPMENT_PROFILE);
  for (const eqKey of Object.values(EQUIPMENT_KEYS)) {
    const label = document.createElement("label");
    label.className = "equip-toggle";

    const span = document.createElement("span");
    span.textContent = EQUIPMENT_LABELS[eqKey] ?? eqKey;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(profile[eqKey]);
    input.dataset.equipKey = eqKey;

    label.append(span, input);
    container.appendChild(label);
  }
}

function populateVaultForm() {
  const v = state.vault;
  if (dom["vault-athlete-id"]) dom["vault-athlete-id"].value = v.INTERVALS_ATHLETE_ID ?? "0";
  if (dom["vault-intervals-key"]) dom["vault-intervals-key"].value = v.INTERVALS_API_KEY ?? "";
  if (dom["vault-gemini-key"]) dom["vault-gemini-key"].value = v.GEMINI_API_KEY ?? "";
  if (dom["vault-llm-model"]) dom["vault-llm-model"].value = v.LLM_MODEL ?? "gemini-3.5-flash";
  if (dom["vault-s-index"]) dom["vault-s-index"].value = String(v.BREATH_S_INDEX_CMH2O ?? 111);
  if (dom["vault-mep"]) dom["vault-mep"].value = String(v.BREATH_MEP_CMH2O ?? 120);
  if (dom["vault-bolt"]) dom["vault-bolt"].value = String(v.BREATH_BOLT_SEC ?? 30);
  if (dom["vault-drive-url"]) dom["vault-drive-url"].value = v.DRIVE_WEBHOOK_URL ?? "";
  if (dom["vault-drive-secret"]) dom["vault-drive-secret"].value = v.DRIVE_WEBHOOK_SECRET ?? "";
  renderVaultEquipmentToggles();
}

function openVaultDrawer() {
  populateVaultForm();
  if (dom["vault-backdrop"]) dom["vault-backdrop"].hidden = false;
  if (dom["vault-drawer"]) dom["vault-drawer"].hidden = false;
  dom["open-vault-btn"]?.setAttribute("aria-expanded", "true");
}

function closeVaultDrawer() {
  if (dom["vault-backdrop"]) dom["vault-backdrop"].hidden = true;
  if (dom["vault-drawer"]) dom["vault-drawer"].hidden = true;
  dom["open-vault-btn"]?.setAttribute("aria-expanded", "false");
}

function saveVaultFromForm() {
  const profilePatch = {};
  const checkboxes = dom["vault-equipment-toggles"]?.querySelectorAll("input[type='checkbox']") ?? [];
  for (const cb of checkboxes) {
    if (cb.dataset.equipKey) {
      profilePatch[cb.dataset.equipKey] = cb.checked;
    }
  }

  state.vault = saveVault({
    INTERVALS_ATHLETE_ID: dom["vault-athlete-id"]?.value ?? "0",
    INTERVALS_API_KEY: dom["vault-intervals-key"]?.value ?? "",
    GEMINI_API_KEY: dom["vault-gemini-key"]?.value ?? "",
    LLM_MODEL: dom["vault-llm-model"]?.value ?? "gemini-3.5-flash",
    BREATH_S_INDEX_CMH2O: Number(dom["vault-s-index"]?.value || 111),
    BREATH_MEP_CMH2O: Number(dom["vault-mep"]?.value || 120),
    BREATH_BOLT_SEC: Number(dom["vault-bolt"]?.value || 30),
    DRIVE_WEBHOOK_URL: dom["vault-drive-url"]?.value ?? "",
    DRIVE_WEBHOOK_SECRET: dom["vault-drive-secret"]?.value ?? "",
    BREATH_EQUIPMENT_PROFILE: profilePatch,
  });

  updateTopbarPills();
  renderReadinessDashboard();
  renderStep1EquipmentAvailability();
  if (!dom["catalog-directory-view"]?.hidden) {
    refreshDirectoryView();
  }
  showToast("Coffre-Fort enregistré localement.", "success");
  closeVaultDrawer();
}

/**
 * Vérifie si deux profils matériel sont strictement identiques sur toutes les clés.
 * @param {Record<string, boolean>} a
 * @param {Record<string, boolean>} b
 * @returns {boolean}
 */
function equipmentProfilesMatch(a, b) {
  for (const key of Object.values(EQUIPMENT_KEYS)) {
    if (Boolean(a[key]) !== Boolean(b[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Met à jour l'état visuel des chips matériel et des pré-réglages sur l'Étape 1.
 */
function renderStep1EquipmentAvailability() {
  const card = dom["equipment-availability-card"];
  if (!card) return;
  const profile = normalizeEquipmentProfile(state.vault.BREATH_EQUIPMENT_PROFILE);

  card.querySelectorAll("[data-equip-toggle]").forEach((chip) => {
    const eqKey = chip.getAttribute("data-equip-toggle");
    if (!eqKey) return;
    chip.setAttribute("aria-pressed", String(Boolean(profile[eqKey])));
  });

  card.querySelectorAll("[data-equip-preset]").forEach((btn) => {
    const presetKey = btn.getAttribute("data-equip-preset");
    const presetProfile = presetKey ? EQUIPMENT_PRESETS[presetKey] : null;
    btn.classList.toggle("is-active", Boolean(presetProfile && equipmentProfilesMatch(profile, presetProfile)));
  });
}

/**
 * Synchronise bidirectionnellement le profil matériel (Étape 1 <-> Vault <-> Catalogue).
 * @param {Record<string, boolean>} profilePatch
 * @param {{ renderVault?: boolean }} [options]
 */
function applyEquipmentProfileSync(profilePatch, { renderVault = true } = {}) {
  state.vault = saveVault({ BREATH_EQUIPMENT_PROFILE: profilePatch });
  renderStep1EquipmentAvailability();
  if (renderVault) {
    renderVaultEquipmentToggles();
  }
  if (!dom["catalog-directory-view"]?.hidden) {
    refreshDirectoryView();
  }
}

async function handleDetectGeminiModel() {
  const key = String(dom["vault-gemini-key"]?.value ?? "").trim();
  if (!key) {
    showToast("Saisissez d'abord votre clé API Gemini.", "error");
    return;
  }
  try {
    const models = await fetchAvailableGeminiModels(key);
    const best = pickBestAvailableModel(models, dom["vault-llm-model"]?.value);
    if (best && dom["vault-llm-model"]) {
      dom["vault-llm-model"].value = best;
      showToast(`Modèle Gemini sélectionné : ${best}`, "success");
    } else {
      showToast("Aucun modèle Gemini compatible détecté.", "error");
    }
  } catch (err) {
    showToast(`Erreur détection Gemini : ${err.message}`, "error");
  }
}

async function handleProvisionIntervalsFields() {
  const apiKey = String(dom["vault-intervals-key"]?.value ?? state.vault.INTERVALS_API_KEY ?? "").trim();
  const athleteId = String(dom["vault-athlete-id"]?.value ?? state.vault.INTERVALS_ATHLETE_ID ?? "0").trim();
  if (!apiKey) {
    showToast("Clé Intervals.icu requise pour provisionner les champs.", "error");
    return;
  }
  try {
    const res = await ensureCustomActivityFields({ athleteId, apiKey });
    showToast(
      `Champs Intervals.icu : ${res.created.length} créés, ${res.existing.length} existants.`,
      res.errors.length > 0 ? "error" : "success"
    );
  } catch (err) {
    showToast(`Erreur champs Intervals.icu : ${err.message}`, "error");
  }
}

async function handleDriveSync() {
  const webhookUrl = String(dom["vault-drive-url"]?.value ?? state.vault.DRIVE_WEBHOOK_URL ?? "").trim();
  const secret = String(dom["vault-drive-secret"]?.value ?? state.vault.DRIVE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookUrl) {
    showToast("Renseignez l'URL du webhook Google Apps Script.", "error");
    return;
  }
  try {
    const payload = state.session.exercises.length > 0 ? state.session.exercises : CATALOG.slice(0, 5);
    const res = await pushCustomExercisesToDrive({
      webhookUrl,
      secret,
      exercisesJson: payload,
    });
    showToast(`Drive synchronisé : ${res.fileName} (${res.count} items).`, "success");
  } catch (err) {
    showToast(`Erreur Sync Drive : ${err.message}`, "error");
  }
}

/* =========================================================================
   ÉTAPE 1 : READINESS & GATEKEEPER 1-TAP
   ========================================================================= */
function renderReadinessDashboard() {
  const ctx = state.physioContext;
  const v = state.vault;

  if (dom["kpi-sindex-val"]) {
    dom["kpi-sindex-val"].textContent = `${v.BREATH_S_INDEX_CMH2O ?? 111} / ${v.BREATH_MEP_CMH2O ?? 120}`;
  }
  if (dom["kpi-bolt-val"]) {
    dom["kpi-bolt-val"].textContent = `${v.BREATH_BOLT_SEC ?? 30} s`;
  }

  if (!ctx) {
    if (dom["kpi-readiness-val"]) dom["kpi-readiness-val"].textContent = "LOCAL";
    if (dom["kpi-readiness-sub"]) {
      dom["kpi-readiness-sub"].textContent = "Références locales actives";
    }
    return;
  }

  if (dom["kpi-readiness-val"]) {
    const ratioPct =
      ctx.hrv_ratio !== null ? `${Math.round(ctx.hrv_ratio * 100)}%` : "—";
    dom["kpi-readiness-val"].textContent = `${ctx.readiness} (${ratioPct})`;
  }
  if (dom["kpi-readiness-sub"]) {
    const sleepText = ctx.sleep_hours !== null ? `${ctx.sleep_hours} h sommeil` : "Sommeil —";
    const hrvText = ctx.hrv_j0 !== null ? `HRV ${ctx.hrv_j0} ms` : "HRV —";
    dom["kpi-readiness-sub"].textContent = `${hrvText} · ${sleepText}`;
  }
  if (dom["kpi-card-readiness"]) {
    dom["kpi-card-readiness"].className = "kpi-card";
    dom["kpi-card-readiness"].classList.add(
      ctx.readiness === "COMPROMISED"
        ? "is-coral"
        : ctx.readiness === "MODERATE"
          ? "is-amber"
          : "is-emerald"
    );
  }

  if (dom["kpi-tsb-val"]) {
    dom["kpi-tsb-val"].textContent = `${ctx.tsb ?? "—"} / ${ctx.last_7d_bike_load ?? 0}`;
  }
  if (dom["kpi-tsb-sub"]) {
    dom["kpi-tsb-sub"].textContent = `Vélo hier : ${ctx.yesterday_bike_hours ?? 0} h`;
  }
  if (dom["kpi-bolt-sub"]) {
    if (ctx.last_breath_activity) {
      const h = ctx.hours_since_last_breath ?? "—";
      dom["kpi-bolt-sub"].textContent = `Dernière : il y a ${h} h`;
    } else {
      dom["kpi-bolt-sub"].textContent = "Aucune séance respiratoire sur 7j";
    }
  }
}

async function refreshReadinessFromIntervals() {
  const apiKey = String(state.vault.INTERVALS_API_KEY || "").trim();
  if (!apiKey || navigator.onLine === false) {
    renderReadinessDashboard();
    return;
  }
  if (dom["refresh-readiness-btn"]) {
    dom["refresh-readiness-btn"].disabled = true;
    dom["refresh-readiness-btn"].textContent = "Chargement...";
  }
  try {
    state.physioContext = await fetchPhysioContext({
      athleteId: state.vault.INTERVALS_ATHLETE_ID || "0",
      apiKey,
    });
    renderReadinessDashboard();
    if (dom["readiness-subtitle"]) {
      dom["readiness-subtitle"].textContent = `Contexte Intervals.icu actualisé à ${new Date().toLocaleTimeString("fr-FR")}`;
    }
  } catch (err) {
    showToast(`Intervals.icu : ${err.message}`, "error");
  } finally {
    if (dom["refresh-readiness-btn"]) {
      dom["refresh-readiness-btn"].disabled = false;
      dom["refresh-readiness-btn"].textContent = "Actualiser Intervals.icu";
    }
  }
}

async function handleGatekeeperSelect(mode) {
  if (dom["generation-source-badge"]) {
    dom["generation-source-badge"].textContent = "Génération...";
  }

  const context = {
    gatekeeperMode: mode,
    tomorrowBikeLoad: mode,
    equipmentProfile: state.vault.BREATH_EQUIPMENT_PROFILE,
    sIndex: state.vault.BREATH_S_INDEX_CMH2O,
    mep: state.vault.BREATH_MEP_CMH2O,
    boltSec: state.vault.BREATH_BOLT_SEC,
    tsb: state.physioContext?.tsb ?? null,
    hrvRatio: state.physioContext?.hrv_ratio ?? null,
    sleepHours: state.physioContext?.sleep_hours ?? null,
    readiness: state.physioContext?.readiness ?? "OPTIMAL",
  };

  let result;
  const geminiKey = String(state.vault.GEMINI_API_KEY || "").trim();
  if (geminiKey && navigator.onLine !== false) {
    result = await generateSessionWithGemini({
      apiKey: geminiKey,
      model: state.vault.LLM_MODEL || "gemini-3.5-flash",
      context,
      timeoutMs: 4500,
    });
  } else {
    result = {
      plan: generateFallbackSession(context),
      source: "FALLBACK_LOCAL",
    };
  }

  if (dom["generation-source-badge"]) {
    dom["generation-source-badge"].textContent =
      result.source === "GEMINI" ? `Gemini (${result.model || "OK"})` : "Moteur Local";
  }

  applyPlanToSession(result.plan);
  switchStep(2);
}

/**
 * Charge un plan généré/parsé dans la séance active de l'Étape 2.
 * @param {object} plan
 */
function applyPlanToSession(plan) {
  state.sessionStartMs = Date.now();
  state.session = {
    theme: plan.theme || "Séance WebBreath",
    rationale: plan.rationale || "",
    mode: plan.gatekeeper_mode || plan.mode || "REPOS_Z1_Z2",
    applied_rules: Array.isArray(plan.applied_rules) ? plan.applied_rules : [],
    safety_alerts: Array.isArray(plan.safety_alerts) ? plan.safety_alerts : [],
    pre_intense_session:
      plan.gatekeeper_mode === "SEUIL_VO2_MAX" ||
      plan.gatekeeper_mode === "PRE_RACE_IMW",
    exercises: (Array.isArray(plan.exercises) ? plan.exercises : []).map((ex, idx) => ({
      ...ex,
      block: ex.block ?? idx + 1,
      completion: typeof ex.completion === "number" ? ex.completion : 1.0,
    })),
    borg_rpe: Number.isFinite(Number(plan.recommended_rpe)) ? Number(plan.recommended_rpe) : 5,
    spo2_min: null,
    bolt_sec: state.vault.BREATH_BOLT_SEC ?? null,
    notes: "",
    k5_summary: state.k5Data?.summary ?? null,
    tymewear_summary: state.tymewearData ?? null,
    pressure_summary: state.smartAdapterData?.summary ?? state.k5Data?.summary ?? null,
  };

  if (dom["input-borg-rpe"]) dom["input-borg-rpe"].value = String(state.session.borg_rpe);
  if (dom["input-bolt-sec"]) {
    dom["input-bolt-sec"].value =
      state.session.bolt_sec !== null ? String(state.session.bolt_sec) : "";
  }
  if (dom["input-spo2-min"]) dom["input-spo2-min"].value = "";
  if (dom["input-session-notes"]) dom["input-session-notes"].value = "";

  state.pacerExerciseIdx = 0;
  renderStep2Session();
  loadExerciseIntoPacer(0);
}

/* =========================================================================
   ÉTAPE 2 : PACER, EXERCICES & DROPZONE CSV K5
   ========================================================================= */
function loadExerciseIntoPacer(idx) {
  if (!pacer) return;
  const ex = state.session.exercises[idx];
  if (!ex) return;
  const cat = getCatalogExercise(ex.id);
  state.pacerExerciseIdx = idx;
  pacer.loadExercise({
    id: ex.id,
    name: ex.custom_label || cat?.name || ex.id,
    pacer_pattern: cat?.pacer_pattern ?? { inhale_s: 4, hold_in_s: 0, exhale_s: 6, hold_out_s: 0 },
    sets: ex.sets,
    reps: ex.reps,
    is_timed: Boolean(ex.is_timed ?? cat?.is_timed),
  });
}

function renderStep2Session() {
  if (dom["session-theme-title"]) {
    dom["session-theme-title"].textContent = state.session.theme;
  }
  if (dom["session-rationale-text"]) {
    dom["session-rationale-text"].textContent = state.session.rationale;
  }
  if (dom["session-rules-badge"]) {
    dom["session-rules-badge"].textContent =
      state.session.applied_rules.join(" · ") || state.session.mode;
  }

  const list = dom["session-exercise-list"];
  if (!list) return;
  list.replaceChildren();

  if (state.session.exercises.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-note";
    empty.textContent = "Aucun exercice chargé. Ajoutez un exercice depuis le catalogue ou lancez un mode Gatekeeper.";
    list.appendChild(empty);
    return;
  }

  state.session.exercises.forEach((ex, idx) => {
    const cat = getCatalogExercise(ex.id);
    const card = document.createElement("div");
    card.className = "exercise-item";

    const head = document.createElement("div");
    head.className = "exercise-item-head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h4");
    title.className = "exercise-title";
    title.textContent = `B${ex.block ?? idx + 1} · ${ex.custom_label || cat?.name || ex.id}`;

    const ref = document.createElement("p");
    ref.className = "science-ref-badge";
    ref.textContent = cat?.science_ref ? `Réf. : ${cat.science_ref}` : "Exercice personnalisé";
    titleWrap.append(title, ref);

    const headActions = document.createElement("div");
    headActions.style.display = "flex";
    headActions.style.gap = "0.4rem";

    const pacerBtn = document.createElement("button");
    pacerBtn.type = "button";
    pacerBtn.className = "btn btn-secondary btn-sm";
    pacerBtn.textContent = "Pacer";
    pacerBtn.addEventListener("click", () => loadExerciseIntoPacer(idx));

    const guideBtn = document.createElement("button");
    guideBtn.type = "button";
    guideBtn.className = "btn btn-ghost btn-sm";
    guideBtn.textContent = "Guide SVG";
    guideBtn.addEventListener("click", () => {
      if (cat) openGuideModal(cat);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-coral btn-sm";
    delBtn.textContent = "✕";
    delBtn.title = "Retirer l'exercice";
    delBtn.addEventListener("click", () => {
      state.session.exercises.splice(idx, 1);
      renderStep2Session();
    });

    headActions.append(pacerBtn, guideBtn, delBtn);
    head.append(titleWrap, headActions);

    // Steppers Sets, Reps/Durée, Charge
    const steppers = document.createElement("div");
    steppers.className = "stepper-grid";

    steppers.append(
      createStepperBox("Séries", ex.sets, 1, 10, 1, (next) => {
        ex.sets = next;
        renderStep2Session();
      }),
      createStepperBox(
        ex.is_timed ? "Durée (s)" : "Répétitions",
        ex.reps,
        1,
        ex.is_timed ? 1800 : 120,
        ex.is_timed ? 15 : 5,
        (next) => {
          ex.reps = next;
          renderStep2Session();
        }
      ),
      createStepperBox(
        `Charge (${cat?.unit_label || "u"})`,
        Number(ex.load) || 0,
        0,
        300,
        5,
        (next) => {
          ex.load = next;
          renderStep2Session();
        }
      )
    );

    // Taux de complétion
    const compBox = document.createElement("div");
    compBox.className = "stepper-box";
    const compLabel = document.createElement("span");
    compLabel.className = "stepper-label";
    compLabel.textContent = "Complétion";
    const compRow = document.createElement("div");
    compRow.className = "compliance-row";

    for (const ratio of [0, 0.5, 0.75, 1]) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `comp-chip ${ex.completion === ratio ? "is-active" : ""}`;
      chip.textContent = `${Math.round(ratio * 100)}%`;
      chip.addEventListener("click", () => {
        ex.completion = ratio;
        renderStep2Session();
      });
      compRow.appendChild(chip);
    }
    compBox.append(compLabel, compRow);
    steppers.appendChild(compBox);

    card.append(head, steppers);
    list.appendChild(card);
  });
}

function createStepperBox(label, value, min, max, step, onChange) {
  const box = document.createElement("div");
  box.className = "stepper-box";

  const lbl = document.createElement("span");
  lbl.className = "stepper-label";
  lbl.textContent = label;

  const controls = document.createElement("div");
  controls.className = "stepper-controls";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "stepper-btn";
  minus.textContent = "−";
  minus.addEventListener("click", () => {
    onChange(Math.max(min, value - step));
  });

  const valEl = document.createElement("span");
  valEl.className = "stepper-val";
  valEl.textContent = String(value);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "stepper-btn";
  plus.textContent = "+";
  plus.addEventListener("click", () => {
    onChange(Math.min(max, value + step));
  });

  controls.append(minus, valEl, plus);
  box.append(lbl, controls);
  return box;
}

/**
 * Traite un fichier CSV POWERbreathe K5 (50 Hz), met à jour la table et injecte dans la séance.
 * @param {File} file
 * @param {boolean} [jumpToStep2=false]
 */
async function handleK5CsvFile(file, jumpToStep2 = false) {
  if (!file) return;
  const maxFileSizeBytes = 10 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxFileSizeBytes) {
    showToast(
      "Erreur CSV K5 : le fichier dépasse la limite autorisée de 10 Mo.",
      "error"
    );
    return;
  }
  try {
    const csvText = await file.text();
    const parsed = parseK5Csv(csvText);
    state.k5Data = parsed;
    state.session.k5_summary = parsed.summary;
    state.session.pressure_summary = parsed.summary;

    if (jumpToStep2 && state.session.exercises.length === 0) {
      const k5Cat = getCatalogExercise("k5_imt_30rm_hypertrophy");
      applyPlanToSession({
        theme: `Séance K5 Importée (${parsed.summary.breathCount} cycles)`,
        rationale: "Données réelles 50 Hz injectées depuis export CSV POWERbreathe K5.",
        gatekeeper_mode: "REPOS_Z1_Z2",
        applied_rules: ["K5_CSV_50HZ"],
        exercises: [
          {
            id: k5Cat?.id || "k5_imt_30rm_hypertrophy",
            block: 1,
            sets: 1,
            reps: parsed.summary.breathCount,
            load: parsed.summary.targetLoadCmh2o || 80,
            is_timed: false,
          },
        ],
      });
      state.session.k5_summary = parsed.summary;
    }

    if (parsed.summary.sIndexEstimate > 0) {
      state.vault = saveVault({ BREATH_S_INDEX_CMH2O: Math.round(parsed.summary.sIndexEstimate) });
      renderReadinessDashboard();
    }

    renderK5TelemetryTable(parsed);
    renderFusionSummaryCard();
    if (jumpToStep2) switchStep(2);
    showToast(
      `CSV K5 importé : ${parsed.summary.breathCount} cycles, ${parsed.summary.totalWorkJ} J.`,
      "success"
    );
  } catch (err) {
    showToast(`Erreur CSV K5 : ${err.message}`, "error");
  }
}

function renderK5TelemetryTable(parsed) {
  if (!parsed) {
    if (dom["k5-summary-status"]) {
      dom["k5-summary-status"].textContent = "Aucun fichier K5 importé pour cette séance.";
    }
    if (dom["k5-metrics-container"]) dom["k5-metrics-container"].hidden = true;
    if (dom["k5-clear-btn"]) dom["k5-clear-btn"].hidden = true;
    if (dom["k5-table-body"]) dom["k5-table-body"].replaceChildren();
    return;
  }

  const s = parsed.summary;
  if (dom["k5-summary-status"]) {
    dom["k5-summary-status"].textContent =
      `${s.breathCount} cycles · Travail ${s.totalWorkJ} J · S-Index est. ${s.sIndexEstimate} cmH₂O · PIF pic ${s.peakFlowLs} L/s · Chute débit ${s.flowDropPct} %`;
  }
  if (dom["k5-clear-btn"]) dom["k5-clear-btn"].hidden = false;
  if (dom["k5-metrics-container"]) dom["k5-metrics-container"].hidden = false;

  const tbody = dom["k5-table-body"];
  if (!tbody) return;
  tbody.replaceChildren();

  for (const b of parsed.breaths) {
    const tr = document.createElement("tr");
    const cells = [
      `#${b.breathIndex}`,
      b.inspiratoryTimeS.toFixed(2),
      b.inspiredVolumeL.toFixed(2),
      b.peakPressureCmh2o.toFixed(1),
      b.peakFlowLs.toFixed(2),
      b.workOfBreathingJ.toFixed(2),
      b.meanPowerW.toFixed(2),
    ];
    for (const val of cells) {
      const td = document.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/**
 * Met à jour la carte synthèse combinée TymeWear + Smart Adapter / K5 (Étape 2).
 */
function renderFusionSummaryCard() {
  const card = dom["telemetry-fusion-card"];
  if (!card) return;

  const pressureSource = state.smartAdapterData ?? state.k5Data ?? null;
  const fusion = fuseVentilationAndPressure({
    tymewear: state.tymewearData,
    pressure: pressureSource,
  });

  const active = fusion.hasTymewear || fusion.hasPressure;
  card.hidden = !active;
  if (dom["fusion-clear-btn"]) {
    dom["fusion-clear-btn"].hidden = !(state.tymewearData || state.smartAdapterData);
  }

  if (!active) {
    return;
  }

  if (dom["fusion-source-badge"]) {
    if (fusion.hasTymewear && fusion.hasPressure) {
      dom["fusion-source-badge"].textContent = state.smartAdapterData
        ? "TymeWear + Smart Adapter"
        : "TymeWear + K5";
    } else if (fusion.hasTymewear) {
      dom["fusion-source-badge"].textContent = "TymeWear";
    } else {
      dom["fusion-source-badge"].textContent = state.smartAdapterData ? "Smart Adapter" : "K5 50 Hz";
    }
  }

  const c = fusion.combined;
  if (dom["fusion-ve-val"]) {
    dom["fusion-ve-val"].textContent =
      c.veAvgLMin !== null ? `${c.veAvgLMin} / ${c.vePeakLMin ?? "—"} L/min` : "—";
  }
  if (dom["fusion-rf-val"]) {
    dom["fusion-rf-val"].textContent = c.rfAvgBrMin !== null ? `${c.rfAvgBrMin} br/min` : "—";
  }
  if (dom["fusion-vt-val"]) {
    dom["fusion-vt-val"].textContent = c.vtAvgL !== null ? `${c.vtAvgL} L` : "—";
  }
  if (dom["fusion-rfvt-val"]) {
    dom["fusion-rfvt-val"].textContent = c.rfVtRatio !== null ? String(c.rfVtRatio) : "—";
  }
  if (dom["fusion-work-val"]) {
    dom["fusion-work-val"].textContent = c.workJ !== null ? `${c.workJ} J` : "—";
  }
  if (dom["fusion-pressure-val"]) {
    dom["fusion-pressure-val"].textContent =
      c.peakPressureCmh2o !== null ? `${c.peakPressureCmh2o} cmH₂O` : "—";
  }
  if (dom["fusion-cost-val"]) {
    dom["fusion-cost-val"].textContent =
      c.ventilatoryCostJPerL !== null ? `${c.ventilatoryCostJPerL} J/L` : "—";
  }
}

/**
 * Importe un fichier CSV TymeWear / Intervals.icu streams.
 * @param {File} file
 */
async function handleTymewearCsvFile(file) {
  if (!file) return;
  const maxFileSizeBytes = 10 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxFileSizeBytes) {
    showToast("Erreur CSV TymeWear : le fichier dépasse 10 Mo.", "error");
    return;
  }
  try {
    const csvText = await file.text();
    const summary = parseTymewearCsv(csvText);
    state.tymewearData = summary;
    state.session.tymewear_summary = summary;
    renderFusionSummaryCard();
    showToast(
      `TymeWear importé : VE moy ${summary.veAvgLMin ?? "—"} L/min (${summary.sampleCount} pts).`,
      "success"
    );
  } catch (err) {
    showToast(`Erreur CSV TymeWear : ${err.message}`, "error");
  }
}

/**
 * Charge les streams TymeWear depuis la dernière activité récente (48 h) Intervals.icu.
 */
async function handleLoadTymewearFromIntervals() {
  const apiKey = String(state.vault.INTERVALS_API_KEY || "").trim();
  if (!apiKey) {
    showToast("Configurez votre clé API Intervals.icu dans le Coffre-Fort.", "error");
    return;
  }
  if (navigator.onLine === false) {
    showToast("Impossible de charger Intervals.icu hors-ligne.", "error");
    return;
  }

  const btn = dom["tymewear-intervals-btn"];
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Chargement TymeWear...";
  }
  try {
    const summary = await fetchLatestTymewearStreams({
      athleteId: state.vault.INTERVALS_ATHLETE_ID || "0",
      apiKey,
    });
    state.tymewearData = summary;
    state.session.tymewear_summary = summary;
    renderFusionSummaryCard();
    const label = summary.activityName ? ` (${summary.activityName})` : "";
    showToast(
      `TymeWear Intervals.icu chargé${label} : VE moy ${summary.veAvgLMin ?? "—"} L/min.`,
      "success"
    );
  } catch (err) {
    showToast(`Erreur TymeWear Intervals.icu : ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Charger TymeWear (Intervals.icu)";
    }
  }
}

/**
 * Importe un fichier Smart Adapter (CSV/JSON) ou K5 50 Hz.
 * @param {File} file
 */
async function handleSmartAdapterFile(file) {
  if (!file) return;
  const maxFileSizeBytes = 10 * 1024 * 1024;
  if (typeof file.size === "number" && file.size > maxFileSizeBytes) {
    showToast("Erreur Smart Adapter : le fichier dépasse 10 Mo.", "error");
    return;
  }
  try {
    const rawText = await file.text();
    const parsed = parseSmartAdapterData(rawText);
    state.smartAdapterData = parsed;
    state.session.pressure_summary = parsed.summary;

    if (parsed.source === "K5_50HZ") {
      state.k5Data = parsed;
      state.session.k5_summary = parsed.summary;
      renderK5TelemetryTable(parsed);
    }

    if (parsed.summary.sIndexEstimate > 0) {
      state.vault = saveVault({ BREATH_S_INDEX_CMH2O: Math.round(parsed.summary.sIndexEstimate) });
      renderReadinessDashboard();
    }

    renderFusionSummaryCard();
    showToast(
      `Smart Adapter importé : ${parsed.summary.breathCount} cycles, ${parsed.summary.totalWorkJ} J.`,
      "success"
    );
  } catch (err) {
    showToast(`Erreur Smart Adapter : ${err.message}`, "error");
  }
}

/* =========================================================================
   ÉTAPE 3 : BILAN FINAL, MARKDOWN & PUSH INTERVALS.ICU
   ========================================================================= */
function syncSessionInputsFromDom() {
  const borgVal = Number(dom["input-borg-rpe"]?.value);
  state.session.borg_rpe = Number.isFinite(borgVal) ? Math.min(10, Math.max(0, borgVal)) : 5;

  const spo2Raw = dom["input-spo2-min"]?.value;
  const spo2Val = Number(spo2Raw);
  state.session.spo2_min =
    spo2Raw !== undefined && spo2Raw !== "" && Number.isFinite(spo2Val)
      ? Math.min(100, Math.max(50, spo2Val))
      : null;

  const boltRaw = dom["input-bolt-sec"]?.value;
  const boltVal = Number(boltRaw);
  state.session.bolt_sec =
    boltRaw !== undefined && boltRaw !== "" && Number.isFinite(boltVal)
      ? Math.min(180, Math.max(1, boltVal))
      : null;

  state.session.notes = dom["input-session-notes"]?.value ?? "";
}

function renderStep3Report() {
  syncSessionInputsFromDom();

  const elapsedSec = state.sessionStartMs
    ? Math.max(60, Math.round((Date.now() - state.sessionStartMs) / 1000))
    : undefined;

  const sessionForCalc = {
    ...state.session,
    s_index_cmh2o: state.vault.BREATH_S_INDEX_CMH2O ?? 111,
    mep_cmh2o: state.vault.BREATH_MEP_CMH2O ?? 120,
    elapsed_time_sec: elapsedSec,
  };

  const metrics = computeSessionMetrics(sessionForCalc);
  const report = buildSessionMarkdownAndPayload(sessionForCalc, metrics);
  state.lastBuiltReport = report;

  if (dom["final-work-val"]) dom["final-work-val"].textContent = `${metrics.respWorkJ} J`;
  if (dom["final-duration-sub"]) {
    dom["final-duration-sub"].textContent = `Durée : ${Math.round(metrics.effectiveDurationSec / 60)} min`;
  }
  if (dom["final-strain-val"]) {
    dom["final-strain-val"].textContent = `${metrics.respiratoryStrain} AU`;
  }
  if (dom["final-strain-zone"]) {
    dom["final-strain-zone"].textContent = `Zone ${metrics.strainZone}`;
  }
  if (dom["final-strain-card"]) {
    dom["final-strain-card"].className = "kpi-card";
    dom["final-strain-card"].classList.add(
      metrics.strainZone === "RED"
        ? "is-coral"
        : metrics.strainZone === "ORANGE"
          ? "is-amber"
          : "is-emerald"
    );
  }
  if (dom["final-compliance-val"]) {
    dom["final-compliance-val"].textContent = `${metrics.compliancePct} %`;
  }
  if (dom["final-load-sub"]) {
    dom["final-load-sub"].textContent = `Load Intervals : ${metrics.intervalsLoad}`;
  }
  if (dom["final-bio-val"]) {
    dom["final-bio-val"].textContent = `${metrics.sIndexCmh2o} / ${metrics.boltSec ?? "—"}s / ${metrics.spo2Min ?? "—"}%`;
  }
  if (dom["final-borg-sub"]) {
    dom["final-borg-sub"].textContent = `Borg : ${metrics.borgRpe}/10 (Feeling ${metrics.feeling}/5)`;
  }

  const alertsEl = dom["final-safety-alerts"];
  if (alertsEl) {
    alertsEl.replaceChildren();
    for (const alert of metrics.safetyAlerts) {
      const box = document.createElement("div");
      box.className = `alert-box ${alert.level === "CRITICAL" ? "is-critical" : "is-warning"}`;
      box.textContent = `[${alert.level}] ${alert.message}`;
      alertsEl.appendChild(box);
    }
  }

  if (dom["final-markdown-preview"]) {
    dom["final-markdown-preview"].textContent = report.markdown;
  }
}

async function handleQueueOutbox() {
  renderStep3Report();
  if (!state.lastBuiltReport) return;
  await enqueueOutbox(state.lastBuiltReport.payload);
  await refreshOutboxBadge();
  showToast("Séance enregistrée dans l'Outbox hors-ligne.", "success");
}

async function handlePushIntervals() {
  renderStep3Report();
  const report = state.lastBuiltReport;
  if (!report) return;

  const apiKey = String(state.vault.INTERVALS_API_KEY || "").trim();
  if (!apiKey || navigator.onLine === false) {
    await enqueueOutbox(report.payload);
    await refreshOutboxBadge();
    showToast(
      "Hors-ligne ou clé absente : séance placée en file d'attente Outbox.",
      "info"
    );
    return;
  }

  if (dom["push-intervals-btn"]) dom["push-intervals-btn"].disabled = true;
  try {
    await publishBreathWorkout({
      athleteId: state.vault.INTERVALS_ATHLETE_ID || "0",
      apiKey,
      payload: report.payload,
    });
    showToast("Séance WebBreath publiée sur Intervals.icu !", "success");
  } catch (err) {
    await enqueueOutbox(report.payload);
    await refreshOutboxBadge();
    showToast(
      `Échec push (${err.message}) : séance sauvegardée en Outbox.`,
      "error"
    );
  } finally {
    if (dom["push-intervals-btn"]) dom["push-intervals-btn"].disabled = false;
  }
}

/* =========================================================================
   ANNUAIRE CATALOGUE, GUIDE SVG, CONSTRUCTEUR LIBRE & IMPORT MARKDOWN
   ========================================================================= */
function initDirectoryFilters() {
  if (dom["directory-category-select"]) {
    dom["directory-category-select"].replaceChildren();
    for (const [val, lbl] of Object.entries(CATEGORY_LABELS)) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = lbl;
      dom["directory-category-select"].appendChild(opt);
    }
  }

  if (dom["directory-equipment-select"]) {
    dom["directory-equipment-select"].replaceChildren();
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = "Tous équipements";
    dom["directory-equipment-select"].appendChild(allOpt);

    for (const eqKey of [...Object.values(EQUIPMENT_KEYS), BODYWEIGHT]) {
      const opt = document.createElement("option");
      opt.value = eqKey;
      opt.textContent = EQUIPMENT_LABELS[eqKey] ?? eqKey;
      dom["directory-equipment-select"].appendChild(opt);
    }
  }
}

function refreshDirectoryView() {
  renderCatalogDirectory({
    container: dom["directory-grid"],
    countEl: dom["directory-count-label"],
    exercises: CATALOG,
    equipmentProfile: state.vault.BREATH_EQUIPMENT_PROFILE,
    categoryFilter: dom["directory-category-select"]?.value || "ALL",
    equipmentFilter: dom["directory-equipment-select"]?.value || "ALL",
    onlyAvailable: Boolean(dom["directory-only-available"]?.checked),
    searchQuery: dom["directory-search-input"]?.value || "",
    onOpenGuide: (ex) => openGuideModal(ex),
    onLoadPacer: (ex) => {
      if (state.session.exercises.length === 0) {
        applyPlanToSession(buildFreeSessionPlan([{ id: ex.id }], ex.name));
      } else {
        state.session.exercises.push({
          id: ex.id,
          block: state.session.exercises.length + 1,
          sets: ex.default_sets,
          reps: ex.default_reps,
          load: ex.default_load,
          is_timed: ex.is_timed,
          completion: 1,
        });
        renderStep2Session();
        loadExerciseIntoPacer(state.session.exercises.length - 1);
      }
      toggleCatalogDirectory(false);
      switchStep(2);
    },
    onAddToBuilder: (ex) => {
      state.freeDraft.push({
        id: ex.id,
        sets: ex.default_sets,
        reps: ex.default_reps,
        load: ex.default_load,
        is_timed: ex.is_timed,
      });
      toggleCatalogDirectory(false);
      openFreeBuilderModal();
    },
  });
}

function toggleCatalogDirectory(forceOpen) {
  const view = dom["catalog-directory-view"];
  if (!view) return;
  const open = typeof forceOpen === "boolean" ? forceOpen : view.hidden;
  view.hidden = !open;
  dom["open-catalog-directory-btn"]?.setAttribute("aria-expanded", String(open));
  if (open) {
    refreshDirectoryView();
    view.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function openGuideModal(ex) {
  if (!dom["guide-modal"] || !ex) return;
  if (dom["guide-modal-title"]) dom["guide-modal-title"].textContent = ex.name;
  if (dom["guide-modal-ref"]) dom["guide-modal-ref"].textContent = `Réf. : ${ex.science_ref}`;
  if (dom["guide-modal-setup"]) dom["guide-modal-setup"].textContent = ex.guide?.setup || ex.short_desc;

  if (dom["guide-modal-svg"]) {
    const p = ex.pacer_pattern ?? { inhale_s: 2, hold_in_s: 0, exhale_s: 4, hold_out_s: 0 };
    const cycleS = Math.max(
      2,
      (Number(p.inhale_s) || 0) + (Number(p.hold_in_s) || 0) + (Number(p.exhale_s) || 0) + (Number(p.hold_out_s) || 0)
    );
    const markup = buildBreathExerciseSvg(ex.guide?.svg_type ?? "diaphragm_360", {
      width: 360,
      height: 200,
      cycleDurationS: cycleS,
      title: ex.name,
    });
    mountSafeSvg(dom["guide-modal-svg"], markup);
  }

  if (dom["guide-modal-execution"]) {
    dom["guide-modal-execution"].replaceChildren();
    for (const stepText of ex.guide?.execution ?? []) {
      const li = document.createElement("li");
      li.textContent = stepText;
      dom["guide-modal-execution"].appendChild(li);
    }
  }

  if (dom["guide-modal-errors"]) {
    dom["guide-modal-errors"].replaceChildren();
    for (const errText of ex.guide?.errors ?? []) {
      const li = document.createElement("li");
      li.textContent = errText;
      dom["guide-modal-errors"].appendChild(li);
    }
  }

  dom["guide-modal"].hidden = false;
}

function populateFreeBuilderSelect() {
  const select = dom["free-builder-select"];
  if (!select) return;
  select.replaceChildren();
  for (const ex of CATALOG) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = `${ex.name} (${ex.default_sets}×${ex.default_reps}${ex.is_timed ? "s" : ""})`;
    select.appendChild(opt);
  }
}

function renderFreeBuilderList() {
  const container = dom["free-builder-items"];
  if (!container) return;
  container.replaceChildren();
  if (state.freeDraft.length === 0) {
    const p = document.createElement("p");
    p.className = "muted-note";
    p.textContent = "Ajoutez des exercices ci-dessus pour composer votre séance libre.";
    container.appendChild(p);
    return;
  }

  state.freeDraft.forEach((item, idx) => {
    const cat = getCatalogExercise(item.id);
    const row = document.createElement("div");
    row.className = "exercise-item";

    const head = document.createElement("div");
    head.className = "exercise-item-head";

    const label = document.createElement("strong");
    label.textContent = `${idx + 1}. ${cat?.name || item.id} (${item.sets}×${item.reps}${item.is_timed ? "s" : ""} @ ${item.load} ${cat?.unit_label || ""})`;

    const rmBtn = document.createElement("button");
    rmBtn.type = "button";
    rmBtn.className = "btn btn-coral btn-sm";
    rmBtn.textContent = "Retirer";
    rmBtn.addEventListener("click", () => {
      state.freeDraft.splice(idx, 1);
      renderFreeBuilderList();
    });

    head.append(label, rmBtn);
    row.appendChild(head);
    container.appendChild(row);
  });
}

function openFreeBuilderModal() {
  populateFreeBuilderSelect();
  renderFreeBuilderList();
  if (dom["free-builder-modal"]) dom["free-builder-modal"].hidden = false;
}

async function handleMarkdownImportSubmit() {
  const rawMd = String(dom["md-import-textarea"]?.value ?? "").trim();
  if (!rawMd) {
    showToast("Collez d'abord un texte Markdown de séance.", "error");
    return;
  }
  try {
    const res = await parseMarkdownWithGemini(
      rawMd,
      state.vault.GEMINI_API_KEY,
      state.vault.LLM_MODEL || "gemini-3.5-flash",
      { equipmentProfile: state.vault.BREATH_EQUIPMENT_PROFILE }
    );
    applyPlanToSession(res.plan);
    if (dom["md-import-modal"]) dom["md-import-modal"].hidden = true;
    switchStep(2);
    showToast(`Séance importée (${res.source}).`, "success");
  } catch (err) {
    showToast(`Erreur import Markdown : ${err.message}`, "error");
  }
}

/* =========================================================================
   INITIALISATION PACER / BOLT CHRONO & ÉVÉNEMENTS DOM
   ========================================================================= */
function initControllers() {
  pacer = new BreathPacer({
    ringProgressEl: dom["pacer-ring-progress"],
    orbEl: dom["pacer-orb"],
    phaseLabelEl: dom["pacer-phase-label"],
    phaseTimerEl: dom["pacer-phase-timer"],
    repCounterEl: dom["pacer-rep-counter"],
    setCounterEl: dom["pacer-set-counter"],
    exerciseNameEl: dom["pacer-exercise-name"],
    patternBadgeEl: dom["pacer-pattern-badge"],
    containerEl: dom["pacer-container"],
    onStateChange: (st) => {
      if (dom["pacer-toggle-btn"]) {
        dom["pacer-toggle-btn"].textContent =
          st.running && !st.paused ? "⏸ Pause Pacer" : "▶ Démarrer Pacer";
      }
    },
    onSessionComplete: () => {
      showToast("Bloc Pacer terminé !", "success");
    },
  });

  boltChrono = new BoltChrono({
    displayEl: dom["bolt-chrono-display"],
    hintEl: dom["bolt-chrono-hint"],
    toggleBtn: dom["bolt-toggle-btn"],
    saveBtn: dom["bolt-save-btn"],
    onSave: (boltSec) => {
      state.session.bolt_sec = boltSec;
      if (dom["input-bolt-sec"]) dom["input-bolt-sec"].value = String(boltSec);
      state.vault = saveVault({ BREATH_BOLT_SEC: boltSec });
      renderReadinessDashboard();
      showToast(`Score BOLT enregistré : ${boltSec} s.`, "success");
    },
  });
}

function bindEvents() {
  window.addEventListener("online", () => {
    updateNetworkStatusUI();
    refreshOutboxBadge();
  });
  window.addEventListener("offline", updateNetworkStatusUI);

  dom["nav-step-1"]?.addEventListener("click", () => switchStep(1));
  dom["nav-step-2"]?.addEventListener("click", () => switchStep(2));
  dom["nav-step-3"]?.addEventListener("click", () => switchStep(3));
  dom["go-step-3-btn"]?.addEventListener("click", () => switchStep(3));
  dom["back-step-2-btn"]?.addEventListener("click", () => switchStep(2));

  dom["outbox-flush-btn"]?.addEventListener("click", handleFlushOutbox);
  dom["intervals-status-pill"]?.addEventListener("click", openVaultDrawer);
  dom["gemini-status-pill"]?.addEventListener("click", openVaultDrawer);
  dom["open-vault-btn"]?.addEventListener("click", openVaultDrawer);
  dom["close-vault-btn"]?.addEventListener("click", closeVaultDrawer);
  dom["vault-backdrop"]?.addEventListener("click", closeVaultDrawer);

  dom["vault-save-btn"]?.addEventListener("click", saveVaultFromForm);
  dom["vault-detect-model-btn"]?.addEventListener("click", handleDetectGeminiModel);
  dom["vault-provision-fields-btn"]?.addEventListener("click", handleProvisionIntervalsFields);
  dom["vault-drive-sync-btn"]?.addEventListener("click", handleDriveSync);
  dom["vault-reset-btn"]?.addEventListener("click", () => {
    state.vault = resetVault();
    populateVaultForm();
    renderReadinessDashboard();
    renderStep1EquipmentAvailability();
    if (!dom["catalog-directory-view"]?.hidden) {
      refreshDirectoryView();
    }
    showToast("Profil matériel et références réinitialisés.", "info");
  });

  // Synchronisation immédiate des toggles matériel du Coffre-Fort -> Étape 1 & Catalogue
  dom["vault-equipment-toggles"]?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.equipKey) return;
    const profilePatch = {};
    const checkboxes = dom["vault-equipment-toggles"]?.querySelectorAll("input[type='checkbox']") ?? [];
    for (const cb of checkboxes) {
      if (cb.dataset.equipKey) {
        profilePatch[cb.dataset.equipKey] = cb.checked;
      }
    }
    applyEquipmentProfileSync(profilePatch, { renderVault: false });
  });

  // Synchronisation chips & presets matériel sur la page centrale (Étape 1)
  const equipCard = dom["equipment-availability-card"];
  if (equipCard) {
    equipCard.querySelectorAll("[data-equip-toggle]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const eqKey = chip.getAttribute("data-equip-toggle");
        if (!eqKey) return;
        const current = normalizeEquipmentProfile(state.vault.BREATH_EQUIPMENT_PROFILE);
        applyEquipmentProfileSync({
          ...current,
          [eqKey]: !Boolean(current[eqKey]),
        });
      });
    });

    equipCard.querySelectorAll("[data-equip-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetKey = btn.getAttribute("data-equip-preset");
        const preset = presetKey ? EQUIPMENT_PRESETS[presetKey] : null;
        if (!preset) return;
        applyEquipmentProfileSync({ ...preset });
      });
    });
  }

  dom["vault-export-btn"]?.addEventListener("click", () => {
    const json = exportVaultJson({ includeSecrets: false });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "webbreath-vault-export.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  dom["vault-import-btn"]?.addEventListener("click", () => dom["vault-import-input"]?.click());
  dom["vault-import-input"]?.addEventListener("change", async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      state.vault = importVaultJson(await file.text());
      populateVaultForm();
      updateTopbarPills();
      renderReadinessDashboard();
      renderStep1EquipmentAvailability();
      if (!dom["catalog-directory-view"]?.hidden) {
        refreshDirectoryView();
      }
      showToast("Coffre-Fort importé.", "success");
    } catch (err) {
      showToast(`Erreur import Vault : ${err.message}`, "error");
    }
  });

  dom["refresh-readiness-btn"]?.addEventListener("click", refreshReadinessFromIntervals);

  document.querySelectorAll("[data-gatekeeper-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-gatekeeper-mode");
      if (mode) handleGatekeeperSelect(mode);
    });
  });

  // Pacer & BOLT
  dom["pacer-toggle-btn"]?.addEventListener("click", () => pacer?.toggle());
  dom["pacer-stop-btn"]?.addEventListener("click", () => pacer?.stop());
  dom["pacer-mute-btn"]?.addEventListener("click", () => {
    if (!pacer) return;
    const nextMuted = !pacer.isMuted();
    pacer.setMuted(nextMuted);
    dom["pacer-mute-btn"].textContent = nextMuted ? "Audio : OFF" : "Audio : ON";
    dom["pacer-mute-btn"].setAttribute("aria-pressed", String(nextMuted));
  });

  dom["bolt-toggle-btn"]?.addEventListener("click", () => boltChrono?.toggle());
  dom["bolt-save-btn"]?.addEventListener("click", () => boltChrono?.save());

  // CSV K5 Dropzone & Import direct étape 1
  dom["step1-k5-import-btn"]?.addEventListener("click", () => dom["step1-k5-file-input"]?.click());
  dom["step1-k5-file-input"]?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    if (file) handleK5CsvFile(file, true);
  });

  const dz = dom["k5-dropzone"];
  if (dz) {
    dz.addEventListener("click", () => dom["k5-file-input"]?.click());
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        dom["k5-file-input"]?.click();
      }
    });
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("is-dragover");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleK5CsvFile(file, false);
    });
  }

  dom["k5-file-input"]?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    if (file) handleK5CsvFile(file, false);
  });
  dom["k5-clear-btn"]?.addEventListener("click", () => {
    state.k5Data = null;
    state.session.k5_summary = null;
    state.session.pressure_summary = state.smartAdapterData?.summary ?? null;
    renderK5TelemetryTable(null);
    renderFusionSummaryCard();
  });

  // Fusion TymeWear + Smart Adapter (Étape 2)
  dom["tymewear-import-csv-btn"]?.addEventListener("click", () => {
    dom["tymewear-file-input"]?.click();
  });
  dom["tymewear-file-input"]?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    if (file) handleTymewearCsvFile(file);
    if (e.target) e.target.value = "";
  });
  dom["tymewear-intervals-btn"]?.addEventListener("click", handleLoadTymewearFromIntervals);

  dom["smart-adapter-import-btn"]?.addEventListener("click", () => {
    dom["smart-adapter-file-input"]?.click();
  });
  dom["smart-adapter-file-input"]?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    if (file) handleSmartAdapterFile(file);
    if (e.target) e.target.value = "";
  });

  dom["fusion-clear-btn"]?.addEventListener("click", () => {
    state.tymewearData = null;
    state.smartAdapterData = null;
    state.session.tymewear_summary = null;
    state.session.pressure_summary = state.k5Data?.summary ?? null;
    if (dom["tymewear-file-input"]) dom["tymewear-file-input"].value = "";
    if (dom["smart-adapter-file-input"]) dom["smart-adapter-file-input"].value = "";
    renderFusionSummaryCard();
    showToast("Données TymeWear / Smart Adapter effacées.", "info");
  });

  // Catalogue & Modales
  dom["open-catalog-directory-btn"]?.addEventListener("click", () => toggleCatalogDirectory());
  dom["close-catalog-directory-btn"]?.addEventListener("click", () => toggleCatalogDirectory(false));
  dom["step2-add-exercise-btn"]?.addEventListener("click", openFreeBuilderModal);

  dom["directory-search-input"]?.addEventListener("input", refreshDirectoryView);
  dom["directory-category-select"]?.addEventListener("change", refreshDirectoryView);
  dom["directory-equipment-select"]?.addEventListener("change", refreshDirectoryView);
  dom["directory-only-available"]?.addEventListener("change", refreshDirectoryView);

  dom["close-guide-modal-btn"]?.addEventListener("click", () => {
    if (dom["guide-modal"]) dom["guide-modal"].hidden = true;
  });

  dom["open-free-builder-btn"]?.addEventListener("click", openFreeBuilderModal);
  dom["close-free-builder-btn"]?.addEventListener("click", () => {
    if (dom["free-builder-modal"]) dom["free-builder-modal"].hidden = true;
  });
  dom["free-builder-add-btn"]?.addEventListener("click", () => {
    const id = dom["free-builder-select"]?.value;
    const cat = getCatalogExercise(id);
    if (!cat) return;
    state.freeDraft.push({
      id: cat.id,
      sets: cat.default_sets,
      reps: cat.default_reps,
      load: cat.default_load,
      is_timed: cat.is_timed,
    });
    renderFreeBuilderList();
  });
  dom["free-builder-start-btn"]?.addEventListener("click", () => {
    if (state.freeDraft.length === 0) {
      showToast("Ajoutez au moins un exercice.", "error");
      return;
    }
    const plan = buildFreeSessionPlan(
      state.freeDraft,
      dom["free-builder-name-input"]?.value || "Séance Libre WebBreath"
    );
    applyPlanToSession(plan);
    if (dom["free-builder-modal"]) dom["free-builder-modal"].hidden = true;
    switchStep(2);
  });

  dom["open-md-import-btn"]?.addEventListener("click", () => {
    if (dom["md-import-modal"]) dom["md-import-modal"].hidden = false;
  });
  dom["close-md-import-btn"]?.addEventListener("click", () => {
    if (dom["md-import-modal"]) dom["md-import-modal"].hidden = true;
  });
  dom["md-import-submit-btn"]?.addEventListener("click", handleMarkdownImportSubmit);

  // Étape 3 Actions
  dom["copy-markdown-btn"]?.addEventListener("click", async () => {
    renderStep3Report();
    const md = state.lastBuiltReport?.markdown || "";
    try {
      await navigator.clipboard.writeText(md);
      showToast("Markdown & [TELEMETRY_JSON] copiés.", "success");
    } catch {
      showToast("Impossible d'accéder au presse-papier.", "error");
    }
  });
  dom["queue-outbox-btn"]?.addEventListener("click", handleQueueOutbox);
  dom["push-intervals-btn"]?.addEventListener("click", handlePushIntervals);
}

function init() {
  cacheDom();
  registerServiceWorker();
  updateNetworkStatusUI();
  updateTopbarPills();
  initDirectoryFilters();
  initControllers();
  bindEvents();
  renderReadinessDashboard();
  renderStep1EquipmentAvailability();
  renderFusionSummaryCard();
  refreshOutboxBadge();
  refreshReadinessFromIntervals();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}
