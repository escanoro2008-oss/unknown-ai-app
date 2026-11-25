export type ThinkingMode = 'fast' | 'balanced' | 'deep';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
  previewUrl?: string;
  isText?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface GeneratedImage {
  dataUrl: string;
  mimeType: string;
  prompt?: string;
  mode: 'generated' | 'enhanced';
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: Attachment[];
  generatedImages?: GeneratedImage[];
  sources?: GroundingSource[];
  createdAt: number;
  isError?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}
