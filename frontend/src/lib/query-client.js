import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // le retry sur 401 est déjà géré par l'intercepteur axios, pas besoin de plus
      staleTime: 10_000,
      refetchOnWindowFocus: false, // évite un refetch surprise pendant une démo/soutenance
    },
  },
});