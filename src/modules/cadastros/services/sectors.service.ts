import { Injectable } from '@angular/core';
import { SectorsRepository } from '../repositories/sectors.repository';
import { Sector, AuditUser } from '../models/sector.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

@Injectable({ providedIn: 'root' })
export class SectorsService {
  constructor(
    private readonly repo: SectorsRepository,
    private readonly session: SessionService,
    private readonly usersRepo: UsersRepository,
    private readonly auditLog: AuditLogService
  ) {}

  private isAdmin(): boolean {
    return this.session.hasRole(['ADMIN'] as any);
  }

  private getLoggedCompanyId(): string {
    const u = (this.session as any).user?.();
    return u?.companyId ?? '';
  }

  async createSector(input: Partial<Sector>): Promise<string> {
    const loggedCompanyId = this.getLoggedCompanyId();
    if (!this.isAdmin()) {
      (input as any).companyId = loggedCompanyId;
    }
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `sector_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const doc: Sector = {
      id,
      companyId: this.isAdmin() ? (input.companyId ?? '') : (loggedCompanyId ?? ''),
      unitId: input.unitId ?? '',
      name: input.name ?? '',
      workEnvironmentDescription: input.workEnvironmentDescription ?? '',
      estimatedWorkers: input.estimatedWorkers ?? 0,
      status: input.status ?? 'active',
      notes: input.notes ?? '',
      equipmentIds: input.equipmentIds ?? [],
      createdAt: now,
      createdBy: audit,
      updatedAt: now,
      updatedBy: audit,
    };
    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.SECTOR_CREATE_ERROR, createError, { name: doc.name, companyId: doc.companyId });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.SECTOR_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { sectorId: id, name: doc.name, companyId: doc.companyId }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async updateSector(id: string, patch: Partial<Sector>): Promise<void> {
    const loggedCompanyId = this.getLoggedCompanyId();
    if (!this.isAdmin()) {
      delete (patch as any).companyId;
      (patch as any).companyId = loggedCompanyId;
    }
    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    try {
      await this.repo.updateSector(id, { ...patch, updatedAt: now, updatedBy });
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.SECTOR_UPDATE_ERROR, updateError, { sectorId: id, patch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.SECTOR_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { sectorId: id, patch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, active: boolean): Promise<void> {
    try {
      await this.repo.updateSector(id, { status: active ? 'active' : 'inactive' });
    } catch (statusError) {
      await this.auditLog.logError(AuditAction.SECTOR_STATUS_ERROR, statusError, { sectorId: id, status: active ? 'active' : 'inactive' });
      throw statusError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.SECTOR_STATUS_CHANGED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { sectorId: id, status: active ? 'active' : 'inactive' }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async getSector(id: string): Promise<Sector | null> {
    const sector = await this.repo.getById(id);

    if (sector) {
      try {
        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        await this.auditLog.log({
          action: AuditAction.SECTOR_VIEWED,
          appVersion: '',
          osVersion: '',
          user_profile: user?.profile || 'UNKNOWN',
          userEmail: user?.email ?? '',
          userId: uid,
          details: { sectorId: id, name: sector.name }
        });
      } catch (e) { console.error('Audit error:', e); }
    }

    return sector;
  }

  async listSectorsPaged(term: string, pageSize: number, startAfterDoc?: any) {
    if (!this.isAdmin()) {
      const cid = this.getLoggedCompanyId();
      return this.repo.listPaged(cid || '', '', term, pageSize, startAfterDoc);
    }
    const scoped = (this.session as any).adminScopeCompanyId?.() ?? '';
    return this.repo.listPaged(scoped || '', '', term, pageSize, startAfterDoc);
  }

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }
}
