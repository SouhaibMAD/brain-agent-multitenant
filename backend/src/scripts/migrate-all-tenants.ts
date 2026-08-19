/**
 * src/scripts/migrate-all-tenants.ts
 *
 * Applique les migrations Drizzle tenant (./src/db/migrations/tenant)
 * sur TOUTES les bases tenant déjà provisionnées (provisioningStatus: "ready").
 *
 * Pourquoi ce script existe :
 * Le worker de provisioning (provisioning.processor.ts) applique les
 * migrations UNE SEULE FOIS, au moment de la création d'un tenant.
 * Il n'existe aucun mécanisme natif pour propager une migration ultérieure
 * (ex: ajout d'une colonne après coup) vers les tenants déjà existants.
 * Ce script comble ce manque — à relancer à chaque fois qu'une nouvelle
 * migration touche le schéma tenant (src/db/tenant/schema.ts) après que
 * des tenants existent déjà en base.
 *
 * Isolation des erreurs : un tenant qui échoue n'interrompt pas le
 * traitement des autres — cohérent avec la philosophie d'isolation
 * stricte database-per-tenant du projet (un problème sur un tenant ne
 * doit jamais bloquer les autres).
 *
 * Driver : neon-http + neon-http/migrator, exactement le même pattern
 * que provisioning.processor.ts (le worker de provisioning utilise
 * actuellement neon-http, pas neon-serverless, malgré ce qu'indique
 * ARCHITECTURE.md — à clarifier/corriger séparément si besoin).
 *
 * Usage :
 *   npx tsx src/scripts/migrate-all-tenants.ts
 *   (ou via un script npm : "migrate:tenants": "tsx src/scripts/migrate-all-tenants.ts")
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { eq } from "drizzle-orm";
import { db as controlDb } from "../db/control/index.js";
import { tenants } from "../db/control/schema.js";

const MIGRATIONS_FOLDER = "./src/db/migrations/tenant";

interface MigrationResult {
  tenantId: string;
  tenantSlug: string;
  status: "success" | "failed";
  error?: string;
}

async function migrateSingleTenant(
  tenantId: string,
  tenantSlug: string,
  databaseUrl: string
): Promise<MigrationResult> {
  try {
    const sql = neon(databaseUrl);
    const tenantDb = drizzle(sql);

    await migrate(tenantDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });

    return { tenantId, tenantSlug, status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { tenantId, tenantSlug, status: "failed", error: message };
  }
}

async function main() {
  console.log("── Migration batch : tous les tenants provisionnés ──\n");

  // On ne migre que les tenants réellement prêts — un tenant "pending"
  // ou "failed" n'a pas encore de databaseUrl exploitable (ou une base
  // dans un état incertain), et sera traité par le provisioning normal.
  const readyTenants = await controlDb
    .select({
      id: tenants.id,
      slug: tenants.slug,
      databaseUrl: tenants.databaseUrl,
    })
    .from(tenants)
    .where(eq(tenants.provisioningStatus, "ready"));

  if (readyTenants.length === 0) {
    console.log("Aucun tenant \"ready\" trouvé. Rien à migrer.");
    return;
  }

  console.log(`${readyTenants.length} tenant(s) à traiter.\n`);

  const results: MigrationResult[] = [];

  for (const tenant of readyTenants) {
    if (!tenant.databaseUrl) {
      results.push({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        status: "failed",
        error: "databaseUrl manquant malgré provisioningStatus=ready (incohérence de données)",
      });
      continue;
    }

    console.log(`→ Migration en cours : ${tenant.slug} (${tenant.id})`);
    const result = await migrateSingleTenant(tenant.id, tenant.slug, tenant.databaseUrl);
    results.push(result);

    if (result.status === "success") {
      console.log(`  ✓ OK`);
    } else {
      console.error(`  ✗ ÉCHEC : ${result.error}`);
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  console.log("\n── Résumé ──");
  console.log(`Succès : ${successCount}/${results.length}`);
  console.log(`Échecs : ${failedCount}/${results.length}`);

  if (failedCount > 0) {
    console.log("\nTenants en échec :");
    for (const r of results.filter((r) => r.status === "failed")) {
      console.log(`  - ${r.tenantSlug} (${r.tenantId}) : ${r.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Erreur fatale du script de migration batch :", err);
  process.exit(1);
});