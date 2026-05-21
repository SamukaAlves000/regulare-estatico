import { AuditUser } from '../../cadastros/models/company.model';
import { Equipment } from '../../cadastros/models/equipment.model';

export interface EpiDeliveryItem extends Omit<Equipment, 'id'> {
    caNumber: string;
    model: string;
    brand: string;
  equipmentId: string;
  quantity: number;
  nextExchangeDate: string; // ISO date string ou yyyy-MM-dd para input date
}

export interface EpiDelivery {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCpf?: string;
  employeeAdmissionDate?: string;
  employeeEsocialRegistration?: string;
  cargoId: string;
  cargoName: string;
  cargoCbo: string;
  
  companyId: string;
  companyName?: string;
  companyCnpj?: string;
  unitId: string;
  sectorId: string;
  
  deliveryDate: string; // ISO date string
  items: EpiDeliveryItem[];
  riskIds: string[]; // Riscos marcados no momento da entrega
  
  receiptUrl?: string; // Comprovante opcional
  receiptName?: string;
  
  signatureUrl?: string;
  signatureDate?: string;
  signed?: boolean;
  
  createdAt: string;
  updatedAt: string;
  createdBy: AuditUser;
  updatedBy?: AuditUser;

  // Exclusão lógica (soft delete)
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: AuditUser;
}
