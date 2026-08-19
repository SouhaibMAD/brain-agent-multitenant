// src/modules/agent/agent.types.ts

export interface IncomingImageInput {
  base64: string;
  mimeType: string;
}

export interface ProcessMessageInput {
  conversationId: string;
  channel: string;
  incomingContent: string;
  image?: IncomingImageInput; // nouveau — présent uniquement pour un message avec image (support screenshots produits)
}

export type SkipReason = 'conversation_in_handover' | 'db_unavailable_on_write' | 'bot_manually_disabled';

export interface ProcessMessageResult {
  skipped: boolean;
  reason?: SkipReason;
  assistantReply?: string;
}