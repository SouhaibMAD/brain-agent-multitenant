// src/modules/agent/agent.service.ts

import Groq from 'groq-sdk';
import { eq, desc } from 'drizzle-orm';
import { conversations, messages } from '../../db/tenant/schema.js';
import type { getTenantDb } from '../../db/tenant-connection-manager.js';
import { AGENT_TOOLS } from './agent.tools.js';
import { buildSystemPrompt } from './agent.prompt.js';
import { searchCatalog } from '../catalog/catalog.service.js';
import { upsertLeadForConversation, escalateConversationToHuman } from '../leads/leads.service.js';
import { config } from '../../config/index.js';
import type { ProcessMessageInput, ProcessMessageResult } from './agent.types.js';

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

const groq = new Groq({ apiKey: config.groqApiKey });

const MODEL = 'qwen/qwen3.6-27b';
const HISTORY_LIMIT = 20;
const HISTORY_LIMIT_WITH_IMAGE = 6; // une image consomme déjà une grosse part du budget TPM (8000 sur ce compte) — réduire l'historique texte associé pour rester sous la limite
const MAX_TOOL_ROUNDS = 6;

const GROQ_UNAVAILABLE_FALLBACK =
  "Nous rencontrons une difficulté technique. Un conseiller prend le relais. / Sma7 lina, kayn mochkil. Chi 7ad ghadi yjawbak daba.";

function isToolUseFailedError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('tool_use_failed');
  }
  return false;
}

/**
 * qwen/qwen3.6-27b est un modèle "reasoning" — il peut exposer son
 * raisonnement brut dans le content final au lieu de le confiner à un
 * champ séparé, sous forme de balise <think>...</think> (parfois
 * <thought>...</thought> selon le provider/modèle, cf. comportement
 * similaire observé avec gemma-4-26b en BLOC 9ter). Ce contenu n'est
 * JAMAIS destiné au client final — ni en apparence professionnelle, ni en
 * confidentialité du raisonnement interne de l'agent.
 *
 * Retire tout bloc correspondant, quelle que soit sa position dans le
 * texte (début, milieu — observé en test réel un cas où du texte utile
 * suivait le bloc <think>). Insensible à la casse, multi-ligne. Si le
 * texte restant après nettoyage est vide, le code appelant retombe déjà
 * sur la logique existante de relance forcée (content vide == pas de
 * réponse exploitable).
 */
function stripReasoningBlocks(content: string): string {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .trim();

  if (cleaned !== content.trim()) {
    console.warn('[agent.service] bloc de raisonnement <think>/<thought> détecté et retiré avant envoi au client');
  }

  return cleaned;
}

/**
 * Détecte un rate limit Groq (429, TPM/RPM dépassé) et extrait le délai
 * d'attente suggéré par l'API elle-même (ex: "try again in 4.725s") —
 * transitoire par nature, contrairement à une vraie panne, ne mérite pas
 * un fallback + escalade immédiate. Observé en test réel avec
 * qwen/qwen3.6-27b (limite 8000 TPM en tier on_demand, atteinte
 * facilement avec des messages contenant une image).
 */
function extractRateLimitRetryDelayMs(err: unknown): number | null {
  if (err instanceof Error) {
    // 413 "Request too large" — pas de délai suggéré, et retenter la
    // MÊME requête échouera à l'identique (elle est structurellement trop
    // grosse). On ne retry PAS ce cas ici — null signale "pas un cas de
    // simple attente", le code appelant tombera dans le fallback normal.
    if (err.message.includes('Request too large')) {
      return null;
    }

    const match = err.message.match(/try again in ([\d.]+)s/i);
    if (match && match[1]) {
      return Math.ceil(parseFloat(match[1]) * 1000);
    }
    if (err.message.includes('rate_limit_exceeded')) {
      return 5000;
    }
  }
  return null;
}

/**
 * qwen/qwen3.6-27b envoie parfois la string littérale "None" (habitude
 * Python) au lieu d'omettre un paramètre optionnel ou d'envoyer un vrai
 * null JSON — observé en test réel sur min_price/max_price. Sanitize
 * toute valeur de ce type vers undefined plutôt que de la laisser
 * remonter telle quelle jusqu'à searchCatalog (qui attend number|undefined).
 */
function sanitizeNullableNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value === 'None' || value === 'null' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value === 'number') return value;
  return undefined;
}

function sanitizeNullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && (value === 'None' || value === 'null' || value.trim() === '')) return undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Construit le texte effectivement envoyé au LLM pour le message courant.
 *
 * Historique (voir ARCHITECTURE.md, BLOC 9bis) : une normalisation pré-LLM
 * mot-par-mot (dictionnaire + translittération phonétique des chiffres,
 * voir agent.arabizi.ts) a été implémentée puis DÉSACTIVÉE après un bug
 * découvert en test réel — un mot latin non couvert par le dictionnaire et
 * sans chiffre phonétique (ex: "ghirou", darija fréquent pour "autre que
 * lui") reste intact pendant que le reste de la phrase est converti en
 * lettres arabes. Le texte hybride résultant (arabe + un token latin isolé
 * au milieu) est plus difficile à interpréter pour qwen/qwen3.6-27b que le
 * texte arabizi brut d'origine : le modèle a lu ce token isolé comme un nom
 * de produit plutôt que comme un mot darija.
 *
 * Décision : envoyer le texte brut du client tel quel, sans transformation.
 * qwen comprend nativement l'arabizi (confirmé en test — seul le mélange
 * partiel posait problème, pas la compréhension de l'arabizi en soi) ; la
 * règle de sortie stricte en arabe standard reste, elle, entièrement portée
 * par le prompt système (voir agent.prompt.ts, section "Langue").
 *
 * agent.arabizi.ts est conservé tel quel (non supprimé) : la logique et le
 * raisonnement documentés dans ce fichier restent pertinents pour le
 * rapport/la soutenance (itération réelle, bug découvert, décision de
 * retour en arrière argumentée), mais elle n'est plus appelée dans le
 * chemin actif de l'agent.
 */
function buildEffectiveUserText(rawText: string): string {
  return rawText;
}

/**
 * Construit le content Groq du dernier message utilisateur — string simple
 * si texte seul (comportement historique, inchangé pour l'historique
 * chargé depuis la DB), ou tableau multi-part (image_url + text) si une
 * image est présente sur CE message précis. Voir ARCHITECTURE.md, support
 * vision (qwen/qwen3.6-27b, input_modalities text+image).
 *
 * Important : cette fonction ne s'applique qu'au DERNIER message entrant
 * (celui qu'on est en train de traiter) — l'historique chargé depuis la DB
 * reste toujours du texte simple, car les images passées ne sont pas
 * re-persistées en base64 dans le contenu textuel (elles vivent dans
 * messages.mediaBase64, jamais renvoyées à Groq une fois le tour passé —
 * cohérent avec HISTORY_LIMIT qui ne recharge que du texte).
 */
function buildUserMessageContent(
  text: string,
  image?: { base64: string; mimeType: string }
): Groq.Chat.ChatCompletionUserMessageParam['content'] {
  if (!image) {
    return text;
  }

  return [
    {
      type: 'image_url' as const,
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
    },
    {
      type: 'text' as const,
      text: text || "Le client a envoyé cette image sans texte d'accompagnement.",
    },
  ];
}

export async function processIncomingMessage(
  db: TenantDb,
  input: ProcessMessageInput,
  tenantName: string
): Promise<ProcessMessageResult> {
  // ─── Garde handover : vérifiée AVANT tout appel Groq ───
  const [conversation] = await db
    .select({ status: conversations.status, botEnabled: conversations.botEnabled })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);

  const isInHandover = conversation?.status === 'handover';
  const isBotManuallyDisabled = conversation?.botEnabled === false;

  // Le message entrant est TOUJOURS sauvegardé tel quel (texte original,
  // pas la version normalisée arabizi) — image comprise. L'humain qui
  // reprend, comme l'Inbox en général, doit voir exactement ce que le
  // client a écrit.
  await db.insert(messages).values({
    conversationId: input.conversationId,
    direction: 'inbound',
    content: input.incomingContent,
    messageType: input.image ? 'image' : 'text',
    mediaBase64: input.image?.base64 ?? null,
    mediaMimeType: input.image?.mimeType ?? null,
  });

  if (isInHandover) {
    return { skipped: true, reason: 'conversation_in_handover' };
  }

  if (isBotManuallyDisabled) {
    return { skipped: true, reason: 'bot_manually_disabled' };
  }

  // ─── Chargement de l'historique (20 derniers messages, texte seul) ───
  const effectiveHistoryLimit = input.image ? HISTORY_LIMIT_WITH_IMAGE : HISTORY_LIMIT;

  const historyRows = await db
    .select({ direction: messages.direction, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(effectiveHistoryLimit);

  const chronologicalHistory = historyRows.reverse();

  // L'historique chargé depuis la DB inclut déjà le message qu'on vient
  // d'insérer ci-dessus (le plus récent) — donc chronologicalHistory
  // contient le texte du message courant, mais SANS l'image (content
  // textuel seul, colonne mediaBase64 non sélectionnée ici). On retire ce
  // dernier élément et on le reconstruit avec buildUserMessageContent pour
  // y attacher l'image si présente.
  const historyWithoutCurrent = chronologicalHistory.slice(0, -1);

  const groqMessages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(tenantName) },
    ...historyWithoutCurrent.map((row) => ({
      role: row.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    })),
    {
      role: 'user' as const,
      content: buildUserMessageContent(buildEffectiveUserText(input.incomingContent), input.image),
    },
  ];

  // ─── Boucle function-calling (inchangée) ───
  let finalReply: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion: Groq.Chat.ChatCompletion | undefined;
    let toolUseFailedRetried = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        completion = await groq.chat.completions.create({
          model: MODEL,
          messages: groqMessages,
          tools: AGENT_TOOLS,
          tool_choice: 'auto',
          reasoning_effort: "none",
        });
        break; // succès, sortir de la boucle de retry
      } catch (err) {
        if (isToolUseFailedError(err) && attempt === 0) {
          toolUseFailedRetried = true;
          console.warn('[agent.service] tool_use_failed détecté, retry en cours...');
          continue; // une seule retentative supplémentaire
        }
        // Erreur Groq définitive (soit pas tool_use_failed, soit retry déjà épuisé)
        finalReply = GROQ_UNAVAILABLE_FALLBACK;
        try {
          await escalateConversationToHuman(
            db,
            input.conversationId,
            `Échec appel Groq (${err instanceof Error ? err.message : JSON.stringify(err)})${toolUseFailedRetried ? ' — après retry tool_use_failed' : ''}.`
          );
        } catch (escalateErr) {
          // DB indisponible en plus de Groq — impossible de logger l'incident
          // ou de changer le statut. On ne relance pas : priorité absolue,
          // ne jamais laisser d'exception remonter jusqu'au webhook.
          console.error('[agent.service] Échec DB pendant escalade (Groq down + DB down) :', escalateErr);
        }
        break;
      }
    }

    if (!completion) {
      break;
    }

    const choice = completion.choices[0];
    if (!choice) {
      finalReply = GROQ_UNAVAILABLE_FALLBACK;
      try {
        await escalateConversationToHuman(
          db,
          input.conversationId,
          'Complétion Groq vide (choices[0] absent).'
        );
      } catch (escalateErr) {
        console.error('[agent.service] Échec DB pendant escalade (complétion vide) :', escalateErr);
      }
      break;
    }

    const responseMessage = choice.message;
    groqMessages.push(responseMessage);

    const toolCalls = responseMessage.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      const rawContent = responseMessage.content ?? '';
      const content = stripReasoningBlocks(rawContent);

      if (content.trim() !== '') {
        finalReply = content;
        break;
      }

      // Réponse vide sans tool call (soit vide dès le départ, soit vide
      // après retrait d'un bloc <think>/<thought> qui constituait TOUT le
      // contenu) : qwen a parfois ce comportement après un tour avec tool
      // calls déjà exécutés dans un round précédent — au lieu d'abandonner
      // immédiatement (fallback + escalade), on insiste une fois en
      // forçant explicitement une formulation, avant de considérer que
      // c'est un échec réel.
      console.warn('[agent.service] réponse vide sans tool call, relance forcée...');
      groqMessages.push({
        role: 'user',
        content: 'Formule ta réponse au client maintenant, en te basant sur les informations déjà obtenues ci-dessus.',
      });
      continue;
    }

    for (const toolCall of toolCalls) {
      let toolResult: unknown;
      try {
        toolResult = await executeToolCall(db, toolCall, input);
      } catch (err) {
        console.error(
          `[agent.service] ÉCHEC tool call ${toolCall.function.name} — conversation ${input.conversationId} :`,
          err instanceof Error ? err.stack ?? err.message : err
        );
        toolResult = {
          error: true,
          message: `L'outil ${toolCall.function.name} a échoué temporairement. Informe le client d'un souci technique si pertinent, sans inventer de résultat.`,
        };
      }
      groqMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

if (finalReply === null || finalReply.trim() === '') {
    // MAX_TOOL_ROUNDS atteint sans réponse finale, OU réponse finale vide
    // renvoyée par le modèle (observé possible après un tour avec tool
    // calls) — les deux cas doivent aboutir à un message de secours non
    // vide, jamais à un silence côté client.
    const wasNull = finalReply === null;
    finalReply =
      "Je rencontre une difficulté à traiter votre demande pour le moment. Un membre de notre équipe va prendre le relais.";
    try {
      await escalateConversationToHuman(
        db,
        input.conversationId,
        wasNull
          ? 'Boucle function-calling non résolue après plusieurs tentatives (MAX_TOOL_ROUNDS atteint).'
          : 'Réponse finale vide générée par le modèle après tool calls.'
      );
    } catch (escalateErr) {
      console.error('[agent.service] Échec DB pendant escalade (réponse vide/nulle) :', escalateErr);
    }
  }

  try {
    await db.insert(messages).values({
      conversationId: input.conversationId,
      direction: 'outbound',
      content: finalReply,
      messageType: 'text',
    });
  } catch (dbErr) {
    console.error("[agent.service] Échec DB à l'écriture du message assistant :", dbErr);
    return { skipped: true, reason: 'db_unavailable_on_write' };
  }

  return { skipped: false, assistantReply: finalReply };
}

// ─── Exécution des tool calls (inchangée) ───

async function executeToolCall(
  db: TenantDb,
  toolCall: Groq.Chat.ChatCompletionMessageToolCall,
  context: ProcessMessageInput
): Promise<unknown> {
  const args = JSON.parse(toolCall.function.arguments);

if (toolCall.function.name === 'search_catalog') {
    const minPrice = sanitizeNullableNumber(args.min_price);
    const maxPrice = sanitizeNullableNumber(args.max_price);
    const category = sanitizeNullableString(args.category);

    return searchCatalog(db, {
      query: args.query,
      ...(minPrice !== undefined ? { minPrice } : {}),
      ...(maxPrice !== undefined ? { maxPrice } : {}),
      ...(category !== undefined ? { category } : {}),
    });
  }

  if (toolCall.function.name === 'create_lead') {
    return upsertLeadForConversation(
      db,
      {
        customerName: args.customer_name,
        phone: args.phone,
        address: args.address,
        productRequested: args.product_requested,
        variant: args.variant,
        quantity: args.quantity,
        estimatedPrice: args.estimated_price,
      },
      { conversationId: context.conversationId, channel: context.channel }
    );
  }

  if (toolCall.function.name === 'escalate_to_human') {
    await escalateConversationToHuman(db, context.conversationId, args.reason);
    return { escalated: true };
  }

  throw new Error(`UNKNOWN_TOOL_CALL: ${toolCall.function.name}`);
}