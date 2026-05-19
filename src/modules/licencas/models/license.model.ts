export interface AuditUser {
  uid: string;
  name: string;
  email: string;
  profile?: string;
}

export type LicenseStatus = 'em_dia' | 'a_vencer' | 'vencida';
export type LicensePeriodicity = 'Anual' | 'Bienal' | 'Trienal' | 'Eventual' | 'Contínuo (sem vencimento)';

export interface License {
  id: string;
  companyId: string;
  unitId: string;
  documentGroup: string;
  documentType: string;
  documentNumber: string;
  issuingAgency: string;
  legalBasis: string; // Base Legal / Referência Normativa (obrigatório, até 150 caracteres)
  periodicity?: LicensePeriodicity; // Periodicidade
  issueDate: string; // dd/mm/yyyy
  expirationDate: string; // dd/mm/yyyy
  renewalDate: string; // dd/mm/yyyy (Obrigatório para alguns tipos de Licenciamento Ambiental)
  status: LicenseStatus;
  pdfUrl?: string;
  pdfName?: string; // nome do arquivo PDF armazenado
  pdfContentType?: string; // content-type do arquivo
  notes?: string;

  // Matrículas rurais (obrigatório para Cadastro Ambiental Rural - CAR)
  ruralRegistrations?: string; // Matrículas do imóvel rural

  // Responsável Técnico pela Elaboração (obrigatório para Programas de SST)
  technicalResponsibleName?: string; // Nome completo
  technicalResponsibleCpf?: string; // CPF
  technicalResponsibleCouncil?: string; // Conselho de Classe
  technicalResponsibleRegistration?: string; // Nº de Registro
  technicalResponsibleArt?: string; // Nº da ART

  createdAt: string;
  updatedAt?: string;
  createdBy: AuditUser;
  updatedBy?: AuditUser;

  // Exclusão lógica (soft delete)
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: AuditUser;
}

export type ConditionStatus = 'pendente' | 'a_vencer' | 'cumprida' | 'vencida';

// Opções de periodicidade
export const PERIODICITY_OPTIONS: LicensePeriodicity[] = [
  'Anual',
  'Bienal',
  'Trienal',
  'Eventual',
  'Contínuo (sem vencimento)'
];

export interface LicenseCondition {
  id: string;
  licenseId: string;
  companyId: string;
  description: string;
  dueDate: string; // dd/mm/yyyy
  status: ConditionStatus;
  evidenceUrl?: string;
  evidenceName?: string; // nome do arquivo de evidência armazenado
  evidenceContentType?: string; // content-type do arquivo
  evidenceNotes?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: AuditUser;
  updatedBy?: AuditUser;

  // Exclusão lógica (soft delete)
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: AuditUser;
}

// Grupos de documentos regulatórios
export interface LicenseGroup {
  group: string;
  items: string[];
}

export const LICENSE_GROUPS: LicenseGroup[] = [
  {
    group: 'Licenciamento Ambiental',
    items: [
      'Licença Prévia (LP)',
      'Licença de Instalação (LI)',
      'Licença de Operação (LO)',
      'Renovação da LO',
      'Dispensa de Licenciamento',
      'Declaração de Uso Insignificante (DUI)',
      'Outorga de Água',
      'Autorização Ambiental'
    ]
  },
  {
    group: 'Documentos Rurais / Florestais',
    items: [
      'Cadastro Ambiental Rural (CAR)',
      'Certificado de Cadastro de Imóvel Rural (CCIR)',
      'Autorização de Exploração Florestal (AEF)',
      'Documento de Origem Florestal (DOF)'
    ]
  },
  {
    group: 'Resíduos e Logística Reversa',
    items: [
      'Plano de Gerenciamento de Resíduos Sólidos (PGRS)',
      'Manifesto de Transporte de Resíduos (MTR)',
      'Certificado de Destinação Final (CDF)',
      'Recibo de Devolução de Embalagens Vazias',
      'Logística Reversa (Certificados e Créditos)',
      'Termo de Credenciamento da Central de Embalagens Vazias',
      'Termo de Credenciamento com o inpEV'
    ]
  },
  {
    group: 'Registros e Cadastros Obrigatórios',
    items: [
      'Registro IBAMA',
      'CTF',
      'CTDAM',
      'Registro no CREA (Empresa)',
      'ART – CREA'
    ]
  },
  {
    group: 'Alvarás e Certidões',
    items: [
      'AVCB',
      'Alvará de Funcionamento',
      'Licença Sanitária',
      'Certidão de Uso e Ocupação do Solo',
      'Certidão de Inteiro Teor',
      'Certificado de Desinsetização e Desratização'
    ]
  },
  {
    group: 'Transporte',
    items: [
      'Autorização para Transporte de Produto Perigoso'
    ]
  },
  {
    group: 'Documentação Técnica Ocupacional (SST)',
    items: [
      'Programa de Gerenciamento de Riscos (PGR / PGRTR)',
      'Programa de Controle Médico de Saúde Ocupacional (PCMSO)',
      'Laudo Técnico das Condições Ambientais do Trabalho (LTCAT)'
    ]
  }
];

// Tipos de licença padrão (mantido para compatibilidade)
export const LICENSE_TYPES = [
  'Licença Ambiental',
  'Licença Prévia (LP)',
  'Licença de Instalação (LI)',
  'Licença de Operação (LO)',
  'Autorização Ambiental',
  'Outorga de Água',
  'AVCB',
  'Alvará de Funcionamento',
  'Licença Sanitária',
  'Registro IBAMA',
  'CTF',
  'Outro'
];

// Helper para calcular status da licença
export function calculateLicenseStatus(expirationDate: string, alertDays = 30): LicenseStatus {
  if (!expirationDate) return 'vencida';

  const [day, month, year] = expirationDate.split('/').map(Number);
  if (!day || !month || !year) return 'vencida';

  const expDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'vencida';
  if (diffDays <= alertDays) return 'a_vencer';
  return 'em_dia';
}

// Helper para calcular dias restantes
export function daysUntilExpiration(expirationDate: string): number {
  if (!expirationDate) return -9999;

  const [day, month, year] = expirationDate.split('/').map(Number);
  if (!day || !month || !year) return -9999;

  const expDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Helper para calcular status da condicionante
export function calculateConditionStatus(dueDate: string, alertDays = 15): ConditionStatus {
  if (!dueDate) return 'pendente';

  const [day, month, year] = dueDate.split('/').map(Number);
  if (!day || !month || !year) return 'pendente';

  const due = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'vencida';
  if (diffDays <= alertDays) return 'a_vencer';
  return 'pendente';
}
