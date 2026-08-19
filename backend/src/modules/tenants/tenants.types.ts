export interface CreateTenantInput {
  name: string;
  slug: string;
  // databaseUrl retiré : elle n'existe pas encore à la création,
  // elle sera renseignée par le worker de provisioning une fois le projet Neon créé
}