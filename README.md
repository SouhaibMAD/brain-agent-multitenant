# Brain Agent

**Plateforme SaaS multitenant d'agent commercial IA pour WhatsApp**, avec synchronisation catalogue Shopify, RAG hybride, et support vision — conçue pour les e-commerces marocains.

[![Status](https://img.shields.io/badge/status-live-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)]()
[![License](https://img.shields.io/badge/license-Academic%20Project-lightgrey)]()

> Projet de Fin d'Année (PFA) — Souhaib Madhour, 5ème année IA & Data Science, EMSI Marrakech.
> Développé chez **Brain Gen Technologies**, sous la direction de Mounim Zaddoug (AI Solutions Architect & Co-fondateur).

---

## Table des matières

- [Aperçu](#aperçu)
- [Pourquoi ce projet est différent d'un simple chatbot](#pourquoi-ce-projet-est-différent-dun-simple-chatbot)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Fonctionnalités](#fonctionnalités)
- [Roadmap](#roadmap)
- [Installation](#installation)
- [Structure du projet](#structure-du-projet)
- [État du projet](#état-du-projet)
- [Décisions d'architecture clés](#décisions-darchitecture-clés)
- [Documentation complémentaire](#documentation-complémentaire)

---

## Aperçu

Brain Agent est une plateforme SaaS qui permet à n'importe quelle entreprise de déployer, en quelques minutes, un agent commercial IA branché sur son numéro WhatsApp. L'agent répond aux clients en temps quasi-réel, s'appuie sur le catalogue produit réel de l'entreprise, qualifie automatiquement les prospects en leads structurés, et transfère la conversation à un humain dès que la situation le demande.

**Le problème résolu** : le service client WhatsApp des e-commerces reste aujourd'hui majoritairement manuel — un community manager qui tape les réponses une par une, avec un volume de conversations plafonné par ses heures de travail. Brain Agent automatise ce premier niveau de conversation avec un temps de réponse moyen de **17,7 secondes**, disponible 24/7, sans jamais perdre le contrôle humain quand c'est nécessaire.

**Ce qui rend la plateforme robuste** : une isolation stricte des données entre chaque client (aucune base partagée), un agent qui ne répond jamais en inventant un produit ou un prix, et un pipeline entièrement asynchrone conçu pour encaisser la charge sans jamais bloquer.

---

## Pourquoi ce projet est différent d'un simple chatbot

| Défi | Solution apportée |
|---|---|
| Isolation stricte des données entre clients | Database-per-tenant (Neon serverless) — chaque entreprise a littéralement sa propre base de données |
| Zéro hallucination produit/prix | RAG hybride (recherche full-text + vectorielle) validé par tests formels sur scénarios réels |
| Fiabilité malgré un fournisseur LLM externe | Résilience à 4 niveaux — l'agent absorbe les pannes et continue de répondre |
| Canal WhatsApp non-officiel par nature capricieux | Reconnexion automatique, réconciliation de session, distinction fine entre déconnexion réelle et coupure passagère |
| Clientèle multilingue (FR/EN/AR/Darija/Arabizi) | Compréhension de tous les registres, réponse toujours propre et cohérente en arabe standard |
| Montée en charge sur plusieurs conversations simultanées | Architecture asynchrone à 3 process + 5 files BullMQ, aucun traitement bloquant |

---

## Architecture

### Vue d'ensemble — 3 process indépendants

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   API Server     │     │  Provisioning Worker  │     │  WhatsApp Worker     │
│  (Express REST)  │     │  (création tenant)     │     │  (sockets Baileys)   │
└────────┬─────────┘     └──────────┬────────────┘     └──────────┬───────────┘
         │                          │                              │
         │                          │                              │
         └──────────────┬───────────┴──────────────┬───────────────┘
                         │                          │
                  ┌──────▼──────┐           ┌───────▼────────┐
                  │  Redis       │           │  Neon Postgres  │
                  │  (Upstash)   │           │  (control +     │
                  │  5 queues    │           │   tenant DBs)   │
                  │  BullMQ      │           └─────────────────┘
                  └──────────────┘
```

### Modèle de données — Control plane / Data plane

```
CONTROL PLANE (1 base partagée)              DATA PLANE (1 base Neon PAR tenant)
┌────────────────────────┐                   ┌──────────────────────────┐
│ tenants                │──────provisions──▶│ products / variants      │
│ users (isSuperAdmin)   │                   │ conversations / messages │
│ user_tenant_roles      │                   │ leads / orders           │
│ refresh_tokens         │                   │ whatsapp_sessions        │
│ whatsapp_signal_keys   │                   │ shopify_connections      │
│ shopify_shop_mappings  │                   └──────────────────────────┘
└────────────────────────┘
```

**Principe** : le control plane ne contient **aucune donnée métier**, uniquement "qui est ce tenant et où trouver sa base". Chaque client possède son propre projet Neon complet — une isolation réelle au niveau infrastructure, pas seulement une séparation logique.

### Pipeline de traitement d'un message WhatsApp entrant

```
Client WhatsApp
      │
      ▼
Baileys (whatsapp-worker) ──▶ whatsapp-inbound queue
      │                              │
      │                              ▼
      │                    Résolution tenant + conversation
      │                    Resync whatsappSessionId
      │                              │
      │                              ▼
      │              texte ──▶ debounce 4s (whatsapp-agent-trigger)
      │              image ──▶ traitement immédiat (hors debounce)
      │                              │
      │                              ▼
      │                    Agent IA (agent.service.ts)
      │                    ├─ search_catalog (RAG hybride)
      │                    ├─ create_lead
      │                    └─ escalate_to_human
      │                              │
      │                              ▼
      │                    whatsapp-outbound queue
      ◀──────────────────────────────┘
Réponse au client
```

### Recherche catalogue — RAG hybride

```
Requête client
      │
      ├──▶ Full-text search (websearch_to_tsquery)  ──┐
      │    matching exact : SKU, nom produit           │
      │                                                 ├──▶ UNION + dédup (MAX(rank))
      └──▶ Recherche vectorielle (pgvector)            │         │
           embeddings locaux ONNX (384d)               │         ▼
           couvre variations morphologiques/darija  ───┘   Résultats classés
```

---

## Stack technique

### Backend

| Composant | Choix | Pourquoi |
|---|---|---|
| Runtime | Node.js / TypeScript (strict) | Cohérence full-stack, typage bout-en-bout |
| Framework HTTP | Express 5 | Léger, contrôle total du middleware stack |
| ORM | Drizzle | Typage strict, migrations SQL explicites et versionnées |
| Base de données | PostgreSQL (Neon serverless) | Scale-to-zero, un projet complet par client |
| Driver DB (tenant) | `neon-serverless` (WebSocket) | Transactions SQL réelles pour les opérations atomiques |
| Driver DB (control) | `neon-http` | Léger, adapté au CRUD simple du registre tenants |
| Recherche vectorielle | pgvector | Nativement intégré à Postgres/Neon |
| Embeddings | ONNX Runtime, `Xenova/multilingual-e5-small` (384d) | Calcul local, aucun coût par appel, aucune latence réseau externe |
| File d'attente | BullMQ + Redis (Upstash) | Retry/backoff automatique, découplage complet API/traitement |
| Auth | JWT (access 15min + refresh 7j rotatif), argon2id | Sessions révocables, hash de mot de passe recommandé OWASP |
| WhatsApp | Baileys `7.0.0-rc14` | Intégration WhatsApp sans coût d'API officielle |
| LLM | Groq API — `qwen/qwen3.6-27b` | Vision + function calling + raisonnement, inférence rapide |
| Validation | Zod | Un seul schéma pour la validation et le typage TypeScript |
| Traitement d'image | sharp | Compression optimisée pour la vision LLM |

### Frontend

| Composant | Choix |
|---|---|
| Framework | React (Vite) |
| Data fetching | TanStack Query (cache scopé par utilisateur) |
| Routing | React Router |
| HTTP client | axios avec intercepteur refresh token automatique |
| Design | Système de design tokens CSS |

### Infrastructure

| Composant | Choix |
|---|---|
| Hébergement DB | Neon (isolation totale par projet et par client) |
| Cache/Queue | Upstash Redis |
| Connecteur e-commerce | Shopify Admin API |

---

## Fonctionnalités

### Agent IA
- Function calling natif (Groq SDK) — 3 outils : `search_catalog`, `create_lead`, `escalate_to_human`
- Recherche catalogue hybride full-text + vectorielle, avec garde-fou anti-hallucination validé sur scénarios réels
- **Support vision** : le client peut envoyer une photo ou un screenshot produit, l'agent l'identifie et répond en conséquence
- **Multilingue natif** : français et anglais en miroir, tout registre arabe (standard, darija, arabizi) compris et restitué en arabe standard propre
- **Résilience à 4 niveaux** : l'agent absorbe l'échec d'un outil, une panne du fournisseur LLM, ou une erreur d'écriture, et continue de répondre au client sans jamais planter
- Débounce intelligent des messages rapprochés pour des réponses groupées et cohérentes, pas fragmentées

### Canal WhatsApp
- Connexion par simple scan de QR code
- Reconnexion automatique en cas de coupure réseau, sans intervention manuelle
- Réconciliation automatique des sessions au redémarrage du service
- Reprise de contrôle humain (handover) à tout moment, en un clic

### Catalogue produits
- Import CSV/JSON avec aperçu avant validation (dry-run), fusion intelligente ou remplacement complet
- **Synchronisation Shopify** en un clic — le catalogue Shopify existant devient immédiatement exploitable par l'agent
- Modèle de données produit/variante fidèle à la réalité e-commerce (un SKU par variante, pas par produit)

### Interface d'administration
- **Inbox** : toutes les conversations en un seul endroit, reprise humaine en un clic, notes internes horodatées
- **Leads** : pipeline de qualification à 6 statuts, lien direct vers la conversation d'origine
- **Dashboard** : vue d'ensemble en temps réel, incluant le temps de réponse moyen de l'agent
- **Catalogue** : édition, import, connexion Shopify, le tout depuis une seule page
- **Équipe & rôles** : gestion fine des permissions, invitation en self-service
- **Configuration agent** : transparence totale sur le comportement réel de l'IA en production

### Sécurité
- Isolation multitenant garantie au niveau infrastructure, pas seulement applicatif
- Aucun secret ni donnée client en clair dans les logs
- Rate limiting sur les points d'entrée sensibles
- Configuration fail-fast — impossible de démarrer en production avec une configuration incomplète
- Élévation de privilège plateforme volontairement hors de portée de toute UI ou API

---

## Roadmap

Le socle WhatsApp + catalogue + agent IA est en production. Les prochaines étapes étendent la couverture canal et la maturité opérationnelle :

- **WhatsApp Business API (officielle)** — architecture déjà conçue (module dédié, cohabitation avec le canal actuel), déploiement à venir
- **Webhooks Shopify temps réel** — la vérification et le routage sont déjà implémentés ; activation prévue avec le déploiement en environnement public
- **Facebook Messenger & Instagram** — connecteurs déjà disponibles côté Brain Gen Technologies, intégration prévue sur le même socle multi-canal
- **Observabilité avancée** — logs structurés et tracing applicatif pour un monitoring de production à grande échelle
- **Scoring de leads & relances automatiques** — exploitation approfondie des données de conversation déjà collectées

---

## Installation

### Prérequis

- Node.js ≥ 18
- Un compte [Neon](https://neon.tech) (Postgres serverless)
- Un compte [Upstash](https://upstash.com) (Redis)
- Une clé API [Groq](https://console.groq.com)
- Un numéro WhatsApp dédié à la connexion (test)

### 1. Cloner et installer les dépendances

```bash
git clone <repo-url>
cd brain-agent

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configurer les variables d'environnement

Copier `backend/.env.example` vers `backend/.env` et renseigner :

```env
# Control plane
DATABASE_URL=postgresql://...           # Neon control plane

# Neon API (provisioning automatique des tenants)
NEON_API_KEY=...
NEON_ORG_ID=...

# Redis (Upstash)
REDIS_URL=rediss://...

# Auth
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

# LLM
GROQ_API_KEY=...

# Shopify (optionnel, requis uniquement pour le connecteur)
# Configuré par tenant via l'UI (Custom App legacy token)
```

> Toutes les variables sont validées au démarrage — le service refuse de démarrer avec une configuration incomplète plutôt que d'échouer silencieusement plus tard.

### 3. Appliquer les migrations

```bash
cd backend

# Migrations control plane
npx drizzle-kit migrate --config=drizzle.config.ts

# Migrations tenant (template, appliquées automatiquement à chaque nouveau tenant provisionné)
npx drizzle-kit migrate --config=drizzle.tenant.config.ts
```

### 4. Lancer les 3 process

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — Worker de provisioning (création des tenants)
npm run dev:provisioning-worker

# Terminal 3 — Worker WhatsApp (sockets Baileys)
npm run dev:whatsapp-worker
```

### 5. Lancer le frontend

```bash
cd frontend
npm run dev
```

### 6. Premier tenant

1. `POST /api/tenants` (protégé `requireSuperAdmin`) → déclenche le provisioning asynchrone d'un nouveau projet Neon
2. Assigner un rôle via `POST /api/tenants/:tenantId/roles`
3. Se connecter à l'interface, importer un catalogue (CSV/JSON ou Shopify)
4. Connecter WhatsApp via le QR code affiché dans l'onglet dédié

---

## Structure du projet

```
brain-agent/
├── backend/
│   └── src/
│       ├── app.ts / server.ts          # Config Express / entrée process API
│       ├── whatsapp-worker.ts          # Entrée process WhatsApp
│       ├── worker.ts                   # Entrée process provisioning
│       ├── config/                     # Configuration centralisée
│       ├── db/
│       │   ├── control/                # Schéma + connexion control plane
│       │   ├── tenant/                 # Schéma tenant
│       │   └── tenant-connection-manager.ts
│       ├── middleware/                 # auth, tenant, RBAC, validation
│       ├── modules/
│       │   ├── agent/                  # Cœur de l'agent IA (function calling)
│       │   ├── auth/
│       │   ├── catalog/                # Recherche hybride + embeddings
│       │   ├── conversations/
│       │   ├── dashboard/
│       │   ├── leads/
│       │   ├── products/               # Import CSV/JSON + lecture
│       │   ├── shopify/                # Connecteur Shopify
│       │   ├── tenant-roles/
│       │   ├── tenants/
│       │   └── whatsapp/               # Baileys, sessions
│       └── queues/                     # 5 queues BullMQ + processors
└── frontend/
    └── src/
        ├── contexts/                   # Auth, Tenant
        ├── lib/                        # api-client, query-client
        └── pages/
            ├── Inbox/
            ├── Leads/
            ├── Dashboard/
            ├── Catalog/
            ├── Whatsapp/
            ├── AgentConfig/
            ├── Team/
            ├── Profile/
            └── Admin/
```

---

## État du projet

**La plateforme est fonctionnelle de bout en bout et déployable dès aujourd'hui.**

| Bloc | Périmètre | Statut |
|---|---|---|
| 0–1 | Cadrage, control plane, auth | ✅ Livré |
| 2 | Data plane, provisioning multitenant | ✅ Livré |
| 3 | Catalogue produits (import CSV/JSON) | ✅ Livré |
| 4 | Agent IA (function calling, RAG hybride) | ✅ Livré |
| 5 | Canal WhatsApp (Baileys) | ✅ Livré |
| 5bis | Support vision (screenshots produits) | ✅ Livré |
| 6 | Frontend — Inbox, Leads, RBAC, Team | ✅ Livré |
| 7 | Dashboard, éditeur catalogue, connexion WhatsApp | ✅ Livré |
| 8 | Sécurité production | ✅ Livré |
| 9 | Observabilité, métriques, vérifications finales | ✅ Livré |
| 9bis | Durcissement production (multilingue, robustesse session) | ✅ Livré |
| 11 | Connecteur Shopify (synchronisation catalogue) | ✅ Livré |
| — | WhatsApp Business API, Facebook, Instagram | 🚀 Roadmap |

---

## Décisions d'architecture clés

Un échantillon des choix les plus significatifs, tous documentés en détail (contexte, alternatives évaluées, justification) dans `ARCHITECTURE.md` :

- **Database-per-tenant** — isolation par infrastructure plutôt que par filtre applicatif, la garantie la plus forte possible pour des données clients sensibles
- **`super_admin` en booléen global, jamais un rôle scopé-tenant** — élimine toute ambiguïté sur le contrôle plateforme
- **Agent code-first sur Groq (function calling natif)** — flow simple et rapide, sans dépendance à un framework d'orchestration lourd
- **Choix du modèle LLM validé par benchmark comparatif réel** — `qwen/qwen3.6-27b` sélectionné après évaluation de 9 modèles sur 3 providers, seul candidat combinant vision, function calling et stabilité en conditions réelles multi-tours
- **Séparation stricte `products`/`product_variants`** — reflète la réalité qu'un SKU vit au niveau de la variante, pas du produit parent
- **Architecture à 3 process indépendants** (API / provisioning / WhatsApp) — chaque composant scale et se restart indépendamment des autres

---

## Documentation complémentaire

| Document | Contenu |
|---|---|
| `ARCHITECTURE.md` | Journal complet des décisions techniques, bloc par bloc, avec justification et alternatives évaluées |
| `CHECKLIST.md` | Suivi des tâches et journal chronologique des sessions de développement |
| `cahierdeschargesBrainAgent_1.pdf` | Cahier des charges original fourni par Brain Gen Technologies |

---

*Brain Agent — une plateforme conçue pour transformer WhatsApp en canal de vente automatisé, sans sacrifier le contrôle humain.*