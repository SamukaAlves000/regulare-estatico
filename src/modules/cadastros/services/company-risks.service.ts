import { Injectable, inject } from '@angular/core';
import { CompanyRisksRepository } from '../repositories/company-risks.repository';
import { RisksRepository } from '../repositories/risks.repository';
import { CompanyRisk } from '../models/company-risk.model';
import { Risk } from '../models/risk.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditUser } from '../models/company.model';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }

@Injectable({ providedIn: 'root' })
export class CompanyRisksService {
  private readonly repo = inject(CompanyRisksRepository);
  private readonly genericRepo = inject(RisksRepository);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly auditLog = inject(AuditLogService);

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  async createFromGeneric(companyId: string, genericRisk: Risk): Promise<string> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '' };
    const now = new Date().toISOString();
    const id = `crisk_${makeId()}`;

    const doc: CompanyRisk = {
      ...genericRisk,
      id,
      companyId,
      sourceRiskId: genericRisk.id,
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,
      status: 'ativo'
    } as CompanyRisk;

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_RISK_LINK_ERROR, createError, { companyId, genericRiskId: genericRisk.id });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_RISK_LINKED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { companyId, companyRiskId: id, genericRiskId: genericRisk.id, name: genericRisk.name }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async listByCompany(companyId: string): Promise<CompanyRisk[]> {
    return this.repo.listByCompany(companyId);
  }

  async updateRisk(id: string, patch: Partial<CompanyRisk>): Promise<void> {
    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '' };
    try {
      await this.repo.updateRisk(id, { ...patch, updatedAt: now, updatedBy });
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.COMPANY_RISK_UPDATE_ERROR, updateError, { companyRiskId: id, patch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_RISK_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { companyRiskId: id, patch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async deleteRisk(id: string): Promise<void> {
    try {
      await this.repo.deleteRisk(id);
    } catch (deleteError) {
      await this.auditLog.logError(AuditAction.COMPANY_RISK_DELETE_ERROR, deleteError, { companyRiskId: id });
      throw deleteError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.COMPANY_RISK_DELETED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { companyRiskId: id }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async searchCompanyRisks(companyId: string, term: string): Promise<CompanyRisk[]> {
    return this.repo.listByCompany(companyId).then(list => {
      if (!term) return list;
      const t = term.trim().toLowerCase();
      return list.filter(r => (r.name || '').toLowerCase().includes(t));
    });
  }

  async createCompanyRisk(companyId: string, input: Partial<CompanyRisk>): Promise<string> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '' };
    const now = new Date().toISOString();
    const id = `crisk_${makeId()}`;

    const doc: CompanyRisk = {
      id,
      companyId,
      name: String((input as any).name ?? '').toUpperCase(),
      riskGroup: (input as any).riskGroup ?? 'fisico',
      description: (input as any).description ?? '',
      generatingSource: (input as any).generatingSource ?? '',
      preventiveControlMeasures: (input as any).preventiveControlMeasures ?? '',

      riskType: (input as any).riskType ?? (input as any).evaluationType ?? 'qualitativa',
      evaluationType: (input as any).evaluationType ?? (input as any).riskType ?? 'qualitativa',

      effectClassification: (input as any).effectClassification,
      frequency: (input as any).frequency,
      riskClassification: (input as any).riskClassification,

      insalubrity: (input as any).insalubrity ?? 'Não',
      insalubrityLevel: (input as any).insalubrityLevel,
      dangerousness: (input as any).dangerousness ?? 'Não',
      specialRetirement: (input as any).specialRetirement ?? 'Não',
      specialRetirementPeriod: (input as any).specialRetirementPeriod,

      quantitativeValue: (input as any).quantitativeValue,
      toleranceLimit: (input as any).toleranceLimit,
      measurementUnit: (input as any).measurementUnit,
      measurementEquipment: (input as any).measurementEquipment,
      calibrationCertificateNumber: (input as any).calibrationCertificateNumber,
      esocialCode: (input as any).esocialCode ?? '',
      evaluationMethod: (input as any).evaluationMethod ?? '',
      notes: (input as any).notes ?? '',
      status: (input as any).status ?? 'ativo',
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,
    } as CompanyRisk;

    // remove undefined
    for (const k of Object.keys(doc)) if ((doc as any)[k] === undefined) delete (doc as any)[k];

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_RISK_CREATE_ERROR, createError, { companyId, name: doc.name });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_RISK_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { companyId, companyRiskId: id, name: doc.name }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async setActive(id: string, ativo: boolean): Promise<void> {
    await this.updateRisk(id, { status: ativo ? 'ativo' : 'inativo' });
  }
}
