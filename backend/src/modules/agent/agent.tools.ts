// src/modules/agent/agent.tools.ts

export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_catalog',
      description:
        'Recherche des produits dans le catalogue du tenant. À utiliser systématiquement avant d\'annoncer un prix, un stock, ou l\'existence d\'un produit — ne jamais répondre sur ces sujets de mémoire. IMPORTANT : si min_price, max_price ou category ne sont pas mentionnés explicitement par le client, NE PAS inclure ces paramètres dans l\'appel plutôt que de leur donner une valeur vide.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Mots-clés de recherche libres ou spécificités (ex: "bleu", "taille M").',
          },
          min_price: {
            type: ['number', 'string', 'null'],
            description: 'Prix minimum souhaité par le client, en nombre. Omettre ce paramètre entièrement si non mentionné — ne jamais envoyer la valeur "None".',
          },
          max_price: {
            type: ['number', 'string', 'null'],
            description: 'Prix maximum souhaité par le client, en nombre. Omettre ce paramètre entièrement si non mentionné — ne jamais envoyer la valeur "None".',
          },
          category: {
            type: ['string', 'null'],
            description: 'Catégorie de produit si le client en mentionne une (ex: "t-shirts", "vestes"). Omettre ce paramètre entièrement si non mentionnée.',
          },
        },
        required: ['query'],
        additionalProperties: false
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_lead',
      description:
        'Enregistre ou met à jour un lead commercial pour cette conversation. À appeler UNIQUEMENT une fois que le client a fourni au minimum son nom ET son numéro de téléphone. Toujours renvoyer TOUTES les informations déjà connues du client.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: 'Nom du client.',
          },
          phone: {
            type: 'string',
            description: 'Numéro de téléphone du client.',
          },
          address: {
            type: ['string', 'null'],
            description: 'Adresse de livraison. Mettre null si non fournie.',
          },
          product_requested: {
            type: ['string', 'null'],
            description: 'Nom du produit demandé. Mettre null si inconnu.',
          },
          variant: {
            type: ['string', 'null'],
            description: 'Variante souhaitée (taille, couleur...). Mettre null si non précisée.',
          },
          quantity: {
            type: ['number', 'null'],
            description: 'Quantité souhaitée. Mettre null si non précisée.',
          },
          estimated_price: {
            type: ['number', 'null'],
            description: 'Prix estimé total. Mettre null si non calculable.',
          },
        },
        required: ['customer_name', 'phone', 'address', 'product_requested', 'variant', 'quantity', 'estimated_price'],
        additionalProperties: false
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'escalate_to_human',
      description:
        'Signale qu\'un humain doit reprendre cette conversation. À utiliser si le client demande explicitement à parler à une personne, ou si tu ne parviens pas à répondre à sa demande après plusieurs tentatives.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Motif bref de l\'escalade.',
          },
        },
        required: ['reason'],
        additionalProperties: false
      },
    },
  },
];
