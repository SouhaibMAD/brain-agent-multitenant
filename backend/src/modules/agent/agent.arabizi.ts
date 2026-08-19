// src/modules/agent/agent.arabizi.ts

/**
 * Normalisation de l'arabizi (darija marocaine écrite en lettres latines,
 * avec chiffres phonétiques : "wach 3ndkom had sac") vers darija en
 * lettres arabes, AVANT envoi au modèle.
 *
 * Contexte (voir ARCHITECTURE.md, BLOC 4/5bis) : qwen/qwen3.6-27b gère
 * bien le français, l'anglais, l'arabe standard et la darija déjà écrite
 * en lettres arabes — mais répond mal quand le client écrit en arabizi.
 * Ce format est sous-représenté dans les corpus d'entraînement de la
 * plupart des LLM (y compris les plus gros), et qwen (27B) généralise
 * moins bien sur ce point que openai/gpt-oss-120b (observé en test réel).
 *
 * Stratégie en cascade, appliquée mot par mot :
 *   1. Dictionnaire ciblé (haute précision) — les mots darija les plus
 *      fréquents en conversation e-commerce sont mappés directement vers
 *      leur graphie arabe usuelle.
 *   2. Translittération phonétique (repli) — appliquée UNIQUEMENT aux
 *      tokens restants qui contiennent un chiffre phonétique (3,7,9,5,2,8),
 *      signal fort qu'il s'agit encore d'arabizi non couvert par le
 *      dictionnaire. Un mot sans chiffre et non reconnu (ex: "sac",
 *      "livraison", un nom propre) n'est JAMAIS touché — on préfère le
 *      laisser tel quel plutôt que de le charabiaser.
 *
 * Le texte original n'est jamais modifié en DB — voir agent.service.ts,
 * seule la version envoyée au LLM est normalisée.
 */

// ─── Dictionnaire ciblé : mots darija fréquents (arabizi → arabe) ───
// Volontairement limité aux mots à haute fréquence en conversation
// commerciale (salutations, questions, quantités, temporalité, négation).
// Extension possible au fil des retours terrain — garder ce fichier comme
// point d'ajout unique plutôt que de disperser des règles ailleurs.
const DARIJA_DICTIONARY: Record<string, string> = {
  // Salutations / politesse
  salam: 'سلام',
  slm: 'سلام',
  ahlan: 'أهلا',
  bslama: 'بسلامة',
  saha: 'صحة',
  bsahtek: 'بصحتك',
  choukran: 'شكرا',
  shokran: 'شكرا',

  // Questions
  wach: 'واش',
  wch: 'واش',
  chno: 'شنو',
  chnoo: 'شنو',
  ash: 'آش',
  chkoun: 'شكون',
  fin: 'فين',
  fash: 'فاش',
  fuqash: 'فوقاش',
  kifash: 'كيفاش',
  kif: 'كيف',
  qadach: 'قداش',
  qeddach: 'قداش',
  '3lash': 'علاش',

  // Verbes / expressions fréquentes
  bghit: 'بغيت',
  bghyt: 'بغيت',
  bgha: 'بغى',
  bghiti: 'بغيتي',
  n9dr: 'نقدر',
  n9der: 'نقدر',
  n3rf: 'نعرف',
  '3ndkom': 'عندكم',
  '3andkom': 'عندكم',
  '3ndkoum': 'عندكم',
  '3ndi': 'عندي',
  kayn: 'كاين',
  kaina: 'كاينة',
  kaynin: 'كاينين',
  makaynch: 'ماكايناش',
  ma3endich: 'ماعنديش',
  mabghitch: 'مابغيتش',
  bghit9: 'بغيت',
  khasni: 'خاصني',
  khassni: 'خاصني',
  n7b: 'نحب',
  nhab: 'نحب',
  '3jbni': 'عجبني',
  '3jbatni': 'عجباتني',

  // Temporalité
  daba: 'دابا',
  dba: 'دابا',
  ghda: 'غدا',
  lyoum: 'اليوم',
  lyouma: 'اليوم',
  lbare7: 'البارح',
  daymen: 'دايما',

  // Quantité / intensité
  bzaf: 'بزاف',
  bezzaf: 'بزاف',
  chwiya: 'شوية',
  ghi: 'غير',
  ghir: 'غير',

  // Divers fréquents
  had: 'هاد',
  hadchi: 'هادشي',
  hadok: 'هادوك',
  dyal: 'ديال',
  dyalek: 'ديالك',
  dyali: 'ديالي',
  wakha: 'واخا',
  safi: 'صافي',
  yallah: 'يالله',
  imkan: 'إمكان',
  mzyan: 'مزيان',
  mezyan: 'مزيان',
  zwina: 'زوينة',
  zwin: 'زوين',
};

// ─── Translittération phonétique (chiffres → lettres arabes) ───
// Mapping des chiffres utilisés comme substituts phonétiques en arabizi.
// Appliqué uniquement en repli, sur des tokens non résolus par le
// dictionnaire ci-dessus. Seule source de vérité pour "quels chiffres
// sont phonétiques" — la regex de détection (PHONETIC_DIGIT_PATTERN,
// ci-dessous) est dérivée de ces clés plutôt que dupliquée en dur, pour
// éviter qu'un chiffre ajouté ici soit oublié dans la détection (bug
// réel rencontré avec le "8", initialement absent de la regex bien que
// présent dans ce mapping).
const PHONETIC_DIGIT_MAP: Record<string, string> = {
  '3': 'ع',
  '7': 'ح',
  '9': 'ق',
  '2': 'ء',
  '5': 'خ',
  '8': 'ق', // usage moins fréquent que 9, mais rencontré (ex: "8ali" pour خالي dans certaines graphies)
};

// Regex dérivée dynamiquement de PHONETIC_DIGIT_MAP — un seul point de
// vérité, ajouter/retirer un chiffre dans le mapping ci-dessus suffit à
// mettre à jour toute la détection en aval.
const PHONETIC_DIGIT_PATTERN = new RegExp(`[${Object.keys(PHONETIC_DIGIT_MAP).join('')}]`);

/**
 * Détecte si un texte contient probablement de l'arabizi : présence d'un
 * chiffre phonétique n'importe où dans un token qui n'est pas un nombre
 * pur (donc pas un prix/quantité/taille), ou mots reconnus du
 * dictionnaire darija.
 *
 * Volontairement permissif (faux positifs rares et sans conséquence — la
 * normalisation est idempotente sur du texte qui n'est pas de l'arabizi,
 * voir normalizeArabizi) plutôt que restrictif (rater un cas réel coûte
 * plus cher : c'est exactement le problème qu'on corrige).
 *
 * Volontairement PAS limité aux chiffres directement collés à une lettre
 * (ex: uniquement "n9dr") — un chiffre phonétique isolé par une voyelle
 * des deux côtés (rare mais possible) doit aussi déclencher la détection ;
 * seul un token entièrement numérique (prix, taille, quantité) est exclu.
 */
export function looksLikeArabizi(text: string): boolean {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);

  return tokens.some((tok) => {
    if (DARIJA_DICTIONARY[tok] !== undefined) return true;
    // Nombre pur, ou nombre à 2+ chiffres avec unité collée ("250dh",
    // "42") — jamais un signal arabizi. Un seul chiffre en tête suivi de
    // lettres ("3ndkom") reste, lui, un signal arabizi valide (voir
    // normalizeArabizi, étape 2, pour le détail du raisonnement).
    if (/^\d{2,}/.test(tok) || /^\d+$/.test(tok)) return false;
    return PHONETIC_DIGIT_PATTERN.test(tok);
  });
}

/**
 * Translittère un seul token arabizi (contenant un chiffre phonétique)
 * vers l'arabe — mais UNIQUEMENT les chiffres phonétiques eux-mêmes
 * (3→ع, 7→ح, 9→ق, 5→خ, 8→ق, 2→ء). Les lettres latines environnantes
 * sont volontairement laissées telles quelles plutôt que transcrites.
 *
 * Pourquoi ne pas transcrire aussi les lettres latines (a, i, e, consonnes
 * simples...) : en arabizi, les voyelles courtes latines (a/e/i/u) ne
 * correspondent pas de façon fiable à une lettre arabe précise — l'arabe
 * standard n'écrit normalement pas les voyelles brèves. Une transcription
 * systématique (ex: "a" → ا) traite à tort des voyelles courtes comme des
 * voyelles longues et produit un résultat qui n'est pas juste
 * "imparfait" mais qui peut former un AUTRE mot arabe correct et
 * trompeur — ex. "t9der" (tu peux) transcrit lettre par lettre donnerait
 * "تقدار" (un vrai mot, "estimations"), au lieu de "تقدر". Un hybride du
 * type "tقder" est visuellement moins soigné, mais un signal non ambigu
 * pour le LLM — aucun risque de confusion avec un mot arabe existant.
 */
function transliterateToken(token: string): string {
  let result = '';
  for (const char of token.toLowerCase()) {
    result += PHONETIC_DIGIT_MAP[char] ?? char;
  }
  return result;
}

/**
 * Normalise un texte potentiellement en arabizi vers de la darija en
 * lettres arabes, mot par mot :
 *  - mot reconnu dans le dictionnaire → remplacé directement (haute précision)
 *  - mot contenant un chiffre phonétique mais absent du dictionnaire →
 *    translittéré phonétiquement (repli, best-effort)
 *  - tout le reste (mots français/anglais standards, ponctuation, nombres
 *    réels comme des prix ou quantités) → laissé intact
 *
 * Idempotent et sûr sur du texte qui n'est pas de l'arabizi : un message
 * déjà en français/anglais/arabe ne contient ni mot du dictionnaire ni
 * chiffre collé à une lettre, donc ressort inchangé.
 *
 * Retourne le texte normalisé et un flag indiquant si une transformation
 * a eu lieu (utile pour décider d'envoyer aussi l'original au LLM en
 * complément, voir agent.service.ts).
 */
export function normalizeArabizi(text: string): { normalized: string; wasTransformed: boolean } {
  if (!text || !looksLikeArabizi(text)) {
    return { normalized: text, wasTransformed: false };
  }

  let wasTransformed = false;

  // Découpage en tokens tout en conservant les séparateurs (espaces,
  // ponctuation) pour reconstruire un texte lisible.
  const parts = text.split(/([^a-zA-Z0-9]+)/);

  const rebuilt = parts
    .map((part) => {
      if (part === '' || /^[^a-zA-Z0-9]+$/.test(part)) {
        // Séparateur (espace, ponctuation) — inchangé
        return part;
      }

      const lower = part.toLowerCase();

      // 1. Dictionnaire (haute précision)
      if (DARIJA_DICTIONARY[lower]) {
        wasTransformed = true;
        return DARIJA_DICTIONARY[lower];
      }

      // 2. Nombre, pur ou avec unité collée (prix "250dh", taille "42") —
      //    reconnu par AU MOINS DEUX chiffres consécutifs en tête de
      //    token. Un token comme "250dh" (2+ chiffres puis lettres) est un
      //    nombre, jamais de l'arabizi, même si sa partie numérique
      //    contient un chiffre phonétique (2,3,5,7,8,9) — sans ce
      //    garde-fou, un prix comme "250dh" serait charcuté par l'étape 3
      //    (bug réel découvert en test).
      //    À l'inverse, un SEUL chiffre en tête suivi de lettres (ex:
      //    "3ndkom", "3afak", "9elt") est très probablement de l'arabizi
      //    où le chiffre phonétique remplace la première consonne — ce
      //    cas doit continuer vers l'étape 3, pas être traité en nombre.
      if (/^\d{2,}/.test(part) || /^\d+$/.test(part)) {
        return part;
      }

      // 3. Contient un chiffre phonétique → translittération de repli
      //    (regex dérivée de PHONETIC_DIGIT_MAP, inclut bien le "8")
      if (PHONETIC_DIGIT_PATTERN.test(part)) {
        wasTransformed = true;
        return transliterateToken(part);
      }

      // 4. Mot latin sans chiffre, non reconnu → probablement français/
      //    anglais/nom propre, laissé intact
      return part;
    })
    .join('');

  return { normalized: rebuilt, wasTransformed };
}