import { Injectable } from '@angular/core';
import { RisksRepository } from '../repositories/risks.repository';
import { Risk } from '../models/risk.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditUser } from '../models/company.model';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toNumberOrUndefined(v: any): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function toUpperSafe(v: any): string {
  return String(v ?? '').trim().toUpperCase();
}

@Injectable({ providedIn: 'root' })
export class RisksService {
  constructor(
    private readonly repo: RisksRepository,
    private readonly session: SessionService,
    private readonly usersRepo: UsersRepository,
    private readonly auditLog: AuditLogService
  ) {}

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  private async getAuditUser(): Promise<AuditUser> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    return { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
  }

  /**
   * ADMIN: companyId pode ser informado no input
   * CLIENTE: força companyId do usuário logado
   */
  private resolveCompanyId(inputCompanyId?: string): string {
    const u = (this.session as any).user?.();
    const isAdmin = this.session.hasRole(['ADMIN'] as any);
    if (isAdmin) return inputCompanyId ?? u?.companyId ?? '';
    return u?.companyId ?? '';
  }

  async createRisk(input: Partial<Risk>): Promise<string> {
    const now = new Date().toISOString();
    const id = `risk_${makeId()}`;
    const audit = await this.getAuditUser();

    const companyId = this.resolveCompanyId(input.companyId);

    const doc: any = {
      id,
      companyId,
      name: toUpperSafe(input.name),
      riskGroup: (input.riskGroup as any) ?? 'fisico',
      description: input.description ?? '',
      generatingSource: input.generatingSource ?? '',
      preventiveControlMeasures: input.preventiveControlMeasures ?? '',

      riskType: (input.riskType as any) ?? (input.evaluationType as any) ?? 'qualitativa',
      evaluationType: (input.evaluationType as any) ?? (input.riskType as any) ?? 'qualitativa',

      effectClassification: input.effectClassification,
      frequency: input.frequency,
      riskClassification: input.riskClassification,

      insalubrity: input.insalubrity ?? 'Não',
      insalubrityLevel: input.insalubrityLevel,
      dangerousness: input.dangerousness ?? 'Não',
      specialRetirement: input.specialRetirement ?? 'Não',
      specialRetirementPeriod: input.specialRetirementPeriod,

      quantitativeValue: toNumberOrUndefined((input as any).quantitativeValue),
      toleranceLimit: toNumberOrUndefined((input as any).toleranceLimit),
      esocialCode: input.esocialCode ?? '',
      evaluationMethod: input.evaluationMethod ?? '',
      measurementUnit: input.measurementUnit ?? '',
      measurementEquipment: input.measurementEquipment ?? '',
      calibrationCertificateNumber: input.calibrationCertificateNumber ?? '',
      notes: input.notes ?? '',
      status: (input.status as any) ?? 'ativo',
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,
    };

    // remove undefined
    for (const k of Object.keys(doc)) {
      if (doc[k] === undefined) delete doc[k];
    }

    try {
      await this.repo.create(doc as Risk);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.RISK_CREATE_ERROR, createError, { name: doc.name, companyId: doc.companyId });
      throw createError;
    }

    try {
      const user = await this.usersRepo.get(audit.uid);
      await this.auditLog.log({
        action: AuditAction.RISK_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { riskId: id, name: doc.name, companyId: doc.companyId }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async updateRisk(id: string, patch: Partial<Risk>): Promise<void> {
    const now = new Date().toISOString();
    const audit = await this.getAuditUser();

    const safePatch: any = {
      ...patch,
      ...(patch.name !== undefined ? { name: toUpperSafe(patch.name) } : {}),
      quantitativeValue: patch.evaluationType === 'qualitativa' ? undefined : toNumberOrUndefined((patch as any).quantitativeValue),
      toleranceLimit: toNumberOrUndefined((patch as any).toleranceLimit),
      updatedAt: now,
      updatedBy: audit,
    };

    // não permitir sobrescrever created*
    delete safePatch.createdAt;
    delete safePatch.createdBy;

    // remove undefined
    for (const k of Object.keys(safePatch)) {
      if (safePatch[k] === undefined) delete safePatch[k];
    }

    try {
      await this.repo.updateRisk(id, safePatch);
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.RISK_UPDATE_ERROR, updateError, { riskId: id, patch: safePatch });
      throw updateError;
    }

    try {
      const user = await this.usersRepo.get(audit.uid);
      await this.auditLog.log({
        action: AuditAction.RISK_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { riskId: id, patch: safePatch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, ativo: boolean): Promise<void> {
    await this.updateRisk(id, { status: ativo ? 'ativo' : 'inativo' } as any);
  }

  async listRisksPaged(term: string, pageSize: number, startAfterDoc?: any) {
    const u = (this.session as any).user?.();
    const isAdmin = this.session.hasRole(['ADMIN'] as any);

    if (!isAdmin) {
      // CLIENTE: sempre filtra pela empresa vinculada
      const companyId = u?.companyId ?? null;
      return this.repo.listByNamePaged(companyId, term, pageSize, startAfterDoc);
    }

    // ADMIN: usa escopo selecionado no topbar (null = todas)
    const scoped = this.session.adminScopeCompanyId() ?? null;
    return this.repo.listByNamePaged(scoped, term, pageSize, startAfterDoc);
  }
}
