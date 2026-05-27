import { Injectable, inject } from '@angular/core';
import { CompanyEquipmentsRepository } from '../repositories/company-equipments.repository';
import { EquipmentsRepository } from '../repositories/equipments.repository';
import { CompanyEquipment } from '../models/company-equipment.model';
import { Equipment } from '../models/equipment.model';
import { EquipmentsService } from './equipments.service';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditUser } from '../models/company.model';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }

@Injectable({ providedIn: 'root' })
export class CompanyEquipmentsService {
  private readonly repo = inject(CompanyEquipmentsRepository);
  private readonly genericRepo = inject(EquipmentsRepository);
  private readonly genericService = inject(EquipmentsService);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly auditLog = inject(AuditLogService);

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  async createFromGeneric(companyId: string, genericEquipment: Equipment): Promise<string> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `cequip_${makeId()}`;

    const doc: CompanyEquipment = {
      ...genericEquipment,
      id,
      companyId,
      sourceEquipmentId: genericEquipment.id,
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,
      status: 'ativo'
    } as CompanyEquipment;

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_EQUIPMENT_LINK_ERROR, createError, { companyId, genericEquipmentId: genericEquipment.id });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_EQUIPMENT_LINKED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { companyId, companyEquipmentId: id, genericEquipmentId: genericEquipment.id, name: genericEquipment.name }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async listByCompany(companyId: string): Promise<CompanyEquipment[]> {
    return this.repo.listByCompany(companyId);
  }

  async listByCompanyPaged(companyId: string, term: string, pageSize: number, startAfterDoc?: any) {
    return this.repo.listByCompanyPaged(companyId, term, pageSize, startAfterDoc);
  }

  async updateEquipment(id: string, patch: Partial<CompanyEquipment>): Promise<void> {
    const isAdmin = this.session.hasRole(['ADMIN'] as any);
    const hasScope = !!(this.session.adminScopeCompanyId && this.session.adminScopeCompanyId());
    
    // Se for ADMIN e não houver escopo, ou se for um ID global (equip_...)
    // Redireciona para o EquipmentsService global.
    if (isAdmin && !hasScope && id.startsWith('equip_')) {
      return this.genericService.updateEquipment(id, patch as any);
    }

    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    try {
      await this.repo.updateEquipment(id, { ...patch, updatedAt: now, updatedBy });
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.COMPANY_EQUIPMENT_UPDATE_ERROR, updateError, { companyEquipmentId: id, patch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_EQUIPMENT_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { companyEquipmentId: id, patch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async deleteEquipment(id: string): Promise<void> {
    const isAdmin = this.session.hasRole(['ADMIN'] as any);
    const hasScope = !!(this.session.adminScopeCompanyId && this.session.adminScopeCompanyId());

    // Se for ADMIN e não houver escopo, ou se for um ID global (equip_...)
    // Redireciona para o EquipmentsService global.
    if (isAdmin && !hasScope && id.startsWith('equip_')) {
      // EquipmentsService doesn't have deleteEquipment, but it should probably be there or we should use repo directly
      // Checking if EquipmentsService has deleteEquipment
      return this.genericRepo.delete(id);
    }
    try {
      await this.repo.deleteEquipment(id);
    } catch (deleteError) {
      await this.auditLog.logError(AuditAction.COMPANY_EQUIPMENT_DELETE_ERROR, deleteError, { companyEquipmentId: id });
      throw deleteError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.COMPANY_EQUIPMENT_DELETED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { companyEquipmentId: id }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, ativo: boolean): Promise<void> {
    await this.updateEquipment(id, { status: ativo ? 'ativo' : 'inativo' });
  }

  async createEquipment(input: Partial<Equipment>): Promise<string> {
    return this.genericService.createEquipment(input);
  }

  async listEquipmentsPaged(term: string, pageSize: number, startAfterDoc?: any) {
    const isAdmin = this.session.hasRole(['ADMIN'] as any);
    const scoped = isAdmin ? (this.session.adminScopeCompanyId() ?? null) : ((this.session as any).user?.()?.companyId ?? null);

    if (scoped) {
      return this.repo.listByCompanyPaged(scoped, term, pageSize, startAfterDoc);
    }
    
    // Se for ADMIN sem escopo, lista os globais (fallback para o comportamento atual)
    return this.genericRepo.listByNamePaged(term, pageSize, startAfterDoc);
  }
}
