export type UserProfile = 'ADMIN' | 'CONSULTOR' | 'CLIENTE';
export type UserStatus = 'ATIVO' | 'INATIVO';

export interface User {
  id: string; // uid
  name: string;
  email: string;
  profile: UserProfile;
  companyId: string;
  status: UserStatus;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export const emptyUser: User = {
  id: '',
  name: '',
  email: '',
  profile: 'CLIENTE',
  companyId: '',
  status: 'INATIVO',
  active: false,
  createdAt: '',
};
