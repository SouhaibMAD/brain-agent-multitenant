// src/modules/whatsapp/image-compression.ts

import sharp from "sharp";

/**
 * Compression d'image reçue via WhatsApp (Baileys) avant persistance/envoi
 * au LLM vision — voir ARCHITECTURE.md, support images produits.
 *
 * Révision (post-BLOC 5bis, dette TPD/TPM) : la limite initiale (1 Mo,
 * 768px) provoquait des 413 "Request too large" en conditions réelles —
 * le budget total de 8000 TPM (compte Groq, tier on_demand) doit couvrir
 * l'image ENCODÉE EN VISION (facturée approximativement par tuile, pas
 * linéairement aux octets bruts) EN PLUS du system prompt, du schema des
 * tools, et de l'historique réduit (HISTORY_LIMIT_WITH_IMAGE). Une image
 * de 768px/1 Mo laissait trop peu de marge, en particulier quand
 * l'historique contenait déjà des tours précédents volumineux.
 *
 * Nouvelle contrainte : 300 Ko maximum, résolution réduite à 512px de
 * large. Palier de qualité supplémentaire (20) ajouté pour maximiser les
 * chances de passer sous la limite sur un screenshot chargé (texte fin,
 * beaucoup de détails) sans rejeter l'image d'emblée.
 */

const MAX_BYTES = 300 * 1024; // 300 Ko — marge laissée au reste du payload (system prompt + tools + historique réduit)
const MAX_WIDTH = 512;
const QUALITY_STEPS = [70, 50, 30, 20] as const;

export interface CompressedImageResult {
  buffer: Buffer;
  mimeType: string;
  base64: string;
}

/**
 * Retourne null si la compression échoue à faire rentrer l'image sous la
 * limite même au palier de qualité le plus bas — cas extrême (image
 * corrompue, ou déjà minuscule en résolution mais lourde pour une raison
 * qui ne se résout pas par un JPEG re-encodé). Le code appelant doit
 * traiter null comme "image rejetée" et informer le client poliment.
 */
export async function compressImageToLimit(
  rawBuffer: Buffer
): Promise<CompressedImageResult | null> {
  for (const quality of QUALITY_STEPS) {
    try {
      const compressed = await sharp(rawBuffer)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();

      if (compressed.byteLength <= MAX_BYTES) {
        return {
          buffer: compressed,
          mimeType: "image/jpeg",
          base64: compressed.toString("base64"),
        };
      }
    } catch (err) {
      console.error("[image-compression] échec sharp sur un palier de qualité :", err instanceof Error ? err.message : err);
      // on continue vers le palier suivant plutôt que d'abandonner immédiatement
    }
  }

  return null; // aucun palier n'a suffi, ou sharp a échoué systématiquement
}