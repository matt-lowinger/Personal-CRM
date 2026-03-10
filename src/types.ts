export type ContactLevel = 'A' | 'B' | 'C' | 'D';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  instagramHandle?: string;
  socialScanStatus?: 'pending' | 'scanning' | 'completed' | 'failed';
  level: ContactLevel;
  lastInteractionAt?: string;
  nextOutreachAt?: string;
  tags: string[];
  ownerId: string;
  createdAt: string;
  reachOutReason?: string;
}

export type InteractionType = 'gmail' | 'linkedin' | 'whatsapp' | 'imessage' | 'instagram' | 'manual' | 'rss';

export interface Interaction {
  id: string;
  contactId: string;
  type: InteractionType;
  content: string;
  timestamp: string;
  externalId?: string;
  ownerId: string;
}

export interface Settings {
  frequencies: Record<ContactLevel, number>; // Days
  ownerId: string;
}
