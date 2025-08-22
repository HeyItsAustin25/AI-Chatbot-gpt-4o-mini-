export type Role = 'user' | 'assistant' | 'system';

export interface ChatItem {
  role: Role;
  content: string;
  time: number; // epoch ms, useful for ordering
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatItem[];
}