export type LgpdTermStatus = 'draft' | 'published' | 'archived';

export interface LgpdTerm {
  id: string;
  version: string;
  title: string;
  content: string;
  active: boolean;
  status: LgpdTermStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  createdBy: string;
  updatedBy: string;
  hash?: string;
}

export interface LgpdTermAcceptance {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  companyId: string;
  companyName: string;
  termId: string;
  termVersion: string;
  acceptedAt: string;
  userAgent: string;
  accepted: true;
}