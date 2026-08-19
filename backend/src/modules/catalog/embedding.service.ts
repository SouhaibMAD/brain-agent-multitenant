// src/modules/catalog/embedding.service.ts

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

/**
 * Génère des embeddings texte via un modèle ONNX exécuté localement
 * (multilingual-e5-small, 384 dimensions) — pas d'appel réseau externe,
 * pas de coût par appel. Le modèle est chargé une seule fois au premier
 * appel et mis en cache en mémoire pour la durée de vie du process
 * (cohérent avec le pattern déjà utilisé pour tenant-connection-manager.ts).
 *
 * Utilisé à deux endroits :
 * - import.service.ts : calcul de l'embedding à l'insert/update de variante
 * - catalog.service.ts : calcul de l'embedding de la requête client à la volée
 */

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Xenova/multilingual-e5-small') as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}