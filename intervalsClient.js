/**
 * Client HTTP Intervals.icu pour WebBreath (ES2024+ natif zéro-build).
 * Gère l'authentification Basic, le backoff exponentiel avec jitter (429 / 5xx),
 * le provisioning des 4 champs d'activité respiratoires, l'extraction du contexte
 * physiologique 7 jours (HRV, sommeil, TSB, charge vélo, dernière séance WebBreath)
 * et la publication manuelle d'activités.
 */

import {
  buildSessionMarkdownAndPayload,
  parseTelemetryJsonFromDescription,
} from "./engine.js";
import { extractTymewearFromIntervalsStreams } from "./telemetryFusion.js";

export const INTERVALS_BASE_URL = "https://intervals.icu/api/v1";

/**
 * Définition immuable des 4 champs personnalisés requis sur Intervals.icu.
 */
export const CUSTOM_ACTIVITY_FIELDS = Object.freeze([
  Object.freeze({
    code: "RespWorkJ",
    name: "Resp Work J",
    type: "numeric",
    units: "J",
    aggregate: "SUM",
  }),
  Object.freeze({
    code: "RespStrainIndex",
    name: "Resp Strain Index",
    type: "numeric",
    units: "AU",
    aggregate: "SUM",
  }),
  Object.freeze({
    code: "RespSIndex",
    name: "Resp S-Index",
    type: "numeric",
    units: "cmH2O",
    aggregate: "MAX",
  }),
  Object.freeze({
    code: "RespBoltSec",
    name: "Resp BOLT Sec",
    type: "numeric",
    units: "s",
    aggregate: "MAX",
  }),
]);

const BIKE_ACTIVITY_TYPES = new Set([
  "Ride",
  "VirtualRide",
  "MountainBikeRide",
  "GravelRide",
]);

/**
 * Encode une chaîne UTF-8 en Base64 de façon compatible navigateur (`btoa`) et Node.js (`Buffer`).
 * @param {string} str
 * @returns {string}
 */
function encodeBase64(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Construit l'en-tête HTTP `Authorization: Basic ...` pour Intervals.icu.
 * @param {string} apiKey
 * @returns {string}
 */
function buildBasicAuthHeader(apiKey) {
  const cleanKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!cleanKey) {
    throw new Error("Clé API Intervals.icu manquante.");
  }
  return `Basic ${encodeBase64(`API_KEY:${cleanKey}`)}`;
}

/**
 * Normalise et valide l'identifiant athlète pour les URLs REST Intervals.icu.
 * Accepte uniquement `"0"` ou `"i?[0-9]+"`.
 * @param {string | number} athleteId
 * @returns {string}
 */
function normalizeAthleteId(athleteId) {
  const raw =
    athleteId === undefined || athleteId === null
      ? "0"
      : String(athleteId).trim();
  const clean = raw === "" ? "0" : raw;
  if (!/^(0|i?\d+)$/.test(clean)) {
    throw new Error(
      `Identifiant athlète Intervals.icu invalide (attendu "0" ou "i?<chiffres>") : "${clean}"`
    );
  }
  return encodeURIComponent(clean);
}

/**
 * Défense anti-prompt injection : supprime balises HTML et caractères de contrôle,
 * puis tronque proprement à `maxLen` caractères.
 * @param {unknown} v
 * @param {number} [maxLen=180]
 * @returns {string}
 */
export function sanitizeText(v, maxLen = 180) {
  if (v === null || v === undefined) return "";
  const cleaned = String(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (maxLen > 0 && cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen).trimEnd();
  }
  return cleaned;
}

/**
 * Supprime uniquement les caractères de contrôle dangereux tout en préservant
 * les sauts de ligne pour `parseTelemetryJsonFromDescription`.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeMultilineRaw(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Calcule le délai d'attente (ms) à partir de l'en-tête `Retry-After` s'il est présent.
 * @param {string | null} retryAfterHeader
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000);
  }
  const targetMs = Date.parse(trimmed);
  if (Number.isFinite(targetMs)) {
    return Math.max(0, Math.min(targetMs - Date.now(), 30000));
  }
  return null;
}

/**
 * Pause asynchrone compatible annulation par `AbortSignal`.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Requête annulée"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("Requête annulée"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exécute un appel `fetch` JSON avec backoff exponentiel + jitter sur HTTP 429,
 * HTTP 5xx et erreurs réseau transitoires.
 * @param {string} url
 * @param {RequestInit & { fetchImpl?: typeof globalThis.fetch }} [options={}]
 * @param {number} [maxRetries=3]
 * @returns {Promise<any>}
 */
export async function fetchJsonWithBackoff(url, options = {}, maxRetries = 3) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 10000,
    ...fetchOptions
  } = options ?? {};
  if (typeof fetchImpl !== "function") {
    throw new Error("Client fetch indisponible.");
  }

  const effectiveTimeoutMs =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : 10000;

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const parentSignal = fetchOptions.signal;
    const onParentAbort = () => controller.abort(parentSignal?.reason);

    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      controller.abort(
        new Error(`Timeout Intervals.icu dépassé (${effectiveTimeoutMs} ms)`)
      );
    }, effectiveTimeoutMs);

    try {
      let response;
      let text = "";
      try {
        response = await fetchImpl(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        if (response.ok) {
          if (response.status === 204) return null;
          text = await response.text();
        } else {
          const isRateLimit = response.status === 429;
          const isServerErr = response.status >= 500 && response.status < 600;
          if (!(isRateLimit || isServerErr) || attempt >= maxRetries) {
            let errorSnippet = "";
            try {
              errorSnippet = sanitizeText(await response.text(), 160);
            } catch {
              errorSnippet = "";
            }
            throw new Error(
              `Erreur HTTP ${response.status} Intervals.icu${errorSnippet ? ` : ${errorSnippet}` : ""}`
            );
          }
        }
      } finally {
        clearTimeout(timer);
        if (parentSignal) {
          parentSignal.removeEventListener("abort", onParentAbort);
        }
      }

      if (response.ok) {
        if (!text || text.trim().length === 0) return null;
        try {
          return JSON.parse(text);
        } catch (err) {
          throw new Error(
            `Réponse JSON invalide depuis Intervals.icu : ${err.message}`
          );
        }
      }

      const isRateLimit = response.status === 429;
      const retryAfter = isRateLimit
        ? parseRetryAfterMs(response.headers?.get?.("Retry-After") ?? null)
        : null;
      const baseDelay = 400 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      const delayMs =
        retryAfter !== null ? retryAfter + jitter : baseDelay + jitter;
      attempt += 1;
      await sleep(delayMs, parentSignal);
      continue;
    } catch (err) {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
      const isAbort =
        err?.name === "AbortError" ||
        Boolean(parentSignal?.aborted) ||
        controller.signal.aborted;
      const isFormattedHttpError =
        err instanceof Error && err.message.startsWith("Erreur HTTP ");
      const isInvalidJsonError =
        err instanceof Error &&
        err.message.startsWith("Réponse JSON invalide");

      if (
        isAbort ||
        isFormattedHttpError ||
        isInvalidJsonError ||
        attempt >= maxRetries
      ) {
        throw err;
      }

      const baseDelay = 400 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      attempt += 1;
      await sleep(baseDelay + jitter, parentSignal);
    }
  }
}

/**
 * Formate une date en `YYYY-MM-DD` (heure locale).
 * @param {Date} dateObj
 * @returns {string}
 */
function formatLocalYmd(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Retourne une nouvelle Date décalée de `deltaDays` jours.
 * @param {Date} dateObj
 * @param {number} deltaDays
 * @returns {Date}
 */
function addDays(dateObj, deltaDays) {
  const copy = new Date(dateObj.getTime());
  copy.setDate(copy.getDate() + deltaDays);
  return copy;
}

/**
 * Extrait un nombre fini ou `null`.
 * @param {unknown} val
 * @returns {number | null}
 */
function toFiniteOrNull(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convertit une valeur en nombre fini borné dans `[min, max]`, ou retourne `fallback`.
 * @param {unknown} val
 * @param {number} min
 * @param {number} max
 * @param {number | null} [fallback=null]
 * @returns {number | null}
 */
function clampFinite(val, min, max, fallback = null) {
  if (val === null || val === undefined || val === "") return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Déduit l'état de préparation physiologique (`OPTIMAL`, `MODERATE`, `COMPROMISED`).
 * @param {object} params
 * @param {number | null} params.hrv_ratio
 * @param {number | null} params.sleep_hours
 * @param {number | null} params.tsb
 * @param {number | null} params.readiness_score
 * @returns {"OPTIMAL" | "MODERATE" | "COMPROMISED"}
 */
function deduceReadiness({ hrv_ratio, sleep_hours, tsb, readiness_score }) {
  if (
    (readiness_score !== null && readiness_score < 50) ||
    (hrv_ratio !== null && hrv_ratio < 0.85) ||
    (sleep_hours !== null && sleep_hours < 5.5) ||
    (tsb !== null && tsb < -25)
  ) {
    return "COMPROMISED";
  }

  if (
    (readiness_score !== null && readiness_score < 75) ||
    (hrv_ratio !== null && hrv_ratio < 0.95) ||
    (sleep_hours !== null && sleep_hours < 6.5) ||
    (tsb !== null && tsb < -10)
  ) {
    return "MODERATE";
  }

  return "OPTIMAL";
}

/**
 * Détermine si une activité Intervals.icu provient de WebBreath.
 * @param {Record<string, unknown> | null | undefined} act
 * @returns {boolean}
 */
function isWebBreathActivity(act) {
  if (!act || typeof act !== "object") return false;
  if (typeof act.external_id === "string" && act.external_id.startsWith("pwa_breath_")) {
    return true;
  }
  if (toFiniteOrNull(act.RespStrainIndex) !== null || toFiniteOrNull(act.RespWorkJ) !== null) {
    return true;
  }
  const name = typeof act.name === "string" ? act.name : "";
  if (/webbreath/i.test(name)) {
    return true;
  }
  const desc = typeof act.description === "string" ? act.description : "";
  return desc.includes('"app":"webbreath"') || desc.includes('"app": "webbreath"');
}

/**
 * Vérifie la présence des 4 champs personnalisés `CUSTOM_ACTIVITY_FIELDS` sur
 * Intervals.icu et crée uniquement ceux qui manquent (sauf en mode `dryRun`).
 * @param {object | string} arg1
 * @param {string} [arg2]
 * @param {object} [arg3]
 */
export async function ensureCustomActivityFields(arg1, arg2, arg3 = {}) {
  let athleteId = "0";
  let apiKey = "";
  let dryRun = false;
  let fetchImpl = globalThis.fetch;

  if (arg1 && typeof arg1 === "object") {
    athleteId = String(arg1.athleteId || "0").trim();
    apiKey = String(arg1.apiKey || "").trim();
    dryRun = Boolean(arg1.dryRun);
    if (typeof arg1.fetchImpl === "function") fetchImpl = arg1.fetchImpl;
  } else {
    athleteId = String(arg1 || "0").trim();
    apiKey = String(arg2 || "").trim();
    dryRun = Boolean(arg3 && arg3.dryRun);
    if (arg3 && typeof arg3.fetchImpl === "function") fetchImpl = arg3.fetchImpl;
  }

  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);
  const endpoint = `${INTERVALS_BASE_URL}/athlete/${aid}/custom-item`;

  const existingItems = await fetchJsonWithBackoff(endpoint, {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
    fetchImpl,
  });

  const existingSet = new Set(
    (Array.isArray(existingItems) ? existingItems : []).flatMap((item) =>
      [item?.code, item?.name, item?.content?.code].filter(Boolean)
    )
  );

  const result = {
    checked: CUSTOM_ACTIVITY_FIELDS.length,
    existing: [],
    created: [],
    errors: [],
    dryRun,
    wouldCreate: [],
  };

  for (const field of CUSTOM_ACTIVITY_FIELDS) {
    if (existingSet.has(field.code) || existingSet.has(field.name)) {
      result.existing.push(field.code);
      continue;
    }
    if (dryRun) {
      result.wouldCreate.push(field.code);
      continue;
    }

    const candidatePayloads = [
      {
        type: "ACTIVITY_FIELD",
        name: field.name,
        units: field.units,
        content: {
          code: field.code,
          name: field.name,
          label: field.name,
          type: "NUMBER",
          units: field.units,
          aggregate: field.aggregate,
        },
      },
      {
        type: "ACTIVITY_FIELD",
        name: field.name,
        content: {
          code: field.code,
          name: field.name,
          type: "numeric",
          units: field.units,
        },
      },
      {
        type: "ACTIVITY_FIELD",
        name: field.code,
        content: {
          code: field.code,
          units: field.units,
        },
      },
    ];

    let createdOk = false;
    let lastErr = "Erreur inconnue";

    for (const candidate of candidatePayloads) {
      try {
        const postRes = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(candidate),
        });
        if (postRes.ok) {
          createdOk = true;
          break;
        }
        const errBody = sanitizeText(await postRes.text(), 160);
        lastErr = `Erreur HTTP ${postRes.status} Intervals.icu : ${errBody}`;
        if (postRes.status !== 422) {
          break;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    if (createdOk) {
      result.created.push(field.code);
    } else {
      result.errors.push({ code: field.code, error: lastErr });
    }
  }

  return result;
}

/**
 * Récupère le contexte physiologique 7 jours (HRV, sommeil, TSB, charge vélo 7j,
 * dernière séance WebBreath) depuis Intervals.icu.
 * Accepte `(athleteId, apiKey, options)` ou `({ athleteId, apiKey, now, fetchImpl })`.
 * @param {string | number | object} arg1
 * @param {string} [arg2]
 * @param {object} [arg3]
 */
export async function fetchPhysioContext(arg1, arg2, arg3 = {}) {
  let athleteId = "0";
  let apiKey = "";
  let now = new Date();
  let fetchImpl = globalThis.fetch;

  if (arg1 && typeof arg1 === "object" && !(arg1 instanceof Date)) {
    athleteId = arg1.athleteId ?? "0";
    apiKey = arg1.apiKey ?? "";
    now = arg1.now ?? new Date();
    if (typeof arg1.fetchImpl === "function") fetchImpl = arg1.fetchImpl;
  } else {
    athleteId = arg1 ?? "0";
    apiKey = arg2 ?? "";
    now = arg3?.now ?? new Date();
    if (typeof arg3?.fetchImpl === "function") fetchImpl = arg3.fetchImpl;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);

  const j0 = formatLocalYmd(nowDate);
  const j1 = formatLocalYmd(addDays(nowDate, -1));
  const j7 = formatLocalYmd(addDays(nowDate, -7));

  const headers = {
    Authorization: authHeader,
    Accept: "application/json",
  };

  const [wellnessRaw, activitiesRaw] = await Promise.all([
    fetchJsonWithBackoff(
      `${INTERVALS_BASE_URL}/athlete/${aid}/wellness?oldest=${j7}&newest=${j0}`,
      { method: "GET", headers, fetchImpl }
    ),
    fetchJsonWithBackoff(
      `${INTERVALS_BASE_URL}/athlete/${aid}/activities?oldest=${j7}&newest=${j0}`,
      { method: "GET", headers, fetchImpl }
    ),
  ]);

  const wellnessList = (Array.isArray(wellnessRaw) ? wellnessRaw : [])
    .filter((w) => w && typeof w === "object")
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));

  const latestWellness =
    wellnessList.find((w) => w.id === j0) ??
    (wellnessList.length > 0 ? wellnessList[wellnessList.length - 1] : null);

  const hrvValues = wellnessList
    .map((w) => clampFinite(w.hrv, 0, 500, null))
    .filter((v) => v !== null && v > 0);

  const rawHrvJ0 = clampFinite(latestWellness?.hrv, 0, 500, null);
  const hrv_j0 = rawHrvJ0 !== null && rawHrvJ0 > 0 ? rawHrvJ0 : null;
  const hrv_7d_avg =
    hrvValues.length > 0
      ? Math.round(
          (hrvValues.reduce((acc, v) => acc + v, 0) / hrvValues.length) * 10
        ) / 10
      : null;
  const hrv_ratio =
    hrv_j0 !== null && hrv_7d_avg !== null && hrv_7d_avg > 0
      ? Math.round((hrv_j0 / hrv_7d_avg) * 1000) / 1000
      : null;

  const sleep_secs = clampFinite(
    latestWellness?.sleepSecs ?? latestWellness?.sleep_secs,
    0,
    86400,
    null
  );
  const sleep_hours =
    sleep_secs !== null ? Math.round((sleep_secs / 3600) * 100) / 100 : null;
  const sleep_score = clampFinite(
    latestWellness?.sleepScore ?? latestWellness?.sleep_score,
    0,
    100,
    null
  );
  const sleep_quality = clampFinite(
    latestWellness?.sleepQuality ?? latestWellness?.sleep_quality,
    0,
    100,
    null
  );

  const resting_hr = clampFinite(
    latestWellness?.restingHR ?? latestWellness?.resting_hr,
    20,
    220,
    null
  );
  const ctl = clampFinite(latestWellness?.ctl, 0, 500, null);
  const atl = clampFinite(latestWellness?.atl, 0, 500, null);
  const rawTsb = clampFinite(latestWellness?.tsb, -200, 200, null);
  const tsb =
    rawTsb ??
    (ctl !== null && atl !== null
      ? clampFinite(Math.round((ctl - atl) * 10) / 10, -200, 200, null)
      : null);
  const readiness_score = clampFinite(
    latestWellness?.readiness ?? latestWellness?.readinessScore,
    0,
    100,
    null
  );

  const activities = Array.isArray(activitiesRaw) ? activitiesRaw : [];

  let yesterdayBikeSeconds = 0;
  let last7dBikeLoad = 0;

  for (const act of activities) {
    if (!act || !BIKE_ACTIVITY_TYPES.has(act.type)) continue;
    const actDate = String(act.start_date_local ?? act.start_date ?? "").slice(
      0,
      10
    );
    if (actDate === j1) {
      yesterdayBikeSeconds += clampFinite(act.moving_time, 0, 86400, 0);
    }
    last7dBikeLoad += clampFinite(act.icu_training_load, 0, 2000, 0);
  }

  const yesterday_bike_hours =
    Math.round((yesterdayBikeSeconds / 3600) * 100) / 100;
  const last_7d_bike_load = Math.round(last7dBikeLoad);

  const breathActivities = activities
    .filter((act) => isWebBreathActivity(act))
    .sort((a, b) =>
      String(b.start_date_local ?? b.start_date ?? "").localeCompare(
        String(a.start_date_local ?? a.start_date ?? "")
      )
    );

  let lastBreathRaw = breathActivities[0] ?? null;
  let rawDescription = sanitizeMultilineRaw(lastBreathRaw?.description);

  if (lastBreathRaw && !rawDescription && lastBreathRaw.id) {
    try {
      const detail = await fetchJsonWithBackoff(
        `${INTERVALS_BASE_URL}/activity/${encodeURIComponent(lastBreathRaw.id)}`,
        { method: "GET", headers, fetchImpl }
      );
      if (detail && typeof detail === "object") {
        lastBreathRaw = { ...lastBreathRaw, ...detail };
        rawDescription = sanitizeMultilineRaw(detail.description);
      }
    } catch {
      // Dégradation gracieuse si le détail est inaccessible
    }
  }

  let hours_since_last_breath = null;
  if (lastBreathRaw?.start_date_local || lastBreathRaw?.start_date) {
    const startMs = Date.parse(
      lastBreathRaw.start_date_local ?? lastBreathRaw.start_date
    );
    if (Number.isFinite(startMs)) {
      const diffHours = Math.max(0, (nowDate.getTime() - startMs) / 3600000);
      hours_since_last_breath = Math.round(diffHours * 10) / 10;
    }
  }

  const last_session_telemetry =
    parseTelemetryJsonFromDescription(rawDescription);

  const last_breath_activity = lastBreathRaw
    ? {
        id: sanitizeText(lastBreathRaw.id, 80),
        name: sanitizeText(lastBreathRaw.name, 120),
        start_date_local:
          lastBreathRaw.start_date_local != null
            ? sanitizeText(lastBreathRaw.start_date_local, 40)
            : null,
        moving_time: clampFinite(lastBreathRaw.moving_time, 0, 86400, null),
        icu_training_load: clampFinite(
          lastBreathRaw.icu_training_load,
          0,
          2000,
          null
        ),
        RespWorkJ: clampFinite(lastBreathRaw.RespWorkJ, 0, 50000, null),
        RespStrainIndex: clampFinite(lastBreathRaw.RespStrainIndex, 0, 1000, null),
        RespSIndex: clampFinite(lastBreathRaw.RespSIndex, 0, 350, null),
        RespBoltSec: clampFinite(lastBreathRaw.RespBoltSec, 0, 300, null),
      }
    : null;

  const readiness = deduceReadiness({
    hrv_ratio,
    sleep_hours,
    tsb,
    readiness_score,
  });

  return {
    fetched_at: nowDate.toISOString(),
    hrv_j0,
    hrv_7d_avg,
    hrv_ratio,
    resting_hr,
    sleep_secs,
    sleep_hours,
    sleep_score,
    sleep_quality,
    tsb,
    ctl,
    atl,
    readiness_score,
    yesterday_bike_hours,
    last_7d_bike_load,
    last_breath_activity,
    hours_since_last_breath,
    last_session_telemetry,
    readiness,
  };
}

/**
 * Publie une séance respiratoire WebBreath sur Intervals.icu (`POST /activities/manual`),
 * puis synchronise les 4 champs personnalisés (`PUT /activity/{id}`).
 * @param {object} params
 * @param {string | number} [params.athleteId="0"]
 * @param {string} params.apiKey
 * @param {object} [params.session]
 * @param {object} [params.metrics]
 * @param {object} [params.payload]
 * @param {typeof globalThis.fetch} [params.fetchImpl=globalThis.fetch]
 * @returns {Promise<any>}
 */
export async function publishBreathWorkout({
  athleteId = "0",
  apiKey,
  session,
  metrics,
  payload,
  fetchImpl = globalThis.fetch,
}) {
  const finalPayload =
    payload && typeof payload === "object"
      ? payload
      : buildSessionMarkdownAndPayload(session ?? {}, metrics ?? null).payload;

  if (!finalPayload || typeof finalPayload !== "object") {
    throw new Error("Payload d'activité WebBreath invalide.");
  }

  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);
  const endpoint = `${INTERVALS_BASE_URL}/athlete/${aid}/activities/manual`;

  const created = await fetchJsonWithBackoff(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(finalPayload),
    fetchImpl,
  });

  const hasCustomField =
    finalPayload.RespWorkJ !== undefined ||
    finalPayload.RespStrainIndex !== undefined ||
    finalPayload.RespSIndex !== undefined ||
    finalPayload.RespBoltSec !== undefined;

  if (
    created?.id !== undefined &&
    created?.id !== null &&
    String(created.id).trim() !== "" &&
    hasCustomField
  ) {
    try {
      const activityEndpoint = `${INTERVALS_BASE_URL}/activity/${encodeURIComponent(String(created.id))}`;
      await fetchJsonWithBackoff(activityEndpoint, {
        method: "PUT",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          icu_training_load: finalPayload.icu_training_load,
          RespWorkJ: finalPayload.RespWorkJ,
          RespStrainIndex: finalPayload.RespStrainIndex,
          RespSIndex: finalPayload.RespSIndex,
          ...(finalPayload.RespBoltSec !== undefined
            ? { RespBoltSec: finalPayload.RespBoltSec }
            : {}),
        }),
        fetchImpl,
      });
    } catch {
      // Silencieux afin de ne jamais masquer la création réussie de l'activité
    }
  }

  return created;
}

/**
 * Récupère la dernière activité récente (aujourd'hui ou 48 h) sur Intervals.icu,
 * charge ses streams (`/activity/{id}/streams`) avec backoff et timeout 10 s,
 * puis extrait le résumé ventilatoire TymeWear.
 * Accepte `(athleteId, apiKey, options)` ou `({ athleteId, apiKey, now, fetchImpl })`.
 * @param {string | number | object} arg1
 * @param {string} [arg2]
 * @param {object} [arg3]
 */
export async function fetchLatestTymewearStreams(arg1, arg2, arg3 = {}) {
  let athleteId = "0";
  let apiKey = "";
  let now = new Date();
  let fetchImpl = globalThis.fetch;

  if (arg1 && typeof arg1 === "object" && !(arg1 instanceof Date)) {
    athleteId = arg1.athleteId ?? "0";
    apiKey = arg1.apiKey ?? "";
    now = arg1.now ?? new Date();
    if (typeof arg1.fetchImpl === "function") fetchImpl = arg1.fetchImpl;
  } else {
    athleteId = arg1 ?? "0";
    apiKey = arg2 ?? "";
    now = arg3?.now ?? new Date();
    if (typeof arg3?.fetchImpl === "function") fetchImpl = arg3.fetchImpl;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);
  const newest = formatLocalYmd(nowDate);
  const oldest = formatLocalYmd(addDays(nowDate, -2));

  const headers = {
    Authorization: authHeader,
    Accept: "application/json",
  };

  let activities = await fetchJsonWithBackoff(
    `${INTERVALS_BASE_URL}/athlete/${aid}/activities?oldest=${oldest}&newest=${newest}`,
    { method: "GET", headers, fetchImpl, timeoutMs: 10000 }
  );

  let candidates = (Array.isArray(activities) ? activities : [])
    .filter((a) => a && typeof a === "object" && a.id !== undefined && a.id !== null)
    .sort((a, b) =>
      String(b.start_date_local ?? b.start_date ?? "").localeCompare(
        String(a.start_date_local ?? a.start_date ?? "")
      )
    );

  if (candidates.length === 0) {
    const events = await fetchJsonWithBackoff(
      `${INTERVALS_BASE_URL}/athlete/${aid}/events?oldest=${oldest}&newest=${newest}`,
      { method: "GET", headers, fetchImpl, timeoutMs: 10000 }
    );
    candidates = (Array.isArray(events) ? events : [])
      .filter((ev) => ev && typeof ev === "object" && ev.paired_activity_id != null)
      .sort((a, b) =>
        String(b.start_date_local ?? "").localeCompare(String(a.start_date_local ?? ""))
      )
      .map((ev) => ({
        id: ev.paired_activity_id,
        name: ev.name,
        start_date_local: ev.start_date_local,
      }));
  }

  if (candidates.length === 0) {
    throw new Error("Aucune activité récente (48 h) trouvée sur Intervals.icu.");
  }

  let lastErr = null;
  for (const act of candidates.slice(0, 3)) {
    try {
      const streams = await fetchJsonWithBackoff(
        `${INTERVALS_BASE_URL}/activity/${encodeURIComponent(String(act.id))}/streams`,
        { method: "GET", headers, fetchImpl, timeoutMs: 10000 }
      );
      const summary = extractTymewearFromIntervalsStreams(streams);
      return {
        ...summary,
        activityId: sanitizeText(act.id, 80),
        activityName: sanitizeText(act.name, 120),
        startDateLocal:
          act.start_date_local != null ? sanitizeText(act.start_date_local, 40) : null,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Aucun stream ventilatoire TymeWear disponible sur les activités récentes.");
}
