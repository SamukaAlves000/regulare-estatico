export interface AuditUser {
  uid: string;
  name: string;
  email: string;
  profile?: string;
}

export type SectorStatus = 'active' | 'inactive';

export interface Sector {
  id: string;
  companyId: string;
  unitId: string;
  name: string;
  workEnvironmentDescription: string;
  estimatedWorkers: number;
  status: SectorStatus;
  notes?: string;
  equipmentIds?: string[]; // IDs de equipamentos (EPCs) vinculados ao setor (da coleção company_equipments)
  createdAt: string;
  createdBy: AuditUser;
  updatedAt?: string;
  updatedBy?: AuditUser;
}
