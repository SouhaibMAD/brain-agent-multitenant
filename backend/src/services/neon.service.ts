import { createApiClient } from "@neondatabase/api-client";
import { config } from "../config/index.js";

const apiClient = createApiClient({
  apiKey: config.neonApiKey,
});

export interface ProvisionedNeonProject {
  projectId: string;
  connectionUri: string;
}

export async function createNeonProjectForTenant(
  tenantSlug: string
): Promise<ProvisionedNeonProject> {
  const response = await apiClient.createProject({
    project: {
      name: `tenant-${tenantSlug}`,
      region_id: "aws-eu-west-2",
      pg_version: 17,
    },
  });

  const project = response.data.project;
  const connectionUri = response.data.connection_uris?.[0]?.connection_uri;

  if (!connectionUri) {
    throw new Error(
      `Neon n'a pas retourné de connection_uri pour le projet ${project.id}`
    );
  }

  return {
    projectId: project.id,
    connectionUri,
  };
}