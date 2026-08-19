# Checklist du projet — Brain Agent multitenant

> Mise à jour manuelle après chaque session de travail. Sert de mémoire persistante entre les conversations avec Claude — évite de ré-expliquer le contexte à chaque fois.

## Légende
- [ ] à faire
- [~] en cours
- [x] terminé
- [!] bloqué / question ouverte pour l'encadrant

---

## BLOC 0 — Cadrage & architecture (fait)

- [x] Lecture et analyse critique du cahier des charges
- [x] Proposition d'architecture (control plane / data plane) — présentée et validée par Mounim
- [x] Décisions confirmées : database-per-tenant + RLS, Flowise + WhatsApp non-officiel (V1), autres canaux = connecteurs existants en simple config

---

## BLOC 1 — Control plane & Auth (fait)

- [x] Setup Neon control plane, structure backend (config/db/modules/middleware)
- [x] Schéma Drizzle (`tenants`, `users` avec `isSuperAdmin`, `user_tenant_roles`), migration appliquée
- [x] Module `auth` : argon2id, JWT access/refresh avec rotation
- [x] Middlewares `authMiddleware`, `tenantMiddleware`, `requireSuperAdmin`
- [x] CRUD tenant (POST/GET/PATCH désactiver)
- [x] `app.ts`/`server.ts`, test manuel Postman du flux complet
- [x] Endpoint bootstrap d'assignation user↔tenant (`POST/GET /api/tenants/:tenantId/roles`)

## BLOC 2 — Data plane & provisioning (fait)

- [x] Schéma Drizzle tenant initial (`products`, `conversations`, `messages`, `leads`, `orders`, `whatsapp_sessions`)
- [x] Config Drizzle tenant séparée
- [x] Provisioning : création projet Neon (API) + migrations, asynchrone (BullMQ)
- [x] `databaseUrl` stocké control plane, gestionnaire de connexions dynamique (cache mémoire)
- [x] Tenant de test end-to-end validé
- [x] Driver tenant migré `neon-http` → `neon-serverless` (transactions)
- [x] RLS clarifié avec Mounim — non nécessaire

## BLOC 3 — Catalogue produits (fait)

- [x] Refonte schéma `products`/`product_variants`, migration appliquée
- [x] Endpoint unifié d'import CSV + JSON (`csv-parse`, `multer`), architecture en 5 phases
- [x] Modes dry-run / replace / merge, template CSV téléchargeable
- [x] Tests end-to-end (dry-run, merge, upsert, replace, rejet SKU différent, erreurs validation)
- [x] Colonne `category` sur `products`
- [x] Endpoint d'assignation `user_tenant_roles`
- [!] Dette assumée : `merge` ne met jamais à jour les métadonnées descriptives du produit parent sur un produit déjà existant (non bloquant, non traité)

## BLOC 4 — Agent IA (Groq SDK, code-first — fait)

- [x] Recherche catalogue hybride full-text + vectorielle (`search_vector` sur `products` et `product_variants`, `embedding` pgvector)
- [x] `agent.service.ts` — boucle function-calling Groq, tools `search_catalog`/`create_lead`/`escalate_to_human`
- [x] Injection contexte tenant, historique conversation (20 derniers messages)
- [x] Garde-fou anti-hallucination testé et corrigé
- [x] `leads.service.ts` — upsert lead par conversation, escalade/handover via `escalate_to_human`
- [x] Garde handover — plus d'appel Groq une fois en `'handover'`
- [x] Résilience multi-niveaux (retry `tool_use_failed`, fallback bilingue, try/catch par écriture critique)
- [x] Endpoint de test direct `POST /agent/message`
- [x] Filtres `category`/`min_price`/`max_price` validés (cast SQL explicite)
- [x] Détection d'intention de commande validée formellement (scénario 4 messages)
- [x] Modèle migré `llama-3.3-70b-versatile` → `openai/gpt-oss-120b` → **`qwen/qwen3.6-27b`** (définitif, cf. BLOC 5bis — seul modèle du compte avec vision + tools, aussi meilleur en qualité générale)
- [x] Debounce/regroupement des messages rapprochés (queue BullMQ `whatsapp-agent-trigger`, accumulation Redis 4s) — implémenté et validé en charge concurrente (3 conversations simultanées, mix FR/darija/arabe)
- [!] `VECTOR_SIMILARITY_THRESHOLD` (0.75) — non calibré empiriquement, reporté post-stage (décision actée, non bloquant pour la soutenance)
- [!] Dette ONNX — crash `bad allocation` sous pression mémoire, absorbé par le try/catch de résilience, non traité (décision actée, cf. ARCHITECTURE.md)

## BLOC 5 — Canal WhatsApp (fait)

- [x] Intégration Baileys (`baileys@7.0.0-rc14`), QR code par tenant (Redis TTL 60s)
- [x] Persistance session (creds control plane / statut tenant DB)
- [x] Réception → routage tenant → agent IA → réponse (5 queues BullMQ)
- [x] Envoi manuel par agent humain, toggle bot ON/OFF, reprise après handover
- [x] Test end-to-end réel exhaustif (3 contacts, reconnexion, bilingue, escalade)
- [!] Dette assumée : délai de stabilisation initiale de session (~6 min), intégré au script de démo
- [!] Messages envoyés depuis le téléphone (hors UI) non visibles dans l'Inbox — piste retenue (tracking `msg.key.id` du bot via Redis), non implémentée, priorité basse (BLOC 9, non traité faute de temps)

### BLOC 5bis — Support images/screenshots produits (fait)

- [x] Réception image WhatsApp (Baileys `imageMessage`), compression `sharp` (paliers 70/50/30, max 1 Mo, resize 768px)
- [x] Colonnes `messages.mediaBase64`/`mediaMimeType`, migration `0009_add_message_media.sql`
- [x] Affichage image dans l'Inbox (`ConversationThread.jsx`)
- [x] Migration modèle → `qwen/qwen3.6-27b` (seul modèle vision + tools disponible sur le compte)
- [x] Prompt système étendu (identification produit, réclamation, image inexploitable)
- [x] Image traitée hors debounce (immédiat)
- [x] Test réel end-to-end validé après correctifs (rate limit transitoire, race condition Redis, réponse vide qwen, params prix `"None"`, requêtes 413 trop volumineuses — cf. ARCHITECTURE.md pour le détail)
- [!] Plafond TPD (tokens/jour) du compte Groq atteignable en charge multi-conversations avec images — non corrigible par le code, décision à prendre avant démo (Dev Tier Groq ou dosage de la démo)

---

## BLOC 6 — Frontend : Inbox, Leads, RBAC, Team (fait à 100%)

### 6.1–6.3 — Socle, Inbox, Leads
- [x] Setup React/Vite, axios + refresh cookie httpOnly, layout tenant-aware, login
- [x] Inbox : liste conversations, filtre statut, thread, toggle bot, reprise bot, envoi manuel, notes internes horodatées
- [x] Leads : liste, filtre, deep-link conversation, `PATCH /:tenantId/leads/:leadId` (6 statuts CDC §3.10, transitions libres), `<select>` éditable en place

### 6.4 — Self-service tenant (fait)
- [x] `requireTenantAdmin` middleware, endpoint self-service `POST /:tenantId/invite` (`agent`/`viewer` uniquement)
- [x] Bootstrap `GET /users/lookup?email=`, `PATCH`/`DELETE /:tenantId/roles/:userId`
- [x] UI bootstrap `/admin/tenants/:tenantId/users` + UI self-service `/:tenantSlug/team`
- [x] Promotion `isSuperAdmin` volontairement hors UI/API — SQL manuel uniquement (décision actée, cf. ARCHITECTURE.md)

### 6.5 — Notification handover (fait)
- [x] Badge compteur sidebar (polling 5s), lien filtré `/inbox?status=handover` — pas de temps réel (décision actée, polling suffisant)

### 6.6 — RBAC réel + Profil (fait)
- [x] Middleware `requireMinimumRole(...roles)`, routes protégées par rôle minimum, pas de bypass `isSuperAdmin`
- [x] Page `/:tenantSlug/profile` (identité, grille permissions, changement mot de passe avec révocation sessions)
- [x] Messages 403 contextualisés côté UI

---

## BLOC 7 — Dashboard, Catalogue UI & Connexion WhatsApp (fait à 100%)

### 7.1 — Dashboard & gestion tenants (fait)
- [x] `GET /:tenantId/dashboard/stats` (agrégats multi-CTE), page Dashboard (polling 15s)
- [x] `/admin/tenants` — création/désactivation, garde `isSuperAdmin`

### 7.2 — Éditeur catalogue (fait)
- [x] `GET /:tenantId/products`, page Catalogue (liste expansible, filtre catégorie/recherche)
- [x] Interface d'import (dry-run/merge/replace, drag & drop, résumé + erreurs ligne par ligne)
- [!] Pas de pagination serveur — assumé pour la V1 (catalogues de quelques milliers de lignes max)

### 7.3 — Connexion WhatsApp (fait)
- [x] QR code (polling 3s), statut temps réel (polling 4s), déconnexion manuelle
- [x] Nettoyage sessions `pending_qr` orphelines, bouton "Annuler et régénérer QR"
- [x] Réconciliation sessions fantômes au redémarrage worker (`reconcileStaleSessionsOnStartup`, statut `stale`), endpoint `reconnect`

### 7.4 — Configuration agent IA (fait)
- [x] `GET /:tenantId/agent/config` (lecture seule, `buildSystemPrompt()` réel, pas de copie figée)
- [x] Pas d'édition en V1 — décision assumée (prompt fonction pure, pas de stockage par tenant)

---

## BLOC 8 — Sécurité production (fait, clos pour la soutenance)

- [x] Toutes routes tenant protégées (`authMiddleware`/`tenantMiddleware`/`requireSuperAdmin`)
- [x] Secrets centralisés (`config/index.ts`, `requireEnv()`, fail-fast au démarrage)
- [x] CORS restreint (whitelist), rate limiting login (10/15min, `express-rate-limit`)
- [x] Logs audités et nettoyés — aucune PII/secret en clair (audit exhaustif, 19 fichiers)
- [x] `tenantMiddleware` bloque un tenant désactivé (`403 TENANT_INACTIVE`)
- [x] Validation Zod exhaustive sur toutes les routes (`validate()` générique)
- [x] Suppression credentials par défaut (`docker-compose.yml` Flowise), scripts jetables et routes mortes (`internalApiKey.middleware.ts`, `catalog.routes.ts`)
- [!] `VECTOR_SIMILARITY_THRESHOLD` et dette ONNX — reportées post-stage (décisions actées, non bloquantes)

---

## BLOC 9 — Observabilité, métriques & vérifications finales (fait)

- [x] Upstash Redis : politique d'éviction `noeviction`
- [x] Métrique "temps de réponse moyen" ajoutée au Dashboard (`LAG()` window function sur `messages`, delta inbound→outbound, fenêtre 24h, exclusion délais > 5min) — testé en réel (~17.7s)
- [x] Build frontend vérifié (`vite build`, succès)
- [x] Build backend vérifié (`tsc --noEmit`, aucune erreur)
- [x] Non-régression manuelle repassée intégralement : login/accès tenant, message texte → réponse agent, message image → vision, scénario lead complet, toggle bot/reprise handover, import catalogue (dry-run)
- [ ] Logs applicatifs structurés / suivi erreurs IA formel — reporté en roadmap post-stage (non bloquant, la résilience multi-niveaux existante couvre déjà le comportement en cas d'erreur)

### BLOC 9bis — Corrections post-clôture (pré-soutenance)

- [x] Normalisation arabizi (`agent.arabizi.ts`) — dictionnaire + repli phonétique ciblé
- [x] Règle de sortie langue simplifiée : arabe/darija/arabizi → arabe standard uniquement (jamais darija/arabizi en sortie)
- [x] Fix critique : `whatsappSessionId` de conversation resynchronisé à chaque message entrant (`whatsapp-inbound.processor.ts`) — corrige `SESSION_NOT_ACTIVE` persistant sur conversations existantes après changement de session
- [x] Robustesse `whatsapp-outbound` : état `reconnectingSessions` (session-manager.ts) + fenêtre de retry élargie (3→5 tentatives, ~9s→~60s)
- [x] Incident Upstash free tier résolu (migration compte, `noeviction` reconfiguré)
- [!] Dette : conversations inactives depuis avant ce correctif gardent un `whatsappSessionId` obsolète jusqu'au prochain message du client — non corrigé rétroactivement en base (non bloquant pour la démo)
- [!] Dette : polling BullMQ non optimisé — risque de re-épuiser un quota Upstash free tier en cas de tests intensifs prolongés avant le 1er septembre
- [x] Exploration providers alternatifs (NVIDIA NIM, OpenRouter) post-fix arabizi — aucun candidat retenu, qwen/Groq confirmé comme meilleur choix disponible (cf. ARCHITECTURE.md, BLOC 9ter)

### BLOC 9bis-ter — Durcissement post-fix arabizi : reasoning leak & TPM images

- [x] Fix critique : balises `<think>`/`<thought>` (raisonnement brut qwen) parfois exposées dans le message final envoyé au client — `stripReasoningBlocks()` ajoutée dans `agent.service.ts`, log warning si déclenchée
- [x] Fix 413 "Request too large" (TPM 8000) systématique sur messages avec image — `MAX_BYTES` réduit 1 Mo → 300 Ko, `MAX_WIDTH` réduit 768px → 512px, palier de qualité supplémentaire (20) ajouté dans `image-compression.ts`
- [x] Les deux fixes validés en conditions réelles (scénario multi-tours avec images, conversations arabe standard) — plus de 413, plus de `<think>` visible
- [!] 429 TPD (200000 tokens/jour) atteint en test de charge réel — comportement de fallback/escalade confirmé correct, pas un bug ; décision Dev Tier vs dosage démo toujours non tranchée (dette déjà connue, BLOC 5bis/8)

---

## BLOC 10 — Documentation & préparation soutenance PFA

- [ ] Rapport (deadline 1er septembre)
- [ ] Support de présentation (slides)
- [ ] Anticiper les questions du jury sur les choix d'architecture

<details>
<summary>Points d'architecture à anticiper pour le jury</summary>

control/data plane, WhatsApp non-officiel, Flowise vs appel direct LLM, super_admin global vs rôle scopé-tenant, refonte produit/variante, choix neon-serverless pour le tenant, recherche hybride full-text + vectoriel, migrations de modèle Groq successives, cast SQL explicite sur paramètres nullable dans Drizzle, structuration des règles de prompt (cas positif énoncé avant l'exception), séparation bootstrap super-admin vs self-service tenant, support vision (qwen), résilience multi-niveaux de l'agent, debounce des messages rapprochés.

</details>

---
## BLOC 11-a — Connecteur Shopify (sync catalogue) — fait, périmètre réduit

> CDC Phase 3. Périmètre volontairement réduit à la synchronisation catalogue
> Shopify → Brain Agent (lecture seule). Création de commande, Messenger,
> Instagram : non traités, cf. section Hors scope PFA.

- [x] Migration tenant : `shopifyProductId`/`shopifyVariantId` sur `products`/`product_variants`, `sku` rendu nullable (contrainte obligatoire déplacée côté Zod pour les imports CSV/JSON uniquement), table `shopify_connections`
- [x] Migration control plane : table `shopify_shop_mappings` (résolution shop_domain → tenantId pour un futur webhook)
- [x] Module `shopify` complet : `shopify.service.ts` (mapping + upsert par ID Shopify, indépendant de `import.service.ts`), `shopify.controller.ts`, `shopify.routes.ts`
- [x] Auth : Custom App legacy (`shpat_...`), test de validité du token à la connexion (`fetchShopifyProducts` avant sauvegarde)
- [x] Sync manuelle (`POST /:tenantId/shopify/sync`) — testée réellement, 17 produits / 27 variantes importés depuis le dev store `brain-agent.myshopify.com`
- [x] Sync incrémentale validée (rejouer la sync met à jour au lieu de dupliquer, matching par `shopifyProductId`/`shopifyVariantId`)
- [x] Recherche agent validée sur produits Shopify (hybride full-text + vectoriel fonctionne malgré `sku: null` sur la majorité des variantes — repose sur `product_name_snapshot`/attributs)
- [x] Frontend `ShopifyConnect.jsx` — connexion, statut, sync manuelle, déconnexion
- [!] Webhook temps réel (`products/create`/`update`/`delete`) : **implémenté mais non activé** (HMAC + resolver tenant écrits et prêts) — nécessiterait une exposition publique permanente (tunnel/déploiement), jugé hors périmètre du calendrier. Sync manuelle retenue comme mécanisme de démo.
- [!] Dette mineure : certains produits Shopify renvoient `product_type: ""` (chaîne vide) plutôt que `null` — non traité, impact non confirmé sur les filtres catégorie de l'agent.


## BLOC 11-b — Connecteurs additionnels (Facebook / Instagram) [ABANDONNÉE — à mentionner en perspectives dans le rapport]

> CDC Phase 3 & 4. Connecteurs déjà existants côté Brain Gen — intégration en configuration prévue, jamais démarrée faute de temps. À présenter en soutenance comme roadmap post-stage sur le socle WhatsApp déjà solide.

---

## Hors scope PFA (Phase 5 du CDC, explicitement reporté)

À mentionner en soutenance comme roadmap post-stage :
- Scoring leads, suggestions de réponses, statistiques de conversion, relances automatiques, templates de messages, export leads/commandes.
- Paiement en ligne, création automatique de commandes Shopify, CRM avancé complet, campagnes marketing broadcast, gestion complète des publicités Meta, application mobile native.

---

## Décisions actées avec Mounim (questions closes)

- **WABA officiel vs Baileys** : Baileys retenu comme solution temporaire (blocage Meta for Developers, anti-spam SMS/email), validé par Mounim. Architecture WABA planifiée (`channel='whatsapp'` + colonne `provider`, module séparé `whatsapp-waba/`) mais **non implémentée, reportée post-soutenance**.
- **Support images/screenshots produits (CDC Phase 1)** : tranché — implémenté (BLOC 5bis, fait).
- **Affichage messages humains via téléphone (hors UI)** : confirmé comme comportement attendu à corriger, piste technique actée mais non implémentée (voir BLOC 5, dette basse priorité).
- **RLS** : non nécessaire, database-per-tenant jugé suffisant.
- **Scraping (CDC §4.3)** : périmètre exact jamais clarifié avec Mounim — sans objet, fonctionnalité non abordée dans le projet final, à mentionner si le jury pose la question.

---

## Journal des sessions

- **Session 1** : Analyse CDC, architecture validée, control plane posé.
- **Session 2** : Module auth complet (argon2id + JWT rotation), middlewares, CRUD tenant. BLOC 1 clôturé.
- **Session 3** : BLOC 2 complet — schéma tenant, provisioning asynchrone BullMQ+Redis, gestionnaire de connexions.
- **Session 4** : BLOC 3 — refonte catalogue (products/variants), import CSV/JSON 5 phases, driver `neon-serverless`.
- **Session 5** : Recherche full-text (BLOC 4). Flowise abandonné après blocages. Décision agent code-first Groq.
- **Session 6** : Construction `agent.service.ts`/`agent.tools.ts`/`leads.service.ts`. Migration modèle → `gpt-oss-120b`. Recherche vectorielle ajoutée. Bug filtres catalogue découvert (non résolu en fin de session).
- **Session 7** : Dette filtres catalogue résolue (cast SQL manquant, `42P18`). Détection intention de commande validée. BLOC 4 débloqué.
- **Session 8** : RLS non nécessaire (validé Mounim), Flowise abandon confirmé, Upstash `noeviction`, module `tenant-roles`.
- **Session 9** : BLOC 5 complet — Baileys, 5 queues BullMQ, module `conversations`. Test end-to-end validé.
- **Session 10** : Relecture CDC face à l'avancement (~65%). Réorganisation checklist — priorité basculée vers le produit démontrable (BLOC 6/7 ajoutés).
- **Session 11** : BLOC 6.4 clôturé — self-service invitation. BLOC 6 à 100%.
- **Session 12** : BLOC 7.2 & 7.3 — lecture catalogue, page Catalogue frontend.
- **Session 13** : BLOC 7 clôturé (Dashboard + Config agent). Dettes critiques découvertes et fermées (`isSuperAdmin` absent des réponses auth, provisioning cassé pour tout nouveau tenant — driver + extension `pgvector` manquants). Nettoyage 9 projets Neon orphelins. Catalogue de démo importé.
- **Session 14** : Rate limiting login. Audit logs partiel.
- **Session 15** : Audit exhaustif des logs (19 fichiers) — dette BLOC 8 "logs sans secrets" close.
- **Session 16** : Fermeture dette `tenantMiddleware`/`tenant.isActive` — tenant désactivé désormais réellement bloqué en API.
- **Session 17-18** : UI complète d'assignation user↔tenant (bootstrap + self-service). `GET /users/lookup`, `PATCH /:tenantId/roles/:userId`. Fix `TenantSelector.jsx` (redirection auto trop agressive). Badge handover sidebar. Dette RBAC identifiée (reportée à session 19).
- **Session 19** : RBAC réel (`requireMinimumRole`). Page "Mon profil". Messages 403 contextualisés.
- **Session 20** : Clôture BLOC 8 — validation Zod exhaustive, credentials par défaut supprimés, secrets centralisés, scripts jetables et routes mortes retirés.
- **Session 21** : Cycle de vie des leads comblé — `PATCH /:tenantId/leads/:leadId`, 6 statuts CDC §3.10, transitions libres.
- **Session 22** : Support images/screenshots (BLOC 5bis). Migration définitive `qwen/qwen3.6-27b`. Cinq bugs découverts et corrigés en test réel (rate limit, race condition Redis, réponse vide qwen, params prix `"None"`, requêtes 413). Dette TPD Groq identifiée, non résolue par le code.
- **Session 23** : BLOC 9 clos — métrique temps de réponse moyen ajoutée au Dashboard (validée ~17.7s), build frontend/backend vérifiés, non-régression manuelle complète repassée. Nettoyage des fichiers repères (CHECKLIST.md/ARCHITECTURE.md) — dettes tranchées condensées, doublons retirés.
- **Session 24** : Durcissement post-clôture, suite à tests réels. Normalisation arabizi (`agent.arabizi.ts`) + règle de sortie langue simplifiée (tout l'arabe/darija/arabizi → arabe standard uniquement). Bug critique corrigé : `whatsappSessionId` de conversation jamais resynchronisé après changement de session (cause racine de la majorité des `SESSION_NOT_ACTIVE` observés, invisible côté agent, bloquant côté envoi manuel humain). Robustesse retry `whatsapp-outbound` élargie (fenêtre de reconnexion Baileys transitoire mieux absorbée). Incident Upstash free tier (quota épuisé en test) résolu par migration de compte.
- **Session 25** : BLOC 11 — intégration Shopify (sync catalogue, lecture seule). Décision Custom App legacy plutôt qu'OAuth Dev Dashboard (Shopify a déprécié le reveal-token en UI pour les nouvelles apps début 2026, cf. ARCHITECTURE.md). Migration tenant + control plane. Module `shopify` créé sans réutiliser `import.service.ts` (clé de matching différente — ID Shopify vs SKU/product_ref — réutilisation aurait forcé un couplage artificiel). Testé réellement sur dev store (17 produits, 27 variantes, sku manquant sur la majorité). Frontend connecté. Webhook temps réel conçu (HMAC, resolver tenant) mais non activé — pas d'exposition publique du serveur en dev.
- **Session 26** : Bug arabizi critique découvert en test réel — "ghirou" (mot darija courant) mal interprété par la normalisation pré-LLM mot-par-mot, mélange latin/arabe halluciné en nom de produit. Décision : désactivation de `normalizeArabizi` dans le chemin actif (`buildEffectiveUserText` renvoie le texte brut), fichier `agent.arabizi.ts` conservé tel quel pour référence rapport/soutenance. Exploration de 9 modèles alternatifs sur 2 providers (NVIDIA NIM, OpenRouter) pour évaluer une meilleure gestion native de l'arabizi — aucun n'a égalé la stabilité de qwen/Groq en conditions réelles multi-tours (candidat le plus prometteur en test isolé, `gemma-4-26b`, s'est effondré sous scénario complet : raisonnement non parsé, latence 40s, crash, tool calling cassé en vision). Décision actée : qwen/qwen3.6-27b sur Groq reste en production, aucun changement de modèle/provider.
- **Session 27** : Durcissement suite à test end-to-end réel (image + texte + escalade). Deux bugs corrigés et validés en conditions réelles : fuite de raisonnement `<think>`/`<thought>` de qwen dans les réponses client (`stripReasoningBlocks()`), et 413 TPM systématique sur images (paliers de compression resserrés, 1 Mo/768px → 300 Ko/512px). Dettes mineures identifiées mais volontairement reportées (boucle sur message trivial, `create_lead` sans validation téléphone côté code) — prises en charge par Souhaib hors session Claude.