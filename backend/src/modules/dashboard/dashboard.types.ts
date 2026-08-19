export interface DashboardStats {
  conversationsTotal: number;
  conversationsHandover: number;
  leadsTotal: number;
  leadsNouveau: number;
  messagesLast24h: number;
  productsTotal: number;
  avgResponseTimeSeconds: number | null; // null si aucune paire inbound→outbound mesurable sur 24h
  whatsapp: {
    connected: boolean;
    status: string | null; // 'connected' | 'pending_qr' | 'logged_out' | null si aucune session
    phoneNumber: string | null;
  };
}