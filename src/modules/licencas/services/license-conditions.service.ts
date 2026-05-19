import { Injectable, inject } from '@angular/core';
import { LicenseConditionsRepository } from '../repositories/license-conditions.repository';
import { LicenseCondition, AuditUser, calculateConditionStatus } from '../models/license.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AlertsService } from '../../alertas/services/alerts.service';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class LicenseConditionsService {
  private readonly repo = inject(LicenseConditionsRepository);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly alerts = inject(AlertsService);
  private readonly companiesRepo = inject(CompaniesRepository);
  private readonly auditLog = inject(AuditLogService);

  private async getAuditUser(): Promise<AuditUser> {
    const fbUser = this.session.user();
    if (!fbUser) {
      return { uid: 'SISTEMA', name: 'SISTEMA', email: '' };
    }
    const userDoc = await this.usersRepo.getById(fbUser.id);
    return {
      uid: fbUser.id,
      name: userDoc?.name ?? fbUser.name ?? 'Usuário',
      email: userDoc?.email ?? fbUser.email ?? '',
      profile: userDoc?.profile
    };
  }

  async createCondition(data: Partial<LicenseCondition>): Promise<LicenseCondition> {
    const audit = await this.getAuditUser();
    const id = makeId('cond_');
    const now = new Date().toISOString();

    const condition: LicenseCondition = {
      id,
      licenseId: data.licenseId ?? '',
      companyId: data.companyId ?? '',
      description: (data.description ?? '').toUpperCase(),
      dueDate: data.dueDate ?? '',
      status: calculateConditionStatus(data.dueDate ?? ''),
      evidenceUrl: data.evidenceUrl ?? '',
      evidenceName: data.evidenceName ?? '',
      evidenceContentType: data.evidenceContentType ?? '',
      evidenceNotes: data.evidenceNotes ?? '',
      createdAt: now,
      createdBy: audit,
    };

    try {
      await this.repo.create(condition);
      
      const company = await this.companiesRepo.get(condition.companyId);
      await this.alerts.generateAlerts(
        'condicionante', 
        condition.id, 
        audit.uid, 
        condition.dueDate,
        {
          companyId: condition.companyId,
          companyName: company?.nomeFantasia || company?.razaoSocial || 'N/A',
          documento: condition.description
        }
      );

      await this.auditLog.log({
        action: AuditAction.CONDITION_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { conditionId: id, licenseId: condition.licenseId, description: condition.description }
      });

      if (condition.evidenceUrl) {
        await this.auditLog.log({
          action: AuditAction.CONDITION_DOCUMENT_UPLOADED,
          appVersion: '',
          osVersion: '',
          user_profile: audit.profile || 'UNKNOWN',
          userEmail: audit.email,
          userId: audit.uid,
          details: { conditionId: id, fileName: condition.evidenceName }
        });
      }

      return condition;
    } catch (error) {
      await this.auditLog.logError(AuditAction.CONDITION_CREATE_ERROR, error, { data });
      throw error;
    }
  }

  async updateCondition(id: string, data: Partial<LicenseCondition>): Promise<void> {
    const audit = await this.getAuditUser();
    const now = new Date().toISOString();

    const updateData: Partial<LicenseCondition> = {
      ...data,
      status: calculateConditionStatus(data.dueDate ?? ''),
      updatedAt: now,
      updatedBy: audit,
    };

    if (updateData.description) {
      updateData.description = updateData.description.toUpperCase();
    }

    try {
      await this.repo.updateCondition(id, updateData);

      if (updateData.dueDate || updateData.description || updateData.companyId) {
        const current = await this.getById(id);
        if (current) {
          // Clear existing alerts for this specific condition before regenerating
          await this.alerts.deleteAlertsByOrigin(id);

          const company = await this.companiesRepo.get(current.companyId);
          await this.alerts.generateAlerts(
            'condicionante', 
            id, 
            audit.uid, 
            current.dueDate,
            {
              companyId: current.companyId,
              companyName: company?.nomeFantasia || company?.razaoSocial || 'N/A',
              documento: current.description
            }
          );
        }
      }

      // Se apenas a evidência (PDF) foi atualizada, não registramos o log de CONDITION_UPDATED genérico
      const businessFields = ['description', 'dueDate', 'status', 'evidenceNotes'];
      const hasBusinessChanges = Object.keys(data).some(key => 
        businessFields.includes(key) && data[key as keyof typeof data] !== undefined
      );

      const isEvidenceUpload = !!data.evidenceUrl;

      if (hasBusinessChanges || !isEvidenceUpload) {
        await this.auditLog.log({
          action: AuditAction.CONDITION_UPDATED,
          appVersion: '',
          osVersion: '',
          user_profile: audit.profile || 'UNKNOWN',
          userEmail: audit.email,
          userId: audit.uid,
          details: { conditionId: id, patch: data }
        });
      }

      if (isEvidenceUpload) {
        await this.auditLog.log({
          action: AuditAction.CONDITION_DOCUMENT_UPLOADED,
          appVersion: '',
          osVersion: '',
          user_profile: audit.profile || 'UNKNOWN',
          userEmail: audit.email,
          userId: audit.uid,
          details: { conditionId: id, fileName: data.evidenceName, mode: !hasBusinessChanges ? 'upload' : 'update' }
        });
      }
    } catch (error) {
      await this.auditLog.logError(AuditAction.CONDITION_UPDATE_ERROR, error, { conditionId: id, data });
      throw error;
    }
  }

  async markAsCumprida(id: string): Promise<void> {
    const audit = await this.getAuditUser();
    const now = new Date().toISOString();
    try {
      await this.repo.updateCondition(id, {
        status: 'cumprida',
        updatedAt: now,
        updatedBy: audit,
      });

      await this.auditLog.log({
        action: AuditAction.CONDITION_MARKED_AS_CUMPRIDA,
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { conditionId: id }
      });
    } catch (error) {
      await this.auditLog.logError(AuditAction.CONDITION_UPDATE_ERROR, error, { conditionId: id, action: 'markAsCumprida' });
      throw error;
    }
  }

  async getById(id: string): Promise<LicenseCondition | null> {
    return this.repo.getById(id);
  }

  async listByLicense(licenseId: string): Promise<LicenseCondition[]> {
    return this.repo.listByLicense(licenseId);
  }

  async listByCompany(companyId: string, max = 200): Promise<LicenseCondition[]> {
    return this.repo.listByCompany(companyId, max);
  }

  async delete(id: string): Promise<void> {
    try {
      await this.repo.deleteCondition(id);
      const audit = await this.getAuditUser();
      await this.auditLog.log({
        action: 'condition_deleted',
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { conditionId: id }
      });
    } catch (error) {
      const audit = await this.getAuditUser();
      await this.auditLog.logError('condition_delete', error, { conditionId: id });
      throw error;
    }
  }

  // Exclusão lógica (soft delete)
  async softDelete(id: string): Promise<void> {
    const audit = await this.getAuditUser();
    const now = new Date().toISOString();

    try {
      await this.repo.updateCondition(id, {
        deleted: true,
        deletedAt: now,
        deletedBy: audit,
      });

      await this.auditLog.log({
        action: 'condition_soft_deleted',
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { conditionId: id }
      });
    } catch (error) {
      await this.auditLog.logError('condition_soft_delete', error, { conditionId: id });
      throw error;
    }
  }

  // Restaurar registro excluído
  async restore(id: string): Promise<void> {
    try {
      await this.repo.updateCondition(id, {
        deleted: false,
        deletedAt: undefined,
        deletedBy: undefined,
      });

      const audit = await this.getAuditUser();
      await this.auditLog.log({
        action: 'condition_restored',
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { conditionId: id }
      });
    } catch (error) {
      const audit = await this.getAuditUser();
      await this.auditLog.logError('condition_restore', error, { conditionId: id });
      throw error;
    }
  }
}
