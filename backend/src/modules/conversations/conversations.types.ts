export interface SendManualMessageInput {
  content: string;
}

export interface SendManualMessageResult {
  messageId: string;
  conversationId: string;
}

// nouveau
export interface ToggleBotResult {
  conversationId: string;
  botEnabled: boolean;
}

export interface ResumeConversationResult {
  conversationId: string;
  status: string;
}

// nouveau — lecture (liste + détail)
export interface ConversationListItem {
  id: string;
  channel: string;
  status: string;
  customerIdentifier: string;
  botEnabled: boolean;
  leadCustomerName: string | null;
  lastMessageContent: string | null;
  lastMessageDirection: string | null;
  lastMessageAt: string | null;
}

export interface ConversationMessagesResult {
  conversation: {
    id: string;
    channel: string;
    status: string;
    customerIdentifier: string;
    botEnabled: boolean;
    internalNotes: string | null;
  };
  messages: Array<{
    id: string;
    conversationId: string;
    direction: string;
    content: string;
    messageType: string;
    mediaBase64: string | null;
    mediaMimeType: string | null;
    sentAt: Date;
  }>;
}

export interface AppendNoteResult {
  conversationId: string;
  internalNotes: string;
}