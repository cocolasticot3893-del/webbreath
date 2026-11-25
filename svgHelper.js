/**
 * Generateur de SVG parametriques animes et assainis pour WebBreath.
 * Module ES2024+ zero-build compatible Navigateur et Node.js ESM.
 */

export const SVG_TYPES = Object.freeze([
  "k5_pressure",
  "isocapnic_bag",
  "airofit_dual",
  "ex1_expiratory",
  "vagal_wave",
  "spo2_apnea",
  "nasal_flow",
  "tymewear_belt",
  "diaphragm_360",
]);

/**
 * Echappe les caracteres speciaux XML/HTML pour injection sure dans les noeuds texte ou attributs SVG.
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Valide une couleur CSS simple (hex, rgb/rgba, hsl, nom CSS alphanumerique).
 * @param {unknown} color
 * @param {string} fallback
 * @returns {string}
 */
function safeColor(color, fallback) {
  if (typeof color !== "string") {
    return fallback;
  }
  const trimmed = color.trim();
  if (
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^(rgb|hsl)a?\(\s*[0-9.,%\s]+\)$/.test(trimmed) ||
    /^[a-zA-Z]{3,24}$/.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

/**
 * Assainit un balisage SVG contre les vecteurs XSS (<script>, <foreignObject>, on*, javascript:).
 * @param {string} markup
 * @returns {string}
 */
export function sanitizeSvgMarkup(markup) {
  if (typeof markup !== "string" || !markup) {
    return "";
  }

  let clean = markup;

  // Suppression des balises dangereuses (paires et auto-fermantes)
  const dangerousTags = [
    "script",
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
  ];
  for (const tag of dangerousTags) {
    const pairRegex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const selfClosingRegex = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    clean = clean.replace(pairRegex, "").replace(selfClosingRegex, "");
  }

  // Suppression des gestionnaires d'evenements inline (onclick, onload, onerror, etc.)
  clean = clean.replace(
    /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );

  // Neutralisation des schemas javascript:, vbscript: et data:text/html dans les attributs
  clean = clean.replace(
    /(href|xlink:href|src|action|formaction|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (full, attr, dqVal, sqVal) => {
      const val = dqVal ?? sqVal ?? "";
      const decoded = val.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
      if (
        decoded.includes("javascript:") ||
        decoded.includes("vbscript:") ||
        decoded.includes("data:text/html")
      ) {
        return `${attr}=""`;
      }
      return full;
    },
  );

  // Nettoyage defensif residuel de toute occurrence javascript: brute
  clean = clean.replace(/javascript\s*:/gi, "");

  return clean;
}

/**
 * Construit un schema vectoriel SVG anime adapte a la famille d'exercice respiratoire.
 * @param {string} svgType
 * @param {{
 *   width?: number,
 *   height?: number,
 *   accentColor?: string,
 *   secondaryColor?: string,
 *   cycleDurationS?: number,
 *   title?: string,
 *   showLabels?: boolean,
 * }} [options]
 * @returns {string}
 */
export function buildBreathExerciseSvg(svgType, options = {}) {
  const type = SVG_TYPES.includes(svgType) ? svgType : "diaphragm_360";
  const width =
    Number.isFinite(Number(options.width)) && Number(options.width) > 0
      ? Math.round(Number(options.width))
      : 320;
  const height =
    Number.isFinite(Number(options.height)) && Number(options.height) > 0
      ? Math.round(Number(options.height))
      : 200;
  const accent = safeColor(options.accentColor, "#38bdf8");
  const secondary = safeColor(options.secondaryColor, "#22c55e");
  const cycleS =
    Number.isFinite(Number(options.cycleDurationS)) &&
    Number(options.cycleDurationS) >= 1
      ? Number(options.cycleDurationS)
      : 6;
  const showLabels = options.showLabels !== false;
  const titleText = escapeXml(options.title || `WebBreath ${type}`);

  let innerBody = "";

  switch (type) {
    case "k5_pressure":
      innerBody = `
        <style>
          .wb-k5-piston { animation: wbK5Valve ${cycleS}s ease-in-out infinite; transform-origin: 118px 100px; }
          .wb-k5-bar { animation: wbK5Bar ${cycleS}s ease-in-out infinite; transform-origin: 250px 156px; }
          .wb-k5-flow { stroke-dasharray: 10 8; animation: wbK5Flow ${Math.max(1.2, cycleS / 2)}s linear infinite; }
          @keyframes wbK5Valve {
            0%, 100% { transform: translateX(0px); }
            30%, 55% { transform: translateX(-14px); }
          }
          @keyframes wbK5Bar {
            0%, 100% { transform: scaleY(0.18); opacity: 0.45; }
            35% { transform: scaleY(0.95); opacity: 1; }
          }
          @keyframes wbK5Flow {
            from { stroke-dashoffset: 36; }
            to { stroke-dashoffset: 0; }
          }
        </style>
        <rect x="44" y="76" width="128" height="48" rx="10" fill="#0f172a" stroke="${accent}" stroke-width="2.5"/>
        <path d="M172 86 L204 86 L204 114 L172 114" fill="#1e293b" stroke="${accent}" stroke-width="2"/>
        <line x1="70" y1="100" x2="112" y2="100" stroke="#64748b" stroke-width="4" stroke-dasharray="4 4"/>
        <rect class="wb-k5-piston" x="112" y="82" width="14" height="36" rx="3" fill="${accent}"/>
        <path class="wb-k5-flow" d="M26 100 L106 100" stroke="${secondary}" stroke-width="3" stroke-linecap="round"/>
        <rect x="234" y="42" width="32" height="114" rx="6" fill="#0f172a" stroke="#334155" stroke-width="2"/>
        <rect class="wb-k5-bar" x="238" y="46" width="24" height="108" rx="4" fill="${accent}"/>
        ${showLabels ? `<text x="44" y="152" fill="#cbd5e1" font-size="11" font-family="sans-serif">Valve seuil electronique</text><text x="226" y="176" fill="${accent}" font-size="11" font-family="sans-serif">cmH2O</text>` : ""}
      `;
      break;

    case "isocapnic_bag":
      innerBody = `
        <style>
          .wb-iso-bag { animation: wbIsoBag ${cycleS}s ease-in-out infinite; transform-origin: 160px 58px; }
          @keyframes wbIsoBag {
            0%, 100% { transform: scale(0.76, 0.84); opacity: 0.72; }
            50% { transform: scale(1.06, 1.04); opacity: 1; }
          }
        </style>
        <rect x="148" y="24" width="24" height="32" rx="4" fill="#1e293b" stroke="${accent}" stroke-width="2"/>
        <path class="wb-iso-bag" d="M148 56 C108 62, 92 104, 102 146 C110 170, 210 170, 218 146 C228 104, 212 62, 172 56 Z" fill="${accent}" fill-opacity="0.24" stroke="${accent}" stroke-width="3"/>
        <circle cx="160" cy="40" r="4" fill="${secondary}"/>
        <path d="M114 40 L146 40" stroke="${secondary}" stroke-width="2.5" stroke-dasharray="4 3"/>
        ${showLabels ? `<text x="74" y="184" fill="#cbd5e1" font-size="11" font-family="sans-serif">Sac normocapnique (50-60% CV)</text>` : ""}
      `;
      break;

    case "airofit_dual":
      innerBody = `
        <style>
          .wb-airo-in { animation: wbAiroPulse ${cycleS}s ease-in-out infinite; transform-origin: 108px 100px; }
          .wb-airo-ex { animation: wbAiroPulse ${cycleS}s ease-in-out infinite reverse; transform-origin: 212px 100px; }
          @keyframes wbAiroPulse {
            0%, 100% { transform: scale(0.92); opacity: 0.7; }
            50% { transform: scale(1.08); opacity: 1; }
          }
        </style>
        <rect x="58" y="64" width="204" height="72" rx="36" fill="#0f172a" stroke="#475569" stroke-width="2.5"/>
        <circle class="wb-airo-in" cx="108" cy="100" r="24" fill="${accent}" fill-opacity="0.22" stroke="${accent}" stroke-width="3"/>
        <circle class="wb-airo-ex" cx="212" cy="100" r="24" fill="${secondary}" fill-opacity="0.22" stroke="${secondary}" stroke-width="3"/>
        <text x="108" y="104" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="bold" font-family="sans-serif">A-F</text>
        <text x="212" y="104" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="bold" font-family="sans-serif">1-6</text>
        ${showLabels ? `<text x="82" y="164" fill="${accent}" font-size="11" font-family="sans-serif">INSP</text><text x="198" y="164" fill="${secondary}" font-size="11" font-family="sans-serif">EXP</text>` : ""}
      `;
      break;

    case "ex1_expiratory":
      innerBody = `
        <style>
          .wb-ex1-jet { stroke-dasharray: 12 8; animation: wbEx1Jet ${Math.max(1.2, cycleS / 2)}s linear infinite; }
          .wb-ex1-flap { animation: wbEx1Flap ${cycleS}s ease-in-out infinite; transform-origin: 210px 76px; }
          @keyframes wbEx1Jet {
            from { stroke-dashoffset: 40; }
            to { stroke-dashoffset: 0; }
          }
          @keyframes wbEx1Flap {
            0%, 40%, 100% { transform: rotate(0deg); }
            65%, 85% { transform: rotate(-28deg); }
          }
        </style>
        <rect x="64" y="76" width="146" height="48" rx="8" fill="#0f172a" stroke="${secondary}" stroke-width="2.5"/>
        <line class="wb-ex1-flap" x1="210" y1="76" x2="210" y2="124" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>
        <path class="wb-ex1-jet" d="M84 100 L276 100" stroke="${secondary}" stroke-width="3.5" stroke-linecap="round"/>
        <polygon points="274,94 288,100 274,106" fill="${secondary}"/>
        ${showLabels ? `<text x="64" y="156" fill="#cbd5e1" font-size="11" font-family="sans-serif">Flux expiratoire contre soupape MEP</text>` : ""}
      `;
      break;

    case "vagal_wave":
      innerBody = `
        <style>
          .wb-vagal-dot { animation: wbVagalDot ${cycleS}s ease-in-out infinite; }
          @keyframes wbVagalDot {
            0%, 100% { transform: translate(0px, 32px); }
            50% { transform: translate(0px, -32px); }
          }
        </style>
        <line x1="30" y1="100" x2="290" y2="100" stroke="#334155" stroke-width="1.5" stroke-dasharray="4 4"/>
        <path d="M30 100 C65 36, 95 36, 130 100 C165 164, 195 164, 230 100 C250 62, 270 62, 290 100" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round"/>
        <circle class="wb-vagal-dot" cx="160" cy="100" r="8" fill="${secondary}" stroke="#f8fafc" stroke-width="2"/>
        ${showLabels ? `<text x="92" y="176" fill="#cbd5e1" font-size="11" font-family="sans-serif">Resonance vagale 0,1 Hz (6 c/min)</text>` : ""}
      `;
      break;

    case "spo2_apnea":
      innerBody = `
        <style>
          .wb-spo2-pulse { animation: wbSpo2Pulse ${cycleS}s ease-in-out infinite; }
          @keyframes wbSpo2Pulse {
            0%, 100% { opacity: 0.45; }
            50% { opacity: 1; }
          }
        </style>
        <line x1="34" y1="136" x2="286" y2="136" stroke="#ef4444" stroke-width="2" stroke-dasharray="6 4"/>
        <path d="M34 54 L130 56 C176 58, 206 106, 232 122 C250 130, 266 112, 286 64" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round"/>
        <circle class="wb-spo2-pulse" cx="232" cy="122" r="7" fill="#f59e0b" stroke="#f8fafc" stroke-width="2"/>
        ${showLabels ? `<text x="36" y="42" fill="${accent}" font-size="11" font-family="sans-serif">SpO2 98%</text><text x="196" y="154" fill="#ef4444" font-size="11" font-family="sans-serif">Plancher 88%</text>` : ""}
      `;
      break;

    case "nasal_flow":
      innerBody = `
        <style>
          .wb-nasal-stream { stroke-dasharray: 8 6; animation: wbNasalStream ${Math.max(1.5, cycleS / 2)}s linear infinite; }
          @keyframes wbNasalStream {
            from { stroke-dashoffset: 28; }
            to { stroke-dashoffset: 0; }
          }
        </style>
        <path d="M160 32 L126 114 C122 124, 134 132, 146 126 L160 118 L174 126 C186 132, 198 124, 194 114 Z" fill="#0f172a" stroke="#64748b" stroke-width="2.5"/>
        <rect x="132" y="72" width="56" height="12" rx="6" fill="${secondary}" fill-opacity="0.85"/>
        <path class="wb-nasal-stream" d="M142 152 C142 124, 148 104, 152 60" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>
        <path class="wb-nasal-stream" d="M178 152 C178 124, 172 104, 168 60" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>
        ${showLabels ? `<text x="84" y="178" fill="#cbd5e1" font-size="11" font-family="sans-serif">Flux laminaire nasal &amp; NO sinusal</text>` : ""}
      `;
      break;

    case "tymewear_belt":
      innerBody = `
        <style>
          .wb-belt-expand { animation: wbBeltExpand ${cycleS}s ease-in-out infinite; transform-origin: 160px 100px; }
          @keyframes wbBeltExpand {
            0%, 100% { transform: scaleX(0.92); }
            50% { transform: scaleX(1.08); }
          }
        </style>
        <ellipse cx="160" cy="100" rx="88" ry="44" fill="#0f172a" stroke="#475569" stroke-width="3"/>
        <g class="wb-belt-expand">
          <ellipse cx="160" cy="100" rx="88" ry="44" fill="none" stroke="${accent}" stroke-width="5"/>
          <rect x="136" y="134" width="48" height="22" rx="6" fill="#1e293b" stroke="${secondary}" stroke-width="2.5"/>
          <circle cx="160" cy="145" r="4" fill="${secondary}"/>
        </g>
        ${showLabels ? `<text x="86" y="180" fill="#cbd5e1" font-size="11" font-family="sans-serif">Sangle thoracique VE / Vt / Bf</text>` : ""}
      `;
      break;

    case "diaphragm_360":
    default:
      innerBody = `
        <style>
          .wb-dia-ring { animation: wbDiaRing ${cycleS}s ease-in-out infinite; transform-origin: 160px 100px; }
          @keyframes wbDiaRing {
            0%, 100% { transform: scale(0.76); opacity: 0.65; }
            45%, 55% { transform: scale(1.08); opacity: 1; }
          }
        </style>
        <circle cx="160" cy="100" r="64" fill="none" stroke="#334155" stroke-width="2" stroke-dasharray="5 5"/>
        <g class="wb-dia-ring">
          <circle cx="160" cy="100" r="52" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="3.5"/>
          <path d="M160 36 L160 22 M160 164 L160 178 M96 100 L82 100 M224 100 L238 100" stroke="${secondary}" stroke-width="3" stroke-linecap="round"/>
        </g>
        <circle cx="160" cy="100" r="14" fill="${secondary}" fill-opacity="0.85"/>
        ${showLabels ? `<text x="84" y="190" fill="#cbd5e1" font-size="11" font-family="sans-serif">Expansion costale 360 degres</text>` : ""}
      `;
      break;
  }

  const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="${width}" height="${height}" role="img" aria-label="${titleText}"><title>${titleText}</title><rect width="320" height="200" rx="14" fill="#020617"/>${innerBody}</svg>`;
  return sanitizeSvgMarkup(rawSvg);
}
