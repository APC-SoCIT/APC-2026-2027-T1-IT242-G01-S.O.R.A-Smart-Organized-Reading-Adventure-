export type Rarity = 3 | 4 | 5;

export type QuestTrack = 'daily' | 'weekly' | 'seasonal';

export interface Volume {
  catalogStatus?: string;
  physicalCopies?: import('../lib/shelf-location').LocatedCopy[];
  coverImage?: string;
  isbn?: string | null;
  publisher?: string | null;
  originalTitle?: string | null;
  id: string;
  title: string;
  author: string;
  genre: string;
  volume: number;
  chapters: number;
  rating: number;
  rarity: Rarity;
  copies: number;
  synopsis: string;
  /** Two-line stacked title used on the cover plate. */
  plate: string[];
  plateColor: string;
  plateInk: string;
}

export interface Commission {
  id: string;
  track: QuestTrack;
  name: string;
  detail: string;
  seal: string;
  xp: number;
  coins: number;
  progress: number;
  participants: number;
}

export interface NavItem {
  id: SectionId;
  label: string;
  hint: string;
  shortcut: string;
}

export type SectionId = 'archive' | 'catalog' | 'shelf' | 'commissions' | 'guide';

export interface BorrowedVolume {
  volumeId: string;
  dueInDays: number;
  progress: number;
}

export interface BookClub {
  id: string;
  name: string;
  reading: string;
  members: number;
  meets: string;
}

export interface BonMessage {
  id: string;
  from: 'bon' | 'user';
  text: string;
}

export interface Toast {
  id: string;
  title: string;
  detail: string;
  kind: 'reward' | 'info' | 'level';
}
