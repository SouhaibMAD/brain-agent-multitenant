import { BufferJSON, initAuthCreds, proto } from "baileys";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "baileys";
import { eq, and, inArray } from "drizzle-orm";
import { db as controlDb } from "../../db/control/index.js";
import { whatsappCredentials, whatsappSignalKeys } from "../../db/control/schema.js";

// Sérialisation via BufferJSON — nécessaire car creds/keys contiennent des
// Buffer/Uint8Array (clés cryptographiques) qu'un JSON.stringify naïf
// corromprait.
//
// Une signal key Baileys n'est pas toujours un objet (string, array, objet
// selon le type) — keyData (jsonb) reste typé Record<string, unknown> côté
// schéma en enveloppant systématiquement la valeur réelle sous { value }.
function serializeToJsonb(value: unknown): Record<string, unknown> {
  return { value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)) };
}

function deserializeFromJsonb<T>(stored: Record<string, unknown>): T {
  return JSON.parse(JSON.stringify(stored.value), BufferJSON.reviver) as T;
}

// creds n'a pas ce problème (toujours un objet AuthenticationCreds) — on
// garde une sérialisation directe, sans wrapper, pour rester lisible en
// SQL Editor si besoin de debug.
function serializeCreds(creds: AuthenticationCreds): Record<string, unknown> {
  return JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
}

function deserializeCreds(stored: Record<string, unknown>): AuthenticationCreds {
  return JSON.parse(JSON.stringify(stored), BufferJSON.reviver) as AuthenticationCreds;
}

export interface ControlPlaneAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function makeControlPlaneAuthState(
  sessionId: string,
  tenantId: string
): Promise<ControlPlaneAuthState> {
  const existing = await controlDb.query.whatsappCredentials.findFirst({
    where: eq(whatsappCredentials.sessionId, sessionId),
  });

  const creds: AuthenticationCreds = existing
    ? deserializeCreds(existing.credsJson)
    : initAuthCreds();

  const saveCreds = async () => {
    const credsJson = serializeCreds(creds);

    await controlDb
      .insert(whatsappCredentials)
      .values({ sessionId, tenantId, credsJson, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: whatsappCredentials.sessionId,
        set: { credsJson, updatedAt: new Date() },
      });
  };

  // Force la création immédiate de la ligne whatsapp_credentials pour un
  // tout premier démarrage (creds vierges via initAuthCreds()) — garantit
  // que sessionId → tenantId est résolvable en control plane dès le
  // premier event Baileys (QR, statut), sans attendre le premier
  // creds.update réel qui peut survenir après.
  if (!existing) {
    await saveCreds();
  }
  
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const rows = await controlDb.query.whatsappSignalKeys.findMany({
          where: and(
            eq(whatsappSignalKeys.sessionId, sessionId),
            eq(whatsappSignalKeys.keyType, type),
            inArray(whatsappSignalKeys.keyId, ids)
          ),
        });

        const result: Record<string, SignalDataTypeMap[typeof type]> = {};
        for (const row of rows) {
          let value = deserializeFromJsonb<SignalDataTypeMap[typeof type]>(row.keyData);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[typeof type];
          }
          result[row.keyId] = value;
        }
        return result;
      },
      set: async (data) => {
        for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const entries = data[type];
          if (!entries) continue;

          for (const keyId of Object.keys(entries)) {
            const value = entries[keyId];

            if (value === null || value === undefined) {
              await controlDb
                .delete(whatsappSignalKeys)
                .where(
                  and(
                    eq(whatsappSignalKeys.sessionId, sessionId),
                    eq(whatsappSignalKeys.keyType, type),
                    eq(whatsappSignalKeys.keyId, keyId)
                  )
                );
              continue;
            }

            const keyData = serializeToJsonb(value);
            await controlDb
              .insert(whatsappSignalKeys)
              .values({ sessionId, tenantId, keyType: type, keyId, keyData, updatedAt: new Date() })
              .onConflictDoUpdate({
                target: [whatsappSignalKeys.sessionId, whatsappSignalKeys.keyType, whatsappSignalKeys.keyId],
                set: { keyData, updatedAt: new Date() },
              });
          }
        }
      },
    },
  };

  return { state, saveCreds };
}

// Appelé au logout explicite (DisconnectReason.loggedOut) — supprime toute
// trace de la session côté control plane, pour forcer un nouveau scan QR
// au prochain démarrage plutôt que de tenter une reconnexion avec des
// creds désormais invalides côté WhatsApp.
export async function deleteControlPlaneAuthState(sessionId: string) {
  await controlDb.delete(whatsappSignalKeys).where(eq(whatsappSignalKeys.sessionId, sessionId));
  await controlDb.delete(whatsappCredentials).where(eq(whatsappCredentials.sessionId, sessionId));
}