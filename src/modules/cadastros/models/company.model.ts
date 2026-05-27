export interface AuditUser {
  uid: string;
  name: string;
  email: string;
  profile?: string;
}

export type CompanyStatus = 'ativo' | 'inativo';
export type CompanyPersonType = 'PJ' | 'PF';
export type CompanyType =
    | 'Fazenda'
    | 'Indústria'
    | 'Revenda'
    | 'Prestadora'
    | 'Aviação Agrícola'
    | 'Comércio'
    | 'Serviços'
    | 'Associação'
    | 'Empresa Pública'
    | 'Órgão Público'
    | 'Transportadora'
    | 'Distribuição'
    | 'Outro';


export interface CompanyCnae {
  id: string;
  descricao: string;
  observacoes?: string[];
}

export interface Company {
  // Mantidos
  id: string;
  status?: CompanyStatus;
  email: string; // login da empresa

  createdAt: string;
  updatedAt?: string;
  createdBy: AuditUser;
  updatedBy?: AuditUser;

  // Novos (Identificação)
  razaoSocial: string;
  nomeFantasia: string;
  personType: CompanyPersonType; // PJ | PF
  document: string; // CNPJ ou CPF (conforme tipo)
  caepf?: string; // obrigatório apenas PF rural (validação no form)
  cno?: string;

  // Responsável legal
  legalResponsibleName: string;
  legalResponsibleCpf: string;

  // Endereço
  addressStreet: string;
  addressNumber?: string;
  addressComplement?: string;
  addressZipCode?: string;
  addressUf: string;
  addressCity: string;
  latitude?: string;
  longitude?: string;

  // Classificação
  companyType: CompanyType;
  cnaeMain: CompanyCnae;
  cnaeSecondary?: CompanyCnae[];
  workEnvironmentDescription: string;

  // Contato
  institutionalEmail: string;
  phoneWhatsapp: string;

  // Controle
  notes?: string;

  /**
   * Compatibilidade: campo antigo usado em telas/queries anteriores.
   * Preferir razaoSocial/nomeFantasia.
   */
  name?: string;
  cnpj?: string;
}
