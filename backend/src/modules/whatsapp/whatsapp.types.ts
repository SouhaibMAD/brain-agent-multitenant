export interface CreateWhatsappSessionResult {
  sessionId: string;
  connectionStatus: string;
}

export interface WhatsappSessionSummary {
  id: string;
  phoneNumber: string | null;
  connectionStatus: string;
  lastConnectedAt: Date | null;
  lastDisconnectReason: string | null;
  createdAt: Date;
}