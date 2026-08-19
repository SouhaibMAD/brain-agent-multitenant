# Architecture — Brain Agent multitenant

> Journal des décisions d'architecture, avec justification. Mis à jour à chaque bloc d'implémentation. Objectif : pouvoir justifier n'importe quel choix technique devant le jury sans avoir à s'en souvenir de mémoire.

---

## BLOC 0 — Cadrage général

### Architecture à deux plans (control plane / data plane)

**Décision** : séparer une base "control plane" (registre des tenants, users, rôles) d'une base "data plane" par tenant (produits, conversations, leads).

**Justification** : le control plane ne contient jamais de données métier — uniquement "qui est ce tenant et où trouver sa base". Ça isole strictement la couche d'authentification/autorisation de la couche métier, et rend le provisioning d'un nouveau tenant mécanique (une ligne dans `tenants` + une nouvelle base Neon).

### Database-per-tenant + RLS

**Décision** : chaque tenant a sa propre base Postgres (Neon), imposé par l'encadrant.

**Justification** : isolation maximale des données entre clients — pas de risque de fuite croisée par une requête mal filtrée (contrairement à un modèle shared-schema avec `tenant_id` sur chaque table, où un bug applicatif peut exposer les données d'un autre tenant). Coût : plus de bases à gérer, mais Neon serverless (scale-to-zero) rend ça viable en développement/V1.

**Décision actée** : RLS non nécessaire — clarifié avec Mounim. L'isolation database-per-tenant est jugée suffisante comme mécanisme de sécurité multitenant.

---

## BLOC 1 — Control plane & Auth

### Hash de mot de passe : argon2id

**Décision** : argon2id plutôt que bcrypt.

**Justification** : argon2id est l'algorithme recommandé actuellement par OWASP, résistant aux attaques par GPU et par side-channel (variante hybride entre argon2i et argon2d). `argon2.hash()` encode salt + paramètres + hash dans une seule string — pas besoin de gérer le salt séparément en base.

### Sessions : JWT access token + refresh token hybride

**Décision** : access token JWT stateless (courte durée, 15 min) + refresh token JWT signé, dont seul le hash SHA-256 est stocké en base (longue durée, 7 jours), avec rotation à chaque refresh.

**Justification** :
- Un JWT stateless pur (sans DB) serait impossible à révoquer avant expiration — inacceptable pour un logout ou une compromission de compte.
- Une session 100% en DB (vérifiée à chaque requête) serait plus sûre mais alourdit chaque requête protégée d'un aller-retour DB.
- Le compromis choisi : l'access token reste stateless (vérification rapide, pas de DB, mais courte durée limite les dégâts si volé), le refresh token est révocable via la DB (logout, compromission) car il vit plus longtemps donc représente un risque plus élevé s'il fuit.
- **Refresh token hashé en DB** (jamais stocké en clair) : même logique que pour un mot de passe — si la base fuite, un attaquant n'a pas directement les tokens utilisables.
- **Rotation à chaque refresh** : l'ancien refresh token est marqué `revokedAt` et un nouveau est émis. Limite la fenêtre d'exploitation d'un refresh token volé à une seule utilisation avant invalidation.

**Amélioration future identifiée** : détecter la réutilisation d'un refresh token déjà révoqué (signe probable de vol) et révoquer toute la chaîne de sessions de l'utilisateur en réaction.

### Statut `super_admin` : booléen global sur `users`, pas un rôle dans `user_tenant_roles`

**Décision** : ajout d'un champ `isSuperAdmin` (boolean) directement sur la table `users`, plutôt que d'utiliser la valeur d'enum `super_admin` déjà présente dans `user_tenant_roles.role`.

**Justification** : le CDC définissait `super_admin` comme une valeur de rôle scopée à un tenant, ce qui crée une ambiguïté — un contrôle total plateforme n'a pas de sens à être rattaché à un tenant précis. En sortant ce statut sur `users.isSuperAdmin`, on élimine cette ambiguïté : c'est un flag technique de plateforme, indépendant de tout tenant.

**Vérification en DB à chaque requête (pas de confiance au JWT)** : le payload JWT ne contient que `userId` et `email`. Si `isSuperAdmin` changeait après émission du token, un JWT qui l'embarquerait resterait valide avec l'ancien statut jusqu'à expiration — fenêtre de risque jugée trop longue pour un droit aussi sensible. Le coût d'un aller-retour DB supplémentaire est acceptable, ces routes n'étant pas appelées à haute fréquence.

**Conséquence pratique** : `isSuperAdmin` et `user_tenant_roles` sont strictement indépendants — un super admin n'a pas automatiquement accès aux routes scopées-tenant (`tenantMiddleware`). Un utilisateur doit avoir une ligne explicite dans `user_tenant_roles` pour accéder aux ressources d'un tenant donné.

### Middlewares empilés : `authMiddleware` → `tenantMiddleware` / `requireSuperAdmin`

**Décision** : deux middlewares d'autorisation distincts selon le contexte de la route :
- `tenantMiddleware` : vérifie l'accès de l'utilisateur à un tenant précis via `user_tenant_roles`
- `requireSuperAdmin` : vérifie le flag global `isSuperAdmin` (routes de gestion plateforme)

**Justification** : ces deux vérifications répondent à des questions différentes ("cet utilisateur a-t-il accès à CE tenant" vs "cet utilisateur contrôle-t-il la plateforme entière") et ne doivent jamais être confondues.

**Ordre des middlewares** : `authMiddleware` doit systématiquement s'exécuter avant `tenantMiddleware`/`requireSuperAdmin`, car ces derniers lisent `req.user`, attaché uniquement par `authMiddleware`.

### Protection IDOR (Insecure Direct Object Reference)

**Décision** : `tenantMiddleware` vérifie explicitement l'existence d'une ligne dans `user_tenant_roles` pour `(userId, tenantId)` avant d'autoriser l'accès à une ressource scopée-tenant.

**Justification** : sans ce contrôle, un utilisateur authentifié pourrait accéder aux données de n'importe quel tenant simplement en changeant l'`id` dans l'URL. C'est la vérification centrale de toute la sécurité multitenant de la plateforme.

**Note pratique** : `req.tenantRole` ne contient que le rôle, pas d'objet enrichi — le `tenantId` reste accessible uniquement via `req.params.tenantId`.

### Structure `app.ts` / `server.ts`

**Décision** : séparation entre `app.ts` (configuration Express) et `server.ts` (point d'entrée réel — env, `listen`).

**Justification** : permet de tester `app` directement (Supertest) sans démarrer un vrai serveur réseau.

---

## BLOC 2 — Data plane & provisioning

### Séparation lead/order plutôt qu'un statut unique

**Décision** : deux tables distinctes, `leads` (qualification) et `orders` (commande concrète).

**Justification** : un client peut générer plusieurs commandes au cours d'une même conversation/lead. Anticipe aussi le mapping futur avec les webhooks Shopify.

**Liens nullable** : `leads.conversationId` et `orders.leadId` sont volontairement nullable — création manuelle possible sans lien.

### `channel`/`direction` en varchar plutôt qu'enum Postgres

**Décision** : le canal (whatsapp/facebook/instagram) et la direction (`inbound`/`outbound`) sont stockés en `varchar`, pas en enum Postgres.

**Justification** : un enum impose une migration SQL (avec verrou) à chaque nouvelle valeur. Le varchar permet d'ajouter une valeur directement côté code et déporte la validation stricte vers la couche applicative (Zod + TypeScript) — la rigueur du typage vient du code, la flexibilité vient de la base. Principe appliqué de façon cohérente à travers tout le schéma tenant.

### `whatsapp_sessions` : multi-session par tenant dès la conception

**Décision** : pas de contrainte unique tenant→session ; un tenant peut avoir plusieurs sessions WhatsApp.

**Justification** : anticipe un besoin réaliste (plusieurs boutiques/numéros) sans nécessiter de migration de structure plus tard.

### Provisioning : un projet Neon par tenant, asynchrone via BullMQ

**Décision** : chaque tenant déclenche la création d'un **projet Neon complet** (pas une simple database dans un projet partagé), de façon asynchrone via BullMQ (Redis Upstash).

**Justification** :
- **Un projet = un tenant** : conforme à l'isolation totale voulue par Mounim — une database au sein d'un même projet partage le même compute, ce n'est pas une isolation réelle.
- **Asynchrone** : créer un projet Neon + appliquer les migrations prend plusieurs secondes — bloquer la requête HTTP dégraderait l'UX et exposerait à un timeout.
- **BullMQ plutôt qu'une Promise** : retry automatique avec backoff exponentiel pour les échecs transitoires (timeout, quota, 5xx Neon).
- **Process worker séparé du serveur API** : la charge de provisioning n'impacte jamais la disponibilité de l'API principale.
- **Redis managé (Upstash)** : évite une dépendance d'infrastructure locale supplémentaire.

**Point de vigilance résolu** : politique d'éviction Upstash passée à `noeviction` — garantit qu'aucun job de provisioning ne soit perdu silencieusement sous pression mémoire.

### `tenants.databaseUrl` nullable + `neonProjectId` / `provisioningStatus`

**Décision** : `databaseUrl` nullable ; ajout de `neonProjectId` (nullable) et `provisioningStatus` (`pending`/`ready`/`failed`).

**Justification** : au moment de l'`INSERT` initial d'un tenant, sa base Neon n'existe pas encore. `provisioningStatus` sert de garde-fou explicite : aucune tentative de connexion tant que le statut n'est pas `ready`.

### Gestionnaire de connexions dynamique : cache mémoire, driver `neon-serverless`

**Décision initiale** : `getTenantDb(tenantId)` résout tenantId → instance Drizzle, cache `Map` en mémoire. Driver initial `neon-http`.

**Révision (BLOC 3)** : passage à **`neon-serverless`** (WebSocket `Pool`), suite à la découverte que `neon-http` ne supporte pas les transactions SQL — bloquant pour l'import catalogue, qui a besoin d'atomicité.

**Justification du périmètre (tenant uniquement)** : le control plane fait du CRUD simple sans besoin d'atomicité identifié — `neon-http` y reste adapté et plus léger. Le plan tenant accumule des opérations transactionnelles (import, futures écritures lead+order liées) — `neon-serverless` y est le bon choix.

**Gestion de cycle de vie** : le worker de provisioning ferme explicitement son `Pool` (`pool.end()`) après chaque migration, pour éviter une accumulation de connexions WebSocket.

### Endpoint d'assignation user↔tenant : module séparé, bootstrap uniquement

**Décision** : nouveau module `tenant-roles` (`POST/GET /api/tenants/:tenantId/roles`), plutôt que d'étendre `POST /auth/register`.

**Justification** : créer un compte (identité) et donner accès à un tenant (autorisation) sont deux actions conceptuellement distinctes — même logique que la séparation d'`isSuperAdmin`.

**Protection `requireSuperAdmin`** : action de gestion plateforme, pas une action scopée-tenant classique — `tenantMiddleware` ne conviendrait pas (problème d'œuf et de poule pour le tout premier utilisateur d'un tenant).

**Garde explicite contre `role: "super_admin"`** : la valeur existe encore dans l'enum Postgres (retirer une valeur d'enum en prod est lourd), mais devenue une relique morte. Sans garde, l'endpoint créerait silencieusement une ligne inerte. La garde transforme ce piège en erreur explicite (`USE_IS_SUPER_ADMIN_FLAG_INSTEAD`).

**Portée initiale : bootstrap uniquement** — extension self-service ajoutée plus tard, BLOC 6.4 (voir plus bas).

---

## BLOC 3 — Catalogue produits

### Refonte du schéma : séparation `products` (descriptif) / `product_variants` (vendable)

**Décision** : `products` ne contient que des champs descriptifs. Toute donnée vendable (`sku`, `price`, `stock`, `attributes`) est déplacée vers `product_variants`, relation `1-N` (`onDelete: cascade`).

**Justification** : dans la plupart des catalogues réels, c'est la **variante** (taille, couleur) qui porte un SKU unique, pas le produit parent. Un jsonb pour les variantes aurait empêché toute contrainte d'unicité SQL propre. La table séparée permet un `UNIQUE` réel sur `sku` et une meilleure adéquation avec le garde-fou anti-hallucination de l'agent IA (BLOC 4).

**`attributes` en jsonb libre** : les attributs de variante ne sont pas universels selon le secteur d'activité du tenant — un jsonb reste flexible sans imposer un schéma de colonnes figé.

### `sku` unique scopé implicitement par tenant

**Décision** : `product_variants.sku` porte une contrainte `UNIQUE` simple, sans colonne `tenant_id`.

**Justification** : conséquence directe du modèle database-per-tenant — un `UNIQUE` simple *est* déjà scopé au tenant.

### `productRef` : nullable, unique, jamais utilisé comme clé d'affichage

**Décision** : `products.productRef` (varchar, nullable, `UNIQUE`) stocke une référence externe fournie par le vendeur, utilisée uniquement pour le matching produit lors d'imports successifs.

**Justification** : sans cette référence, un import incrémental ne pourrait retrouver le bon produit parent qu'en connaissant déjà le SKU d'une variante sœur — casse dès qu'on ajoute une variante inédite.

### Format d'import : une ligne = une variante, regroupée par `product_ref`

**Décision** : chaque ligne du fichier importé représente une variante individuelle ; le regroupement en produits se fait par `product_ref`, les champs descriptifs n'étant lus que sur la première ligne de chaque groupe.

**Justification** : ce format reflète directement la structure `products`/`product_variants` en base, sans format intermédiaire à réconcilier.

### Endpoint d'import unifié (CSV + JSON), détection par extension

**Décision** : un seul endpoint accepte `.csv`/`.json`, détecté via l'extension du fichier, avec repli sur le MIME type.

**Justification** : évite de dupliquer toute la logique dry-run/replace/merge sur deux routes. L'extension est priorisée car le MIME type déclaré côté client peut être peu fiable.

**Upload en mémoire (`multer`, `memoryStorage`)** : catalogues V1 (quelques milliers de lignes) pèsent typiquement moins de 2 Mo — un `Buffer` évite toute dépendance disque, problématique sur infrastructure serverless.

### Architecture d'import en 5 phases

**Décision** : parsing/validation → groupement par `product_ref` → chargement de l'état existant (2 requêtes batch) → résolution des décisions en mémoire → exécution (transaction unique, sautée en dry-run).

**Justification** : le chargement en batch est la seule approche viable en production. La séparation stricte décision/exécution permet au dry-run de réutiliser **exactement le même chemin de code** que le mode réel jusqu'à l'écriture.

### Règles de décision en mode fusion (upsert par SKU)

**Décision** :
- SKU existant + même `product_ref` → mise à jour de la variante.
- SKU existant + `product_ref` différent → **ligne rejetée explicitement**, jamais de déplacement silencieux.
- SKU inexistant + `product_ref` connu → nouvelle variante rattachée au produit existant.
- SKU inexistant + `product_ref` nouveau → création d'un nouveau produit (une fois par groupe).

**Justification du rejet** : autoriser le déplacement silencieux masquerait une vraisemblable erreur de saisie (SKU réutilisé par erreur), avec un effet de bord difficile à détecter a posteriori.

### Mode remplacement (`replace`) : suppression totale

**Décision** : suppression intégrale de `products`/`product_variants` (cascade), puis réinsertion, en transaction unique.

**Justification** : une portée plus fine introduirait une ambiguïté (produit dont le nom a légèrement changé) sans bénéfice clair en V1.

### Dry-run : résumé chiffré + détail des erreurs ligne par ligne

**Décision** : résumé (`created`/`updated`/`rejected`/`totalRows`) + tableau `errors` (`rowNumber`/`productRef`/`sku`/`reason`).

**Justification** : un résumé seul ne permettrait pas de corriger le fichier ; un détail seul rendrait difficile d'évaluer l'ampleur du problème.

---

## BLOC 4 — Agent IA (décision architecturale revue en session)

### Abandon de Flowise au profit d'un agent code-first (Groq SDK, sans LangChain/LangGraph)

**Décision** : après une session de mise en place approfondie (Docker, puis npm global), Flowise a été abandonné. L'agent est implémenté directement en TypeScript, via l'API Groq (function calling natif), sans LangChain ni LangGraph.

**Justification — problèmes Flowise** :
- **Docker** : l'image `latest` plante au démarrage, l'image `1.4.4` nécessite une commande non documentée, consommation RAM excessive.
- **npm global** : centaines de conflits de peer dependencies (écosystème LangChain versionné de façon incohérente), modules manquants en cascade, interface web bloquée sur un bug connu non résolu (issue GitHub).
- Version antérieure figée testée : même blocage, incompatibilité Node.js identifiée.

**Pourquoi ni LangChain ni LangGraph en remplacement** : l'agent V1 a un flow linéaire simple par message (recevoir → décider d'appeler l'outil catalogue → répondre), ne justifiant pas cette couche d'abstraction ni ses propres risques de versioning. Le SDK Groq expose du function calling natif (format compatible OpenAI) — la boucle complète s'implémente directement.

**Conséquence** : `catalog.service.ts` et le prompt système déjà rédigés restent valides. Seul le mécanisme d'invocation change : `searchCatalog()` est appelée directement en mémoire depuis l'agent (même process Node), simplifiant l'architecture.

### Migrations successives du modèle Groq

**Décision** : `llama-3.3-70b-versatile` → `openai/gpt-oss-120b` → `qwen/qwen3.6-27b` (définitif, cf. BLOC 5bis).

**Justification de la première migration** :
1. **Dépréciation officielle** — Groq a annoncé l'arrêt de `llama-3.3-70b-versatile` au 16 août 2026, avant la fin du stage.
2. **Taux d'échec `tool_use_failed` élevé** — le modèle générait fréquemment sa réponse de tool-calling dans un format non-JSON, provoquant des rejets API même sur des demandes simples.

**Mesures conservées comme filet de sécurité** : schema strict des tools, retry ciblé sur détection `tool_use_failed`.

**Règle du projet actée** : toujours vérifier la disponibilité réelle des modèles via `GET /v1/models` du compte plutôt que via une recherche web, qui peut refléter une liste datée ou un autre tier — plusieurs candidats initialement envisagés (Llama 4, Kimi K2, Qwen3 32B) n'existaient pas sur ce compte.

### Recherche catalogue : hybride full-text + vectorielle

**Découverte 1 — attributs de variante invisibles à la recherche** : les attributs qu'un client utilise le plus (couleur, taille) vivent sur `product_variants.attributes` (jsonb), jamais sur `products`. Une recherche combinant nom + attribut échouait systématiquement (ET logique strict de `websearch_to_tsquery`).

**Décision** : `search_vector` dédié sur `product_variants`, combinant nom du produit parent, SKU, et attributs.

**Problème technique** : Postgres interdit une sous-requête dans une colonne `GENERATED ALWAYS AS`. **Décision (dénormalisation)** : colonne `product_variants.product_name_snapshot`, remplie applicativement à chaque insert/update de variante — cohérent avec le principe déjà établi (rigueur des données côté TypeScript, flexibilité côté DB). **Dette assumée** : si le nom d'un produit change, les snapshots déjà écrits deviennent obsolètes jusqu'à resynchronisation.

**Découverte 2 — le dictionnaire Postgres ne gère pas les variations morphologiques attendues** : ni `'simple'` ni `'french'` (stemming Snowball) ne suffisent pour les pluriels/variations, et aucun ne couvrirait de toute façon le mélange français/darija/arabe attendu.

**Décision** : recherche vectorielle en complément, embeddings locaux (`Xenova/multilingual-e5-small`, 384d, ONNX Runtime CPU) — pas d'appel réseau externe, pas de coût par appel. `pgvector` sur Neon.

**Portée** : recherche **hybride** (`UNION`, dédupliquée par `MAX(rank)`) — le full-text reste pertinent pour le matching exact (SKU), le vectoriel comble les variations morphologiques/linguistiques.

**Limite assumée** : couverture réelle du modèle sur la darija marocaine romanisée non garantie, non testée formellement faute de jeu de données réel.

**Seuil de similarité** : `VECTOR_SIMILARITY_THRESHOLD = 0.75`, non calibré empiriquement — **dette ouverte, reportée post-stage** (décision actée session 14/08).

### Résolution de la dette filtres category/min_price/max_price

**Cause racine identifiée** : paramètre `NULL` interpolé dans un template `sql\`\`` sans cast explicite empêche Postgres de déterminer le type à la préparation de la requête (`neon-serverless`) — erreur `42P18` (`could not determine data type of parameter`).

**Piège de diagnostic** : l'erreur réelle était absorbée par le try/catch de résilience de `agent.service.ts`, masquée derrière un message générique renvoyé au LLM. **Enseignement retenu** : lors du debug d'un tool utilisé par l'agent, toujours tester la fonction directement, hors de la boucle function-calling.

**Décision — cast explicite systématique** : tout paramètre nullable interpolé dans un `sql\`\`` doit être casté (`::text`, `::numeric`) — règle générale du projet.

**Décision — emplacement des filtres** : appliqués une seule fois dans le `SELECT` final, jamais dupliqués dans les branches du `UNION`.

**Décision — double application `min_price`/`max_price`** : à la fois dans le `WHERE EXISTS` (décide si le produit apparaît) et dans le `FILTER` du `json_agg` (décide quelles variantes sont montrées) — évite à la fois l'absence du produit et l'apparition de variantes hors fourchette (violation du garde-fou anti-hallucination).

**Validé formellement** par tests isolés sur un jeu de données enrichi (catégories/prix discriminants).

### Validation de la détection d'intention de commande + correction prompt

**Méthode** : scénario à 4 messages (demande produit → intention d'achat → nom → téléphone), même `conversationId`.

**Résultat, 1ère passe** : comportement métier correct, mais `search_catalog` rappelé inutilement à 3 messages sur 4 (coût embedding + SQL + Groq superflu).

**Cause** : la règle anti-hallucination autorisait déjà de ne pas rappeler l'outil si les résultats étaient visibles dans l'historique, mais formulée comme exception secondaire en fin de phrase — le modèle privilégiait la prudence.

**Correction** : reformulation — le cas positif (ne PAS rappeler) énoncé en premier, de façon catégorique, avec exemple concret. **Validé post-correction** : `search_catalog` appelé une seule fois sur les 4 messages. Gain mesuré : ~1967ms pour un message sans tool call (vs. plus long avec rappel superflu).

### Résilience de l'agent — filets de sécurité multi-niveaux

**Décision** : `agent.service.ts` n'autorise jamais qu'une exception remonte brute jusqu'au controller — un webhook qui ne reçoit pas de 200 va retenter, risquant de dupliquer le traitement.

**Niveaux de défense** :
1. Tool call individuel échoue → message d'erreur structuré renvoyé au LLM (le LLM reste disponible).
2. Erreur Groq (API down, quota, `tool_use_failed` après retry) → fallback texte fixe bilingue FR/darija.
3. Écriture DB pendant l'escalade échoue → try/catch, log, process continue.
4. Écriture finale du message assistant échoue → retourne `{ skipped: true }` au lieu de planter.

**Décision produit associée** : dans tous ces cas, le controller retourne HTTP 200 (jamais 500) — le message entrant est déjà sauvegardé, un retry dupliquerait sans rien résoudre. Le signal d'alerte doit venir des logs applicatifs, pas du code HTTP.

### Garde-fou handover : arrêt strict de l'agent une fois escaladé

**Décision** : dès qu'une conversation passe à `'handover'`, plus aucun appel Groq — vérifié en tout premier, avant même le chargement de l'historique. Le message entrant reste toujours sauvegardé en DB.

### Tools du function-calling — contrat strict entre schema et exécution

**`search_catalog`** : `query` (obligatoire), `min_price`/`max_price`/`category` (optionnels, tous exploités côté exécution).

**`create_lead`** : appelé uniquement une fois `customer_name`+`phone` obtenus (contrainte prompt, pas schema). Upsert par `conversationId`. Le LLM doit renvoyer l'intégralité des infos connues à chaque appel (Drizzle traite `undefined` comme "ne pas modifier", mais `null`/vide écraserait) — fragilité documentée, dépend à la fois du code et de la discipline du prompt.

**`escalate_to_human`** : `reason` écrit dans `internalNotes` (écrase avant BLOC 6, harmonisé ensuite avec `appendNoteEntry`).

---

## BLOC 5 — Canal WhatsApp (Baileys, non-officiel)

### Architecture à 3 process : API, provisioning-worker, whatsapp-worker

**Décision** : un troisième process (`whatsapp-worker.ts`) dédié aux sockets Baileys, séparé du serveur API et du worker de provisioning.

**Justification** : Baileys maintient une connexion WebSocket persistante — mélanger ça avec le serveur API (stateless/scalable) aurait été un mauvais couplage.

**5 queues BullMQ** : `whatsapp-session-control`, `whatsapp-outbound` (API→worker), `whatsapp-inbound`, `whatsapp-status` (worker→API), plus `whatsapp-agent-trigger` (debounce, voir plus bas).

**Justification "queue" plutôt qu'appel HTTP/import direct** : le whatsapp-worker reste volontairement "bête" (sockets Baileys + control plane + queues) — cohérent avec la philosophie déjà en place. Une queue donne gratuitement le retry/backoff.

### Séparation stricte control plane (creds) / tenant DB (statut)

**Décision** : creds Baileys en control plane (donnée d'infrastructure/accès) ; statut de connexion en tenant DB.

**`whatsapp_signal_keys` en table normalisée** : collection dynamique qui grossit avec le temps — une table `(sessionId, keyType, keyId, keyData)` colle naturellement à l'interface Baileys, évite de réécrire un blob géant à chaque update.

**`tenantId` porté directement dans le payload de `whatsapp-status.queue.ts`** : corrige un piège d'œuf-et-poule découvert en test réel (logout supprime les creds avant que le statut ne soit publié).

### Auth state Baileys custom, branché sur le control plane

**Décision** : `whatsapp-auth-state.ts` implémente `makeControlPlaneAuthState`, remplaçant `useMultiFileAuthState` (explicitement déconseillé en production par Baileys lui-même).

**Détails techniques** : sérialisation `BufferJSON` (Buffers cryptographiques), wrapper `{ value }` pour les signal keys (typage honnête côté Drizzle), cas spécial `app-state-sync-key` nécessitant `proto.Message.AppStateSyncKeyData.fromObject()`.

**`saveCreds()` initial forcé** : garantit que `sessionId → tenantId` est résolvable dès le premier event, sans attendre le premier `creds.update` réel.

### `SessionManager` : encapsulation des sockets actives

**Décision** : classe singleton, `Map<sessionId, WASocket>` privé.

**`loggedOutSessions: Set<string>`** : distingue absence temporaire (reconnexion légitime) d'absence définitive (logout) — `UnrecoverableError` levée si `isLoggedOut`, court-circuite le retry BullMQ inutile.

**Reconnexion automatique** : `setTimeout` 5000ms sur `connection === "close"` si pas un logout — validé en conditions réelles (code 515, phénomène documenté Baileys, se résout automatiquement).

**Configuration socket ajustée** : `fetchLatestBaileysVersion()` retiré (causait un rejet du handshake malgré scan QR réussi), `markOnlineOnConnect: false`.

**Filtrage `messages.upsert`** : `type !== "notify"` ignoré, `msg.key.fromMe` ignoré (écho bot + bruit protocolaire), messages sans texte extractible ignorés (avant support vision, BLOC 5bis).

### Diagnostic du "délai de livraison variable"

**Méthode itérative** : élimination successive de deux hypothèses (filtre `fromMe` trop agressif, bug de code introduit récemment) avant la découverte réelle — une conversation de test restée en `handover` bloquait légitimement l'agent (règle métier, pas un bug), superposée à un vrai délai de stabilisation de session (~6 min, observé, cause probable liée à l'adressage `@lid` récent de WhatsApp sur les versions `rc` de Baileys).

**Enseignement** : face à un symptôme complexe multi-causes, isoler une variable à la fois permet de distinguer un comportement métier correct non anticipé d'une vraie limite d'écosystème tierce.

### Module `conversations` — agnostique du canal

**Décision** : nouveau module dédié plutôt que d'ajouter l'envoi manuel dans `modules/whatsapp/` — prépare la centralisation multi-canaux prévue par le CDC (dispatch interne par `conversation.channel`).

**`conversations.whatsappSessionId`** (nullable, FK `set null`) : résout quelle session sert à l'envoi (multi-session déjà prévue).

**`conversations.botEnabled`** (indépendant de `status`) : un lead qualifié ayant besoin d'un conseiller ne doit pas perdre son statut commercial simplement parce qu'un humain reprend temporairement la main.

**Ordre d'opérations dans `sendManualMessage`** : enqueue avant écriture DB — si l'enqueue échoue, pas de message "outbound" fantôme.

---

## BLOC 5bis — Support images/screenshots produits

### Contexte

CDC Phase 1 ("gérer screenshots produits via contexte image/produit") — traité en session dédiée, arbitrage assumé : un ajout produit visible en démo vaut mieux que de l'observabilité backend à ce stade du calendrier.

### Choix du modèle Groq — migration forcée puis confirmée bénéfique

**Décision** : migration vers `qwen/qwen3.6-27b` comme modèle unique (texte ET vision).

**Justification** : `openai/gpt-oss-120b` n'a que `input_modalities: ["text"]`. `qwen/qwen3.6-27b` est le seul modèle du compte combinant vision ET `tools`/`json_mode`/`reasoning` — seul candidat capable de garder le function-calling existant tout en traitant une image.

**Option écartée — double modèle conditionnel** : fragmenterait le comportement de l'agent, complexifierait `agent.service.ts`. Un seul modèle est plus simple à raisonner et décrire au jury.

**Confirmation post-migration** : qwen était déjà identifié comme piste d'amélioration qualité avant même le besoin vision — la contrainte technique et l'amélioration qualité pointaient vers la même décision.

### Pipeline image entrant

**Réception (Baileys)** : `imageMessage` distingué explicitement du texte, téléchargé (`downloadMediaMessage`), compressé, enqueue avec `messageType: "image"` en base64 — le processor API n'a aucune dépendance Baileys.

**Compression (`image-compression.ts`)** : `sharp`, resize max 768px, JPEG paliers 70/50/30 jusqu'à passer sous 1 Mo. Rejet uniquement si échec au palier le plus bas.

**Persistance** : `messages.mediaBase64`/`mediaMimeType`, migration `0009_add_message_media.sql` (appliquée manuellement Neon SQL Editor + versionnée pour le provisioning automatique).

**Traitement — hors debounce, immédiat** : contrairement au texte, une image déclenche `processIncomingMessage` directement — regrouper dans la fenêtre de debounce texte aurait exigé d'étendre le format de stockage Redis pour un gain faible. Un texte déjà accumulé juste avant l'image est récupéré et fusionné à la caption.

**Construction du message vision** : `content` multi-part (`image_url`+`text`) uniquement si une image est présente sur CE tour précis — l'historique rechargé reste toujours du texte simple.

**Prompt système** : trois comportements — produit identifiable → `search_catalog` ; réclamation/défaut → `escalate_to_human` direct ; image inexploitable → demande de précision.

### Bugs découverts en test réel — trois rounds de correction

Premier test de charge réel de `qwen/qwen3.6-27b` — plusieurs comportements spécifiques à ce modèle sont apparus.

**Round 1** : rate limit (429 TPM) confondu avec une panne définitive → détection explicite + retry respectant le délai suggéré par Groq. Race condition Redis (`LRANGE`+`DEL` non atomiques) découverte en revue de code → transaction `MULTI`/`EXEC` atomique.

**Round 2** : `min_price`/`max_price` envoyés comme string littérale `"None"` par qwen → schema assoupli (`['number','string','null']`, `required` réduit à `query` seul) + sanitization défensive côté exécution. Réponse finale vide répétée (fréquent avec qwen, pas une exception) → retry actif (relance explicite du modèle) avant fallback, `MAX_TOOL_ROUNDS` relevé de 4 à 6.

**Round 3** : requêtes trop volumineuses (413, image + historique complet dépassant 8000 TPM) → `HISTORY_LIMIT` réduit à 6 messages en présence d'image, compression resserrée à 768px, détection explicite de ce cas pour exclure le retry (requête structurellement trop grosse).

### Limite structurelle non résolue — plafond TPD (Tokens Per Day) du compte Groq

**Découverte** : `429` sur `tokens per day`, pas `tokens per minute` — plafond de compte Groq (tier `on_demand`), appliqué au niveau organisation, pas clé API (régénérer une clé n'a aucun effet, vérifié).

**Comportement du système** : le fallback + escalade déjà en place absorbe ce cas correctement — aucun crash, aucune conversation bloquée silencieusement.

**Décision à prendre avant soutenance, non tranchée** : vérifier un palier "Dev Tier" Groq, ou doser la démonstration (éviter les rafales multi-contacts avec images enchaînées).

### Round 4 (session de durcissement post-BLOC 9ter) — reasoning leak et resserrage TPM

**Fuite de raisonnement brut (`<think>`/`<thought>`)** : `qwen/qwen3.6-27b` est un modèle "reasoning" — observé en conditions réelles exposant son raisonnement interne directement dans le `content` de la réponse finale, au lieu de le confiner à un champ dédié. Comportement de la même famille que celui déjà rencontré avec `gemma-4-26b` lors de l'exploration BLOC 9ter (`<thought>` non parsé), mais jamais vu côté qwen jusqu'à ce test.

**Décision** : fonction `stripReasoningBlocks()` dans `agent.service.ts` — retire tout bloc `<think>...</think>` ou `<thought>...</thought>` (insensible à la casse, multi-ligne, quelle que soit sa position dans le texte) avant d'assigner `finalReply`. Log `console.warn` si un bloc est retiré, pour garder une trace de fréquence sans bloquer le flux. Si le texte restant après nettoyage est vide, retombe naturellement sur la logique de relance forcée déjà existante (content vide == pas de réponse exploitable).

**Resserrage des paramètres de compression image** : la limite initiale (1 Mo, 768px, paliers 70/50/30) provoquait des 413 "Request too large" systématiques en usage réel — le budget de 8000 TPM (compte Groq, tier `on_demand`) doit couvrir l'image encodée en vision (facturation approximativement par tuile, pas linéaire aux octets) EN PLUS du system prompt, du schema des tools, et de l'historique réduit (`HISTORY_LIMIT_WITH_IMAGE`). Marge insuffisante avec les valeurs initiales.

**Décision** : `MAX_BYTES` abaissé à 300 Ko, `MAX_WIDTH` à 512px, palier de qualité supplémentaire (20) ajouté à `QUALITY_STEPS` pour maximiser les chances de passer sous la limite sur un screenshot chargé sans rejeter l'image d'emblée.

**Validation** : les deux fixes confirmés en test réel — scénario multi-tours avec 2 images, conversations en darija/arabizi (réponse en arabe standard, sans fuite de raisonnement), plus aucun 413 sur les messages avec image.

**Dettes identifiées durant ce test, volontairement non traitées à ce stade (décision Souhaib)** :
- Comportement de boucle/relance excessive sur un message client trivial (`"?"`, `"I see"`) — hypothèse non confirmée : la relance forcée sur réponse vide (`réponse vide sans tool call, relance forcée`) n'a pas de garde-fou empêchant sa répétition sur plusieurs rounds de la boucle principale, consommant potentiellement plusieurs unités de `MAX_TOOL_ROUNDS` sur un message qui n'en nécessitait qu'un seul.
- `create_lead` reste appelable sans téléphone malgré la contrainte prompt ("UNIQUEMENT une fois que tu as le nom ET le téléphone") — contrainte purement déclarative, aucune vérification côté code dans `executeToolCall` avant l'appel à `upsertLeadForConversation`. Un lead incomplet (adresse renseignée, téléphone absent) a été observé sur une session de test antérieure à ce fix.
---

## BLOC 6 — Frontend, Inbox, Leads

### Stack & structure

React/Vite, TanStack Query (cache scopé `queryKey` par `user.id`), React Router (chemins absolus obligatoires), axios avec intercepteur refresh token.

### Auth : refresh token migré vers cookie httpOnly

**Décision** : le refresh token JWT part dans un cookie `httpOnly`, `sameSite: lax`, `secure` en prod. Seul l'access token reste manipulable en JS.

**Justification** : même une faille XSS ne peut plus exfiltrer le refresh token. Coût : CORS whitelist explicite (`credentials: true` incompatible avec `origin: "*"`), ajout `cookie-parser`, `GET /auth/me`.

### Bug de sécurité corrigé : cache HTTP croisé entre utilisateurs

**Symptôme** : après changement de compte, `GET /tenants/my` retournait un `304` avec les données de l'utilisateur précédent — aucune route authentifiée n'envoyait de `Cache-Control`.

**Fix** : `authMiddleware` pose `Cache-Control: no-store` sur toute réponse authentifiée. Défense en profondeur frontend : `queryClient.clear()` au login/logout, `queryKey` scopées par `user.id`.

**Point à garder pour le jury** : bon exemple concret de piège cache+auth classique en architecture web.

### Sélecteur de tenant

`GET /api/tenants/my` (jointure `userTenantRoles`→`tenants`). 1 seul tenant → redirection automatique. Plusieurs → sélecteur affiché, dernier choix mémorisé en `localStorage` uniquement pour pré-surligner (jamais pour sauter l'écran si plusieurs tenants existent — bug corrigé, voir décisions actées).

### Notes internes : historique horodaté plutôt qu'écrasement

**Décision** : utilitaire partagé `appendNoteEntry` — chaque écriture s'empile (`[timestamp] auteur : contenu`), jamais d'écrasement, peu importe la source (agent IA ou humain).

### Résolution du nom client affiché (limite protocole, pas un bug)

`@lid` (Linked ID) est opaque, non décodable. Ordre de résolution : nom du lead → numéro extrait si `@s.whatsapp.net` → identifiant `@lid` tronqué en dernier recours.

### Vue détail lead : pas de page séparée

**Décision** : liste simple + lien `?conversation=<id>` vers l'Inbox plutôt qu'une vue détail dupliquée — un lead est toujours rattaché à une conversation déjà consultable.

### 6.4 — Self-service tenant

`requireTenantAdmin.middleware.ts` : vérifie `req.tenantRole === "admin_tenant"`.

**`POST /:tenantId/invite`** : service dédié `inviteUserToTenant`, distinct du chemin bootstrap — permissions et rôles assignables différents (bootstrap : tous rôles, `requireSuperAdmin` ; self-service : `agent`/`viewer` uniquement, `requireTenantAdmin`).

**Décision produit** : email inconnu → `USER_NOT_FOUND` (404) immédiat, pas de création de compte à la volée.

**`SelfServiceAssignableRole = "agent" | "viewer"`** exclut `admin_tenant`/`super_admin` au niveau du type, en plus du contrôle runtime.

### UI d'assignation user↔tenant

**Décision — deux pages distinctes** : `TenantUsers.jsx` (`/admin/tenants/:tenantId/users`, super_admin) et `TeamManagement.jsx` (`/:tenantSlug/team`, self-service admin_tenant) — reconduit la séparation déjà actée côté backend.

**`GET /users/lookup?email=`** : résolution à portée unique (email → `{id, email, fullName, isSuperAdmin}`), protégé `requireSuperAdmin`, plutôt qu'un `GET /users` générique plus large que nécessaire.

**Flow bootstrap en deux temps** (recherche puis confirmation) : évite qu'une faute de frappe sur l'email assigne silencieusement un rôle au mauvais compte.

**`tenantMiddleware` étendu** : laisse passer un super_admin sans ligne `user_tenant_roles` explicite (cas réel rencontré — un super_admin plateforme peut légitimement n'avoir de rôle explicite que sur un seul tenant parmi plusieurs gérés). Ordre des checks : `isActive` d'abord, puis `user_tenant_roles`, puis à défaut `isSuperAdmin` (passage autorisé mais `req.tenantRole` reste `undefined`).

**Nouveau middleware `requireSuperAdminOrTenantAdmin`** : garde combinée pour `GET /:tenantId/roles`, qui sert deux consommateurs aux permissions différentes.

### Édition de rôle — nouvel endpoint plutôt qu'extension

**Décision** : `PATCH /:tenantId/roles/:userId`, distinct de `POST` (assignation stricte, rejette les doublons) — mélanger les deux aurait dilué la garantie utile contre un clic accidentel écrasant un rôle existant.

**`PATCH` protégé `requireSuperAdmin` seul**, plus restrictif que la lecture — un `admin_tenant` ne doit pas pouvoir reclasser un rôle existant, y compris le sien.

### TenantSelector — suppression de la redirection automatique silencieuse

**Bug corrigé** : la redirection auto ne s'applique plus que si `tenantList.length === 1` — un compte ayant reçu un second rôle restait auparavant bloqué sur son premier tenant sans jamais revoir l'écran de choix.

### RBAC réel — middleware `requireMinimumRole`

**Décision** : middleware générique `requireMinimumRole(...allowedRoles)`. Mapping : lecture ouverte à tout rôle tenant ; écriture métier quotidienne → `admin_tenant`/`agent` ; actions d'infrastructure sensibles (WhatsApp connexion/déconnexion) → `admin_tenant` seul.

**Pas de bypass `isSuperAdmin`** — contrairement à `tenantMiddleware` : un super_admin sans ligne explicite n'a accès qu'à la gestion plateforme, jamais aux données métier d'un tenant. Choix différent de `GET /:tenantId/roles` car la nature de l'action diffère (audit vs action métier tracée à un rôle réel).

### Page "Mon profil" — transparence des permissions

Matrice de permissions codée en dur côté frontend, explicitement documentée comme non-source-de-vérité (reflète les gardes backend, ne les définit pas).

### Changement de mot de passe — révocation totale des sessions

`PATCH /auth/password` révoque tous les refresh tokens actifs (pas seulement la session courante), déconnexion frontend immédiate.

### Promotion super_admin — volontairement hors UI, SQL manuel uniquement

**Décision** : aucun endpoint HTTP ne permet de créer/promouvoir un super_admin. Les trois endpoints d'assignation rejettent explicitement `role === "super_admin"`.

**Justification** : accorder le pouvoir le plus sensible du système ne devrait jamais être self-service via une UI web, même protégée — créerait une chaîne de confiance basée uniquement sur "être déjà connecté". Promotion en SQL direct, geste délibérément manuel et traçable.

---

## BLOC 7.1 — Dashboard & gestion des tenants

### Deux surfaces distinctes

**Décision** : Dashboard (`/:tenantSlug/dashboard`) dans `AppLayout`, accessible à tout rôle tenant. Gestion des tenants (`/admin/tenants`) hors `AppLayout`, protégée `isSuperAdmin` uniquement.

**Justification** : cohérent avec la séparation `tenantMiddleware`/`requireSuperAdmin` déjà actée BLOC 1.

### `GET /:tenantId/dashboard/stats` — une requête multi-CTE

**Décision** : une seule requête SQL avec sous-requêtes scalaires plutôt que plusieurs `db.select()` séparés — évite 5-6 allers-retours réseau vers Neon.

**Statut WhatsApp affiché** : session la plus récente (`ORDER BY updated_at DESC LIMIT 1`) — cohérent avec l'hypothèse V1 d'une seule session active en pratique.

### Gestion des tenants : réutilisation stricte des routes BLOC 1

Aucun nouvel endpoint créé — `TenantsAdmin.jsx` consomme les routes déjà existantes depuis BLOC 1, jamais exposées en UI auparavant (testées uniquement via Postman).

---

## BLOC 7.2 — Éditeur catalogue (UI)

### Endpoint de lecture manquant comblé

**Décision** : nouveau `products.service.ts`/`products.controller.ts`, distincts d'`import.*` — `import.*` reste dédié à l'écriture transactionnelle 5 phases, `products.*` porte la lecture (`listProducts`).

### Regroupement produit/variantes en mémoire plutôt qu'une requête `json_agg`

**Décision** : `leftJoin` simple, lignes plates regroupées côté TypeScript.

**Justification** : contrairement à `catalog.service.ts` (recherche agent, contrainte de latence/filtrage complexe justifiant le `json_agg` SQL), ici le besoin est plus simple (liste admin) — le regroupement en mémoire reste lisible et évite de dupliquer la complexité SQL pour un cas d'usage différent.

### Pas de pagination serveur — assumé pour la V1

Cohérent avec la volumétrie posée en BLOC 3 (catalogues de quelques milliers de lignes max).

### Frontend : liste expansible, import et liste dans la même page

Décisions produit reconduisant la logique déjà actée pour les Leads (pas de page détail séparée) — boucle de feedback immédiate import→liste.

### Drag & drop de fichier

Compteur de drag imbriqué (`dragCounterRef`) pour éviter le clignotement de l'indicateur visuel. `preventDefault()` sur `dragover` ET `drop`. Validation de format commune aux deux chemins d'entrée (`selectFile()`).

---

## BLOC 7.3 — Connexion WhatsApp (UI)

### Endpoints ajoutés

`GET /:tenantId/whatsapp/sessions` (liste), `GET .../sessions/:sessionId` (statut, polling ciblé), `POST .../disconnect` (202, asynchrone via BullMQ).

### Nettoyage des sessions `pending_qr` orphelines

**Décision** : `createWhatsappSession` neutralise systématiquement toute session `pending_qr` en DB avant d'en insérer une nouvelle — évite l'accumulation de lignes mortes.

### Réconciliation des sessions fantômes au démarrage du worker

**Contexte** : `SessionManager.sockets` vit exclusivement en mémoire — un redémarrage vide la Map sans que le dernier statut DB (`connected`) ne soit mis à jour.

**Décision — statut intermédiaire `stale`, pas `logged_out`** : `reconcileStaleSessionsOnStartup()` repasse toute session `connected` à `stale` au démarrage. `logged_out` a une sémantique précise (déclenche suppression des creds) — un redémarrage de process n'est pas un logout WhatsApp, les creds restent valides.

**Pas besoin de comparer à l'état mémoire** : au moment de l'exécution, la Map est vide par construction — aucune ambiguïté possible.

**Nouvel endpoint `reconnect`** : réutilise `enqueueWhatsappSessionControl({ action: "start" })`, mêmes creds relues, reconnexion transparente sans QR si la session est toujours active côté téléphone. Garde `SESSION_NOT_STALE` (409) contre un usage détourné.

---

## BLOC 7.4 — Configuration agent IA

### Endpoint en lecture seule — appel direct à `buildSystemPrompt()`

**Décision** : appelle la même fonction réellement utilisée en production, plutôt qu'une copie statique — élimine tout risque de divergence entre affichage et comportement réel.

**Pas d'édition en V1** : le CDC demande une interface minimale — ouvrir l'édition nécessiterait un stockage par tenant, hors périmètre du temps imparti.

---

## BLOC 8 — Sécurité production

### Rate limiting login : scope restreint à `/login`

**Décision** : `loginRateLimiter` (10/15min) uniquement sur `POST /auth/login`, pas `/register`/`/refresh`.

**Justification** : `/refresh` est appelé automatiquement par l'intercepteur axios — un rate limit y casserait l'UX normale d'un utilisateur légitime avec plusieurs onglets.

### Logs sans secrets — audit exhaustif

**Méthode** : `grep -rn "console\." backend/src`, 19 fichiers passés en revue individuellement.

**Résultat** : aucune fuite de secret directe. Deux catégories de PII client corrigées : `agent.service.ts` (logs debug temporaires exposant `customer_name`/`phone` à chaque tool call, supprimés) et `session-manager.ts` (`remoteJid` retiré du log continu `messages.upsert`). `whatsapp-outbound.processor.ts` corrigé par cohérence (`job.data.to`).

**Non corrigé, risque négligeable documenté** : `phoneNumber` du bot loggé à la connexion — numéro business du tenant, pas client, événement ponctuel.

### Garde `tenant.isActive` sur `tenantMiddleware`

**Contexte** : le soft-delete n'avait d'effet que sur l'affichage admin — un utilisateur gardant son rôle sur un tenant désactivé pouvait continuer à accéder à ses données.

**Décision** : seconde requête dans `tenantMiddleware`, après validation `user_tenant_roles` — retourne `403 TENANT_INACTIVE`.

**Ordre des checks** : `isActive` vérifié après le check de rôle, pas avant — évite une fuite d'information mineure (sonder l'état d'un tenant sans accès légitime).

### Centralisation des secrets — `config/index.ts`

**Décision** : tous les `process.env.X` dispersés centralisés via `requireEnv()` — le process échoue désormais au démarrage si une variable est absente, plus silencieusement au premier appel réel.

**Effet de bord positif découvert** : `db/control/index.ts` lisait `process.env.DATABASE_URL!` en parallèle de `config.databaseUrl` — deux sources de vérité jamais remarquées avant cet audit, corrigées au passage.

### Retrait de `internalApiKey.middleware.ts` et `catalog.routes.ts`

**Décision** : suppression complète — route héritée de l'architecture Flowise, plus aucun appelant réel depuis l'agent code-first (`searchCatalog()` appelé en mémoire). Seule protection était une pre-shared key statique — surface d'attaque maintenue par inertie, retirée plutôt que durcie.

### Scripts jetables — suppression définitive

`backfill-embeddings.ts`, `test-category-filter.ts`, `test-catalog-search.ts` supprimés — rôle ponctuel rempli, aucune valeur de démonstration à les garder jusqu'à la soutenance.

### Dettes assumées sans traitement avant soutenance

**`VECTOR_SIMILARITY_THRESHOLD` (0.75)** : non calibré empiriquement — le bruit connu n'empêche pas une démo cohérente (full-text/SKU exact reste fiable en parallèle). Reporté en roadmap post-stage.

**Dette ONNX (crash `bad allocation` sous pression mémoire)** : absorbée par le try/catch de résilience, sans garantie de non-récurrence en démo. Aucune action corrective engagée, décision actée.

---

## BLOC 9 — Observabilité, métriques & vérifications finales

### Temps de réponse moyen — ajouté au Dashboard existant

**Décision** : plutôt qu'un système d'observabilité backend séparé (logs structurés, tracing), une seule métrique à forte valeur de démonstration ajoutée à la requête multi-CTE déjà existante (`getDashboardStats`) — cohérent avec l'arbitrage déjà posé pour BLOC 5bis (visibilité prioritaire sur invisible technique à ce stade du calendrier).

**Calcul** : `LAG()` en window function sur `messages`, partitionné par `conversation_id`, ordonné par `sent_at` — pour chaque message `outbound`, delta avec le message immédiatement précédent, retenu uniquement si ce précédent est `inbound` (sinon mesurerait le delta entre deux messages `outbound` consécutifs de l'agent, sans sens métier). Fenêtré sur les dernières 24h, cohérent avec `messagesLast24h` déjà présent. Délais > 5 minutes exclus (reprise après handover humain, pas représentatif de la latence agent).

**Résultat mesuré en conditions réelles** : ~17.7s en moyenne sur le tenant de test — cohérent avec un aller-retour Groq incluant éventuellement un tool call.

**Décision — pas de nouvelle table ni de tracking applicatif dédié** : la métrique se déduit entièrement des colonnes déjà existantes (`direction`, `sentAt`, `conversationId`) — aucune migration nécessaire, cohérent avec la philosophie du projet (réutiliser l'infra déjà en place plutôt qu'ajouter une brique, voir badge handover BLOC 6.5).

### Logs structurés / suivi erreurs IA formel — non traité, décision actée

**Décision** : non traité avant soutenance. La résilience multi-niveaux déjà établie (BLOC 4) constitue le vrai filet de sécurité en production — un système de logs structurés/tracing formel apporterait de la valeur opérationnelle à long terme mais reste invisible en démo devant un jury. Arbitrage cohérent avec celui déjà posé pour VECTOR_SIMILARITY_THRESHOLD/dette ONNX (BLOC 8) : prioriser le temps restant sur ce qui est démontrable.

### Vérifications de clôture

**Build frontend** (`vite build`) : succès, aucune erreur bloquante.

**Build backend** (`tsc --noEmit`) : aucune erreur de compilation TypeScript.

**Non-régression manuelle** : en l'absence de suite de tests automatisés (aucun framework Jest/Vitest intégré au projet), les scénarios critiques déjà validés en session sont repassés à la main avant clôture — login/accès tenant, message texte → réponse agent, message image → vision, scénario lead complet (recherche → intention → nom → téléphone → `create_lead`), toggle bot/reprise après handover, import catalogue (dry-run). Tous validés.

**Décision — pas de suite de tests automatisés écrite à ce stade** : à 15 jours de la soutenance, écrire une suite de tests formelle (Jest/Vitest) representerait un investissement disproportionné par rapport au temps restant pour BLOC 10 (rapport, deadline ferme) — la checklist de non-régression manuelle, réexécutable en 30-40 minutes, est jugée suffisante pour ce projet de taille PFA.


## BLOC 9bis — Corrections post-clôture (session de durcissement pré-soutenance)

### Support arabizi (darija en lettres latines) — normalisation + règle de langue stricte

**Contexte** : l'agent répondait mal aux messages en arabizi (darija transcrite en lettres latines avec chiffres phonétiques, ex: "wach 3ndkom had sac") — comportement nettement plus faible avec `qwen/qwen3.6-27b` qu'avec `openai/gpt-oss-120b`, cohérent avec la sous-représentation de ce format dans les corpus d'entraînement des modèles plus petits.

**Décision — normalisation pré-LLM** : nouveau module `agent.arabizi.ts`, appliqué au texte du message courant avant envoi au LLM (jamais au texte stocké en DB, qui reste fidèle à ce que le client a écrit — Inbox inchangée). Stratégie en cascade :
1. Dictionnaire ciblé (~80 mots darija fréquents en conversation e-commerce) — haute précision.
2. Repli phonétique sur les tokens non couverts par le dictionnaire, mais contenant un chiffre phonétique isolé en tête (ex: "3afak") — translittère UNIQUEMENT les chiffres phonétiques eux-mêmes (3→ع, 7→ح, 9→ق, 5→خ, 8→ق, 2→ء), laisse les lettres latines environnantes intactes plutôt que de les transcrire aussi.

**Piège corrigé en revue** : une première version transcrivait aussi les lettres latines environnantes (voyelles courtes notamment), ce qui pouvait produire un AUTRE mot arabe existant mais sémantiquement faux (ex: "t9der" transcrit lettre par lettre → "تقدار" — "estimations" — au lieu du verbe "pouvoir"). Un hybride du type "tقder" est moins soigné visuellement mais élimine ce risque de faux-mot trompeur.

**Piège corrigé en revue (garde-fou prix)** : un token commençant par 2+ chiffres (ex: "250dh") est toujours traité comme un nombre, jamais passé à la translittération — sans cette règle, un prix contenant un chiffre phonétique dans sa partie numérique (2, 3, 5, 7, 8, 9) était corrompu. Un seul chiffre phonétique en tête suivi de lettres reste, lui, traité comme de l'arabizi probable (ex: "3ndkom").

**Décision — règle de sortie (langue de réponse)** : après un premier essai de "miroir" (répondre en darija-lettres-arabes si le client écrit en arabizi), un test réel en charge a montré que qwen répondait parfois lui-même en arabizi (comportement instable, jamais désiré) ou produisait des mots répétés/incohérents (ex: "عددا" répété plusieurs fois dans une même réponse). Décision finale, plus stricte et plus stable : toute variante arabe (arabe standard, darija-lettres-arabes, arabizi) converge vers une seule sortie — l'arabe standard (فصحى), jamais de darija ni d'arabizi en sortie, quel que soit le registre du client. Français et anglais restent inchangés (miroir de la langue du client). Simplifie aussi la charge cognitive du prompt : une seule cible de sortie pour tout l'arabe, au lieu de distinguer deux registres proches.

**Diagnostic du mot répété ("عددا")** : isolé par test A/B (patch arabizi désactivé puis réactivé) comme un comportement dégénératif de qwen indépendant du patch de normalisation — cohérent avec la faiblesse déjà documentée en BLOC 5bis ("réponse finale vide répétée, fréquent avec qwen"). Non corrigé spécifiquement — le passage à une sortie arabe standard systématique (registre mieux représenté dans l'entraînement du modèle que la darija/l'arabizi) réduit empiriquement la fréquence de ce type de dérive, sans garantie totale. Dette ouverte si le symptôme persiste : ajouter une détection de répétition anormale (mot identique 3+ fois) en aval, forçant un retry — non implémenté, pas confirmé nécessaire après le changement de règle de langue.

### Robustesse envoi WhatsApp — reconnexion transitoire mal absorbée

**Contexte** : un envoi manuel (agent humain, via `sendManualMessage`) échouait en `SESSION_NOT_ACTIVE` de façon intermittente, alors que la même session fonctionnait quelques secondes avant/après.

**Cause racine** : `session-manager.ts` retirait le socket de la `Map` en mémoire immédiatement sur toute fermeture Baileys, y compris transitoire (ex: code 515, déjà documenté comme phénomène connu de l'écosystème). La fenêtre de retry BullMQ par défaut de `whatsapp-outbound` (3 tentatives, backoff exponentiel 3000ms, ~9s de fenêtre totale) pouvait s'épuiser entièrement DANS le trou de reconnexion (`RECONNECT_DELAY_MS` = 5000ms + temps de connexion réel Baileys derrière), provoquant un échec définitif et silencieux d'un envoi pourtant légitime.

**Décision — état intermédiaire `reconnectingSessions`** : `session-manager.ts` distingue désormais trois états au niveau du socket en mémoire : logged-out définitif (comportement inchangé, jamais de retry), en reconnexion transitoire (nouveau, socket retiré mais session marquée explicitement comme temporairement indisponible), absente/jamais démarrée. Le processor (`whatsapp-outbound.processor.ts`) lève une erreur distincte selon le cas (`SESSION_LOGGED_OUT` reste `UnrecoverableError`, jamais retry ; les deux autres cas restent une erreur "normale", retryable).

**Décision — fenêtre de retry élargie** : `whatsapp-outbound.queue.ts` passé de 3 tentatives / backoff 3000ms (~9s de fenêtre) à 5 tentatives / backoff exponentiel 4000ms (~60s de fenêtre) — couvre confortablement une coupure Baileys transitoire complète sans retry indéfiniment sur une session réellement morte.

### Bug critique — `whatsappSessionId` de conversation jamais resynchronisé

**Contexte, plus grave que le précédent et à l'origine réelle de la majorité des `SESSION_NOT_ACTIVE` observés en test** : après un redémarrage du worker WhatsApp (réconciliation de session fantôme, voir BLOC 7.3) ou une reconnexion sous une nouvelle session, toute conversation déjà existante avec un client continuait de pointer indéfiniment vers l'ANCIEN `whatsappSessionId`, désormais mort — aucun retry, aussi patient soit-il, ne peut réparer un identifiant de session simplement obsolète.

**Cause racine** : `resolveOrCreateConversation()` (`whatsapp-inbound.processor.ts`) n'écrivait `whatsappSessionId` qu'à la création (`INSERT`) de la conversation. La branche "conversation existante" retournait l'ID sans jamais comparer ni mettre à jour ce champ avec le `sessionId` du job entrant courant.

**Effet de bord notable** : le bug était invisible côté agent IA — `processIncomingMessage` ne dépend pas de `whatsappSessionId`, et le chemin d'envoi de la réponse agent (`handleImageMessage`/`enqueueWhatsappOutbound`) utilise déjà le `sessionId` frais du job en cours, pas celui stocké sur la conversation. Seul l'envoi manuel humain (`sendManualMessage`, qui lit `conversation.whatsappSessionId`) était affecté — bon exemple retenu pour le jury de pourquoi tester uniquement le chemin agent ne suffit pas à couvrir un flux multi-canal partageant une même donnée de routage.

**Décision — resynchronisation à chaque message entrant** : la branche "conversation existante" de `resolveOrCreateConversation()` compare désormais `existing.whatsappSessionId` au `sessionId` du job courant et met à jour en DB si différent — le message qui vient d'arriver est par construction la preuve la plus fraîche que cette session est active côté Baileys.

**Limite assumée** : la resynchronisation ne se déclenche que sur réception d'un nouveau message — les conversations dont le dernier message précède ce correctif restent sur l'ancien `whatsappSessionId` jusqu'à ce que le client réécrive au moins une fois. Non corrigé rétroactivement en base (pas nécessaire pour la démo — un scénario de soutenance fait naturellement parler le client avant de démontrer la reprise humaine), mais documenté comme limite connue.

### Incident Upstash Redis — quota free tier épuisé en cours de test

**Contexte** : le quota mensuel Upstash (free tier, 500k commandes) a été atteint en pleine session de test, provoquant un flot d'erreurs `ERR max requests limit exceeded` en boucle continue sur les 5 queues BullMQ (chaque `Worker` fait du polling constant même à vide), et un échec silencieux de l'enqueue `whatsapp-outbound` — message visible dans l'Inbox (déjà écrit en DB) mais jamais réellement transmis à WhatsApp.

**Cause du volume** : 5 queues BullMQ actives en permanence dès que `whatsapp-worker`/`api-workers` tournent, chacune avec un polling continu sur son marker — consommation significative même hors trafic client réel, en usage de développement prolongé.

**Décision immédiate** : migration vers un nouveau compte/projet Upstash (quota réinitialisé), `noeviction` reconfiguré sur le nouveau projet (vérifié explicitement — pas garanti par défaut selon le plan).

**Dette non traitée, à surveiller avant la soutenance** : pas de réduction structurelle du polling BullMQ ni de passage à un plan payant à ce stade — risque résiduel si le quota est réapproché en re-tests intensifs avant le 1er septembre. Vérification du solde Upstash recommandée 24-48h avant la soutenance.

## BLOC 9ter — Exploration de providers alternatifs (post-fix arabizi)

### Contexte

Suite au fix du BLOC 9bis (désactivation de la normalisation pré-LLM après
découverte du bug "ghirou", voir plus haut), exploration d'alternatives à
`qwen/qwen3.6-27b` (Groq) pour évaluer si un autre modèle gérerait
nativement mieux l'arabizi sans nécessiter de normalisation en amont —
déclenchée par une offre externe (compte NVIDIA NIM gratuit partagé par un
collègue).

### Méthode

Même règle déjà actée pour Groq (ARCHITECTURE.md, BLOC 4 : "toujours
vérifier la disponibilité réelle des modèles via l'API plutôt que via une
recherche web") appliquée ici : `GET /v1/models` interrogé directement sur
chaque compte plutôt que de faire confiance aux noms de modèles trouvés en
recherche web — plusieurs identifiants trouvés en ligne se sont révélés
soit inexistants, soit périmés (`qwen/qwen3.5-397b-a17b`, trouvé via
recherche web, retournait une erreur `410 Gone` — end-of-life le
27/07/2026 malgré son apparition dans des résultats de recherche récents).

**Deux providers testés** :
- **NVIDIA NIM** (`build.nvidia.com`, API compatible OpenAI) : aucun
  modèle Qwen disponible sur le compte testé (absent de `GET /v1/models`
  malgré son apparition dans la documentation web) ; `moonshotai/kimi-k2.6`
  listé mais retournait `404 Function not found for account` (modèle
  listé mais non activé sur ce tier de compte) ; `z-ai/glm-5.2`
  systématiquement `429 Too Many Requests` même en espaçant les appels de
  18s ; `meta/llama-3.3-70b-instruct` fonctionnel mais sans avantage net
  sur l'arabizi (évite l'hallucination sans montrer de compréhension
  active) ; `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` a **halluciné
  une catégorie de produit inventée et un lien e-commerce fictif**
  (`maghreblogh.com/collections/ghirou`) sur le cas de test — pire que le
  bug qwen d'origine, disqualifié.
- **OpenRouter** (agrégateur multi-providers) : filtrage `GET
  /api/v1/models` sur les modèles gratuits combinant support `tools` et
  `image` en entrée (contrainte dure du projet, cf. BLOC 5bis) → 5
  candidats identifiés. `google/gemma-4-26b-a4b-it:free` a montré la
  meilleure compréhension isolée du cas "ghirou" (mot darija courant, mal
  interprété par qwen — voir BLOC 9bis) en test simple sans tools ni
  historique. Testé ensuite en conditions réelles (scénario multi-tours
  reproduisant le flow complet recherche→intention→nom→téléphone→
  create_lead, plus test vision) : régressions sérieuses révélées sous
  charge — exposition de raisonnement brut non parsé (balise `<thought>`)
  en lieu de tool call, latence ponctuelle de 40s sur un message simple,
  crash `400` sur un message trivial ("ismi Karim"), et format de tool
  call totalement invalide en contexte vision
  (`<|tool_call>call:search_catalog{...}<tool_call|>`, ni JSON ni
  protocole OpenAI standard). Les autres candidats OpenRouter testés
  (`google/gemma-4-31b-it:free`, `dots-studio/dots-3-note-preview:free`,
  `nvidia/nemotron-nano-12b-v2-vl:free`) ont chacun échoué différemment
  (rate limit constant, mots anglais mélangés dans les réponses arabes,
  sortie illisible/crash) sans qu'aucun ne soit exploitable en l'état.

### Décision — aucun changement de provider/modèle

**`qwen/qwen3.6-27b` sur Groq reste le modèle en production.** Aucun des
9 modèles testés sur les deux providers alternatifs n'a égalé, en
conditions réelles (multi-tours, tools, vision), la stabilité déjà
obtenue avec qwen après les 3 rounds de correction du BLOC 5bis. Un
candidat (`gemma-4-26b`) avait initialement l'air prometteur sur un test
isolé simple, mais s'est effondré sous un test plus représentatif de
l'usage réel — confirmation que le protocole de test déjà établi pour ce
projet (isolation d'abord, puis validation en scénario complet avant
d'adopter, jamais l'inverse) reste la bonne méthode.

**Enseignement retenu pour le jury** : un test simple à un seul tour ne
suffit jamais à valider un LLM candidat pour un agent conversationnel
multi-tours avec tools — la dégradation (format de sortie non conforme,
latence, crash) n'apparaît souvent qu'en charge réelle, comme déjà
observé pour qwen lui-même en BLOC 5bis. Décision cohérente avec
l'arbitrage temps/risque déjà posé pour tout le projet à ce stade du
calendrier (BLOC 8/9) : ne pas introduire d'instabilité nouvelle à 15
jours de la soutenance sans bénéfice net démontré.


---

## Décisions actées — dettes et questions tranchées (résumé)

Cette section condense les dettes et questions ouvertes discutées en cours de projet, une fois leur traitement décidé — le détail narratif de la découverte/discussion a été retiré pour éviter le bruit ; se référer au journal des sessions (CHECKLIST.md) pour le contexte temporel si besoin.

- **RLS** : non nécessaire, database-per-tenant jugé suffisant (Mounim, session 8).
- **WABA officiel** : Baileys retenu comme solution temporaire validée par Mounim ; architecture WABA planifiée (colonne `provider`, module séparé) mais non implémentée, reportée post-soutenance.
- **Support images/screenshots produits (CDC Phase 1)** : tranché et implémenté (BLOC 5bis).
- **Messages humains envoyés depuis le téléphone (hors UI)** : décision produit actée (l'Inbox doit refléter fidèlement tout ce que voit le client) ; piste technique retenue (tracking `msg.key.id` du bot via Redis) mais non implémentée — priorité basse, non bloquante pour la soutenance.
- **Qualité perçue `openai/gpt-oss-120b`** : résolue de fait par la migration vers `qwen/qwen3.6-27b` (BLOC 5bis), qui répondait à la fois au besoin vision et à cette amélioration qualité déjà identifiée.
- **`merge` catalogue ne met pas à jour les métadonnées descriptives d'un produit existant** : dette mineure assumée, non bloquante.
- **Scraping (CDC §4.3)** : périmètre jamais clarifié avec Mounim, fonctionnalité non abordée dans le projet final — à mentionner si le jury pose la question, pas une dette du code.

**Dettes ouvertes restantes à la clôture du projet** (non bloquantes pour la soutenance, décisions actées de ne pas les traiter dans le temps imparti) :
- `VECTOR_SIMILARITY_THRESHOLD` (0.75) non calibré empiriquement.
- Dette ONNX (crash `bad allocation` sous pression mémoire), absorbée par le try/catch de résilience.
- Plafond TPD (tokens/jour) du compte Groq, atteignable en charge multi-conversations avec images — décision Dev Tier ou dosage de démo à prendre juste avant la soutenance.
- Logs structurés / suivi erreurs IA formel — roadmap post-stage.

## BLOC 11 — Connecteur Shopify (sync catalogue, périmètre réduit)

### Contexte et périmètre

CDC Phase 3 — connecteurs additionnels, initialement marquée abandonnée
(cf. historique BLOC 11). Reprise en fin de stage avec un périmètre
volontairement réduit : **synchronisation catalogue Shopify → Brain
Agent, lecture seule**. Création de commande côté Shopify reste hors
scope (CDC Phase 5, déjà actée comme telle).

**Justification du périmètre réduit** : la création de commande implique
argent réel, gestion de stock/taxes/adresses, et des cas d'erreur
partielle bien plus risqués à livrer en fin de calendrier qu'une simple
lecture de catalogue, qui réutilise directement l'infra déjà validée
(embeddings, recherche hybride, agent Groq) sans y toucher.

### Authentification : Custom App legacy plutôt qu'OAuth Dev Dashboard

**Découverte** : depuis le 1er janvier 2026, Shopify a changé son modèle
d'apps développeur — les nouvelles apps créées via le "Dev Dashboard"
(Client ID + Client Secret) n'affichent plus de token en un clic ; il
faut un échange OAuth "client credentials grant" programmatique pour en
obtenir un.

**Décision** : basculer sur le flux **Custom App legacy**, encore
accessible via "Allow legacy custom app development" tant que le store
n'a pas été transféré à un marchand tiers — génère un token statique
(`shpat_...`) directement depuis l'admin du store, sans échange OAuth à
coder. Choix pragmatique vu le calendrier : équivalent fonctionnel pour
un usage privé (un seul store, pas de distribution publique de l'app),
sans le coût de développement d'un flux OAuth complet.

**Validation du token à la connexion** : `connectShopify()` appelle
`fetchShopifyProducts()` avant tout stockage — évite de sauvegarder un
token invalide qu'on ne découvrirait cassé qu'au prochain besoin de
sync, potentiellement pendant la démo elle-même.

### Pas de réutilisation de `import.service.ts` — décision assumée

**Décision** : `shopify.service.ts` implémente son propre upsert
(`upsertShopifyProduct`), indépendant de la logique d'import CSV/JSON
(`resolveDecisions`/`executeDecisions`).

**Justification** : la clé de matching diffère fondamentalement entre
les deux flux — l'import CSV/JSON matche par `sku`/`product_ref`
(fournis par le vendeur), Shopify matche par `shopifyProductId`/
`shopifyVariantId` (identifiants numériques stables côté Shopify, sans
rapport avec un éventuel SKU). Forcer une fonction unique aurait
introduit une couche d'indirection artificielle sans bénéfice réel — les
deux implémentations restent structurellement proches (même transaction
par produit, même appel `generateEmbedding()`) mais chacune reste lisible
indépendamment, cohérent avec le principe déjà établi ailleurs (BLOC 7.2 :
ne pas dupliquer de complexité SQL pour un besoin différent).

### `sku` rendu nullable — contrainte déplacée en code

**Découverte** : les variantes Shopify n'ont fréquemment pas de SKU
renseigné (`sku: null`), notamment sur le dev store de test (23 des 27
variantes synchronisées). Le schéma existant imposait `sku` `NOT NULL`
au niveau DB, hérité de l'import CSV/JSON (BLOC 3) où le SKU est un champ
obligatoire du format d'entrée.

**Décision** : `sku` devient nullable en DB (`ALTER COLUMN ... DROP NOT
NULL`), la contrainte "obligatoire" reste appliquée uniquement côté Zod
dans `import.service.ts`/`products.schemas.ts` pour les imports
CSV/JSON — en pratique seules les variantes Shopify peuvent exister sans
SKU. L'index `UNIQUE` existant sur `sku` n'a pas eu besoin d'être modifié :
Postgres autorise nativement plusieurs valeurs `NULL` sous une contrainte
`UNIQUE`, donc plusieurs variantes Shopify sans SKU coexistent sans
conflit.

**Conséquence sur la recherche agent** : `sku = NULL` n'empêche pas la
recherche catalogue — validé en test réel, l'agent retrouve et
recommande correctement des produits Shopify sans SKU, la recherche
hybride s'appuyant sur `product_name_snapshot`/attributs plutôt que sur
le SKU quand celui-ci est absent.

### Résolution tenant pour un futur webhook — mapping en control plane

**Problème identifié en conception** : `shopify_connections` vit en
tenant plane (une base par tenant), cohérent avec `whatsapp_sessions`.
Mais un webhook Shopify entrant n'a pas de `tenantId` dans l'URL — juste
un `shop_domain` dans un header HTTP. Impossible de savoir quelle base
tenant ouvrir avant d'avoir résolu ce domaine.

**Décision** : nouvelle table control plane `shopify_shop_mappings`
(`shopDomain` unique → `tenantId`), remplie au moment de la connexion
(`registerShopDomainMapping`). Même pattern déjà établi pour
`whatsapp_signal_keys`/`tenantId` (BLOC 5 — "tenantId porté directement
dans le payload pour résoudre l'œuf-et-poule").

### Webhook temps réel : conçu, non activé

**Décision** : `shopify.webhook.controller.ts` et
`shopify.webhook.routes.ts` sont écrits et fonctionnellement complets —
vérification HMAC (`crypto.timingSafeEqual`, comparaison en temps
constant), résolution tenant via le mapping ci-dessus, réponse HTTP 200
immédiate avant traitement (même philosophie de résilience que l'agent
IA et WhatsApp — ne jamais faire dépendre le code HTTP retourné à
Shopify du succès du traitement métier, pour éviter des retries
inutiles).

**Non activé pour la démo** : Shopify exige une URL HTTPS publique
joignable pour enregistrer un webhook — en développement local, cela
suppose un tunnel (ngrok) actif en continu, ou un déploiement, ce qui
dépasse le périmètre de temps disponible et introduit un risque
(expiration/changement d'URL du tunnel) inacceptable le jour de la
soutenance. **Sync manuelle retenue comme mécanisme de démonstration**
— fonctionnellement suffisante pour valider l'intégration : la personne
qui gère le store clique "Synchroniser maintenant" après une
modification catalogue.

### Route webhook — `express.raw()` plutôt que `express.json()`

**Détail technique retenu pour le jury** : la vérification HMAC Shopify
nécessite le corps de requête brut exact (byte-for-byte), pas le JSON
déjà parsé — un `JSON.stringify(JSON.parse(body))` ne redonnerait pas
forcément la même représentation textuelle (espaces, ordre des clés).
La route webhook est donc montée avec `express.raw({ type:
'application/json' })` au lieu du `express.json()` global utilisé par le
reste de l'API, sur cette route précise uniquement.

### Frontend — pas de "modifier la connexion", juste déconnecter/reconnecter

**Décision** : `ShopifyConnect.jsx` n'offre pas d'édition en place du
`shopDomain`/token — seulement connexion (si aucune connexion active) ou
déconnexion (si connectée), reconduisant le pattern déjà en place pour
WhatsApp (BLOC 7.3 : déconnecter puis reconnecter plutôt qu'un flux de
modification dédié). Cohérent avec le principe déjà établi de ne pas
dupliquer un chemin de code pour un gain d'ergonomie marginal.

**Déconnexion = suppression complète**, pas un simple `isActive:
false` : la ligne `shopify_connections` et le mapping
`shopify_shop_mappings` sont supprimés — une reconnexion ultérieure
recrée tout proprement. Choix cohérent avec le nettoyage des sessions
`pending_qr` orphelines (BLOC 7.3) : pas de valeur à garder une
connexion inactive en base pour cette ressource précise (contrairement
à `whatsapp_sessions`, où l'historique de connexion est affiché et a un
intérêt réel en UI).

### Dette mineure non traitée

`product_type` Shopify peut être une chaîne vide (`""`) plutôt que
`null` sur certains produits mal renseignés côté store (observé sur "The
Minimal Snowboard" du dev store de test) — mappé tel quel dans
`products.category`. Impact réel sur les filtres catégorie de l'agent
non confirmé, non traité avant soutenance, dette mineure assumée par
manque de temps.


---

## Inventaire des fichiers créés — par bloc

### BLOC 1 — Control plane & Auth

| Fichier | Rôle |
|---|---|
| `src/db/control/schema.ts` | Schéma Drizzle du control plane : `tenants`, `users` (avec `isSuperAdmin`), `userTenantRoles`, `refreshTokens`. |
| `src/db/control/index.ts` | Instance Drizzle connectée à Neon (driver `neon-http`). |
| `src/modules/auth/auth.types.ts` | `JwtPayload`, `LoginInput`, `RegisterInput`. |
| `src/modules/auth/auth.service.ts` | Hash/vérification mot de passe, génération/vérification tokens, register/login/refresh/logout. |
| `src/modules/auth/auth.controller.ts` | Couche HTTP de l'auth. |
| `src/modules/auth/auth.routes.ts` | `POST /register`, `/login`, `/refresh`, `/logout`. |
| `src/modules/tenants/tenants.types.ts` | `CreateTenantInput`. |
| `src/modules/tenants/tenants.service.ts` | CRUD tenant (création, listing, désactivation soft). |
| `src/modules/tenants/tenants.controller.ts` | Couche HTTP CRUD tenant. |
| `src/modules/tenants/tenants.routes.ts` | `POST /`, `GET /`, `PATCH /:tenantId/deactivate`, protégées `requireSuperAdmin`. |
| `src/modules/tenant-roles/*` | Assignation user↔tenant (bootstrap). |
| `src/middleware/auth.middleware.ts` | Vérifie l'access token JWT, attache `req.user`. |
| `src/middleware/tenant.middleware.ts` | Vérifie l'accès à un tenant via `userTenantRoles`, attache `req.tenantRole`. |
| `src/middleware/requireSuperAdmin.middleware.ts` | Vérifie `isSuperAdmin` en DB. |
| `src/types/express.d.ts` | Extension `Express.Request` (`req.user`, `req.tenantRole`). |
| `src/app.ts` / `src/server.ts` | Configuration Express / point d'entrée process. |

### BLOC 2 — Data plane & provisioning

| Fichier | Rôle |
|---|---|
| `src/db/tenant/schema.ts` | Schéma tenant complet (révisé BLOC 3/5/5bis). |
| `drizzle.tenant.config.ts` | Config Drizzle tenant. |
| `src/services/neon.service.ts` | Création projet Neon par tenant. |
| `src/db/provisioning.queue.ts` / `.processor.ts` | Queue + worker BullMQ de provisioning. |
| `src/db/tenant-connection-manager.ts` | `getTenantDb(tenantId)`, cache mémoire. |

### BLOC 3 — Catalogue produits

| Fichier | Rôle |
|---|---|
| `src/modules/products/products.types.ts` | Types import (`ImportRow`, `ParsedImportRow`, etc.). |
| `src/modules/products/import.service.ts` | Logique d'import en 5 phases. |
| `src/modules/products/import.controller.ts` | Upload, détection format, mapping erreurs. |
| `src/modules/products/products.routes.ts` | Routes import + template. |

### BLOC 4 — Agent IA

| Fichier | Rôle |
|---|---|
| `src/modules/agent/agent.prompt.ts` | `buildSystemPrompt(tenantName)`. |
| `src/modules/agent/agent.tools.ts` | 3 tools function-calling Groq. |
| `src/modules/agent/agent.service.ts` | `processIncomingMessage()` — cœur de l'agent. |
| `src/modules/agent/agent.controller.ts` / `.routes.ts` | Endpoint de test `POST /:tenantId/agent/message`. |
| `src/modules/catalog/catalog.service.ts` | `searchCatalog()` — recherche hybride. |
| `src/modules/leads/leads.service.ts` | Upsert lead, escalade. |

### BLOC 5 — Canal WhatsApp

| Fichier | Rôle |
|---|---|
| `src/queues/redis-connection.ts` | Connexion Redis partagée. |
| `src/queues/whatsapp-*.queue.ts` / `.processor.ts` | 5 queues (outbound, inbound, status, session-control, agent-trigger). |
| `src/modules/whatsapp/whatsapp-auth-state.ts` | Pont Baileys ↔ control plane. |
| `src/modules/whatsapp/session-manager.ts` | Cycle de vie des sockets Baileys. |
| `src/modules/whatsapp/*` | Module HTTP sessions WhatsApp. |
| `src/modules/conversations/*` | Envoi manuel, toggle bot. |
| `src/whatsapp-worker.ts` / `src/api-workers.ts` | Points d'entrée process. |

### BLOC 5bis — Support images

| Fichier | Rôle |
|---|---|
| `image-compression.ts` | Compression `sharp`, paliers de qualité. |
| Migration `0009_add_message_media.sql` | `messages.mediaBase64`/`mediaMimeType`. |

### BLOC 6/7 — Frontend

Voir structure complète dans `arch_llm.txt` (`frontend/src/pages/*`, `frontend/src/contexts/*`, `frontend/src/lib/*`) — modules Inbox, Leads, Dashboard, Catalog, Whatsapp, Team, Profile, Admin.

### BLOC 9 — Observabilité & clôture

Aucun nouveau fichier — extension de `dashboard.service.ts`/`dashboard.types.ts` (métrique temps de réponse) et `Dashboard.jsx` (affichage).

*(section à compléter au fil des blocs restants — BLOC 10 en cours)*