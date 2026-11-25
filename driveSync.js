/**
 * Module de synchronisation optionnelle des protocoles/exercices personnalisés WebBreath
 * vers Google Drive via un webhook Google Apps Script (CORS simple request sans preflight).
 * Zéro dépendance externe — compatible navigateur et Node.js ESM.
 */

export const DRIVE_APP_VERSION = "1.0.0";

/**
 * Résultat de validation d'une URL de webhook Google Drive.
 * @typedef {Object} DriveWebhookValidationResult
 * @property {boolean} valid Indique si l'URL est utilisable en HTTPS sans identifiants intégrés.
 * @property {string} url URL nettoyée ou chaîne vide si absente.
 * @property {boolean} isAppsScript Indique si l'URL cible un déploiement Google Apps Script (`/macros/s/`).
 * @property {string | null} error Message d'erreur en français ou `null` si valide.
 */

/**
 * Formate un entier sur 2 chiffres avec zéro initial.
 * @param {number} value
 * @returns {string}
 */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Valide l'URL d'un webhook Google Drive (HTTPS strict, sans identifiants intégrés).
 * @param {unknown} url
 * @returns {DriveWebhookValidationResult}
 */
export function validateDriveWebhookUrl(url) {
  if (typeof url !== "string") {
    return {
      valid: false,
      url: "",
      isAppsScript: false,
      error: "L'URL du webhook Google Drive doit être une chaîne de caractères.",
    };
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      url: "",
      isAppsScript: false,
      error: "L'URL du webhook Google Drive est vide.",
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive est malformée.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive doit utiliser le protocole HTTPS.",
    };
  }

  if (!parsed.hostname) {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive ne contient pas de nom d'hôte valide.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive ne doit pas contenir d'identifiants intégrés.",
    };
  }

  const isAppsScript =
    (parsed.hostname === "script.google.com" &&
      parsed.pathname.startsWith("/macros/s/")) ||
    parsed.hostname === "script.googleusercontent.com";

  if (!isAppsScript) {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error:
        "L'URL du webhook Google Drive doit cibler un déploiement Google Apps Script HTTPS (script.google.com/macros/s/... ou script.googleusercontent.com).",
    };
  }

  return {
    valid: true,
    url: trimmed,
    isAppsScript: true,
    error: null,
  };
}

/**
 * Construit le nom de fichier horodaté en heure locale pour l'export Drive WebBreath.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function buildDriveExportFilename(date = new Date()) {
  const safeDate =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();

  const year = String(safeDate.getFullYear());
  const month = pad2(safeDate.getMonth() + 1);
  const day = pad2(safeDate.getDate());
  const hours = pad2(safeDate.getHours());
  const minutes = pad2(safeDate.getMinutes());
  const seconds = pad2(safeDate.getSeconds());

  return `webbreath-custom-exercises-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}

/**
 * Analyse et valide la structure des exercices personnalisés à exporter.
 * @param {unknown} exercisesJson
 * @returns {{ parsed: Array<unknown> | Record<string, unknown>, count: number }}
 */
function parseAndCountExercises(exercisesJson) {
  let parsed = exercisesJson;
  if (typeof exercisesJson === "string") {
    try {
      parsed = JSON.parse(exercisesJson);
    } catch (err) {
      throw new Error(
        `Le JSON des exercices personnalisés est invalide : ${err.message}`
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Aucun exercice personnalisé à envoyer sur Drive.");
  }

  const count = Array.isArray(parsed)
    ? parsed.length
    : Object.keys(parsed).length;

  if (count <= 0) {
    throw new Error("Aucun exercice personnalisé à envoyer sur Drive.");
  }

  return {
    parsed: /** @type {Array<unknown> | Record<string, unknown>} */ (parsed),
    count,
  };
}

/**
 * Envoie les exercices personnalisés vers le webhook Google Drive via une requête CORS simple.
 * @param {object} [options]
 * @param {string} options.webhookUrl
 * @param {string} [options.secret=""]
 * @param {string | Array<unknown> | Record<string, unknown>} options.exercisesJson
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch]
 * @param {number} [options.timeoutMs=15000]
 * @param {Date} [options.now=new Date()]
 * @returns {Promise<{ ok: true, fileId: string, fileName: string, folderName: string, count: number }>}
 */
export async function pushCustomExercisesToDrive({
  webhookUrl,
  secret = "",
  exercisesJson,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  now = new Date(),
} = {}) {
  const check = validateDriveWebhookUrl(webhookUrl);
  if (!check.valid) {
    throw new Error(check.error || "URL de webhook Google Drive invalide.");
  }

  const { parsed, count } = parseAndCountExercises(exercisesJson);

  if (typeof fetchImpl !== "function") {
    throw new Error("Client fetch indisponible pour l'envoi vers Google Drive.");
  }

  const safeNow =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const filename = buildDriveExportFilename(safeNow);
  const effectiveTimeoutMs = Math.max(50, Number(timeoutMs) || 15000);

  const controller = new AbortController();
  let timedOut = false;
  const timerId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);

  let response;
  try {
    // Requête CORS simple sans preflight OPTIONS : text/plain + aucun en-tête personnalisé.
    response = await fetchImpl(check.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
      signal: controller.signal,
      body: JSON.stringify({
        secret: String(secret ?? "").trim(),
        filename,
        exported_at: safeNow.toISOString(),
        app_version: DRIVE_APP_VERSION,
        app: "webbreath",
        exercises: parsed,
      }),
    });
  } catch (err) {
    if (timedOut || (err && err.name === "AbortError")) {
      throw new Error(
        `Timeout webhook Google Drive dépassé (${effectiveTimeoutMs} ms).`
      );
    }
    const reason = err instanceof Error && err.message ? err.message : String(err);
    throw new Error(
      `Échec réseau lors de l'envoi vers le webhook Google Drive : ${reason}`
    );
  } finally {
    clearTimeout(timerId);
  }

  if (!response.ok) {
    throw new Error(
      `Erreur HTTP du webhook Google Drive (${response.status}${response.statusText ? ` ${response.statusText}` : ""}).`
    );
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      "Réponse non-JSON reçue du webhook Google Drive (vérifiez le déploiement et les accès Apps Script)."
    );
  }

  if (!data || data.ok !== true) {
    throw new Error(data?.error || "Réponse négative du webhook Google Drive");
  }

  return {
    ok: true,
    fileId: String(data.fileId ?? ""),
    fileName: String(data.fileName ?? filename),
    folderName: String(data.folderName ?? ""),
    count: Number(data.count ?? count),
  };
}
