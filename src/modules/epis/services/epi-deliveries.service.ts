import { Injectable, inject } from '@angular/core';
import { EpiDeliveriesRepository } from '../repositories/epi-deliveries.repository';
import { EpiDelivery } from '../models/epi-delivery.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditUser } from '../../cadastros/models/company.model';
import { AlertsService } from '../../alertas/services/alerts.service';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class EpiDeliveriesService {
  private readonly repo = inject(EpiDeliveriesRepository);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly alerts = inject(AlertsService);
  private readonly companiesRepo = inject(CompaniesRepository);
  private readonly auditLog = inject(AuditLogService);

  private getUid(): string {
    const u = this.session.user();
    return u?.id ?? '';
  }

  private isAdmin(): boolean {
    return this.session.hasRole(['ADMIN'] as any);
  }

  private getLoggedCompanyId(): string {
    const u = this.session.user();
    return u?.companyId ?? '';
  }

  async createDelivery(input: Partial<EpiDelivery>): Promise<string> {
    const loggedCompanyId = this.getLoggedCompanyId();
    if (!this.isAdmin()) {
      input.companyId = loggedCompanyId;
    }

    if (!input.companyId) throw new Error('companyId is required');
    if (!input.unitId) throw new Error('unitId is required');
    if (!input.sectorId) throw new Error('sectorId is required');
    if (!input.employeeId) throw new Error('employeeId is required');

    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `deliv_${makeId()}`;

    const doc: EpiDelivery = {
      id,
      companyId: input.companyId!,
      unitId: input.unitId!,
      sectorId: input.sectorId!,
      employeeId: input.employeeId!,
      employeeName: input.employeeName!,
      cargoId: input.cargoId!,
      cargoName: input.cargoName!,
      cargoCbo: input.cargoCbo!,
      companyName: input.companyName,
      companyCnpj: input.companyCnpj,
      deliveryDate: input.deliveryDate || now,
      items: input.items || [],
      riskIds: input.riskIds || [],
      receiptUrl: input.receiptUrl,
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      deleted: false,
    };

    // Remover campos undefined para não quebrar o Firestore
    const safeDoc: any = { ...doc };
    Object.keys(safeDoc).forEach(key => {
      if (safeDoc[key] === undefined) delete safeDoc[key];
    });

    try {
      await this.repo.set(safeDoc);

      // Gerar alertas para cada item com validade CA
      if (doc.items && doc.items.length > 0) {
        const company = await this.companiesRepo.get(doc.companyId);
        const companyName = company?.nomeFantasia || company?.razaoSocial || 'N/A';
        
        // Limpar todos os alertas desta entrega (ID completo) antes de regenerar
        await this.alerts.deleteAlertsByOriginPrefix(`${id}_`);

        for (const item of doc.items) {
          if (item.validUntil) {
            await this.alerts.generateAlerts(
              'epi', 
              `${id}_${item.equipmentId}`, 
              uid, 
              item.validUntil,
              {
                companyId: doc.companyId,
                companyName,
                documento: `${item.name} (${doc.employeeName})`
              }
            );
          }
        }
      }

      await this.auditLog.log({
        action: AuditAction.EPI_DELIVERY_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { deliveryId: id, employeeId: doc.employeeId, items: doc.items?.length }
      });

      return id;
    } catch (error) {
      await this.auditLog.logError(AuditAction.EPI_DELIVERY_CREATE_ERROR, error, { input });
      throw error;
    }
  }

  async updateDelivery(id: string, patch: Partial<EpiDelivery>): Promise<void> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();

    const safePatch: any = { ...patch, updatedAt: now, updatedBy };
    Object.keys(safePatch).forEach(key => {
      if (safePatch[key] === undefined) delete safePatch[key];
    });

    try {
      await this.repo.update(id, safePatch);

      // Se marcou como excluído, limpa todos os alertas vinculados
      if (patch.deleted === true) {
        await this.alerts.deleteAlertsByOriginPrefix(`${id}_`);
        
        await this.auditLog.log({
          action: AuditAction.EPI_DELIVERY_DELETED,
          appVersion: '',
          osVersion: '',
          user_profile: updatedBy.profile || 'UNKNOWN',
          userEmail: updatedBy.email,
          userId: updatedBy.uid,
          details: { deliveryId: id }
        });
        return;
      }

      // Se os itens ou dados base foram atualizados, regeneramos os alertas
      if (patch.items || patch.employeeName || patch.companyId) {
        const current = await this.getDelivery(id);
        if (current) {
          const company = await this.companiesRepo.get(current.companyId);
          const companyName = company?.nomeFantasia || company?.razaoSocial || 'N/A';
          const empName = current.employeeName || 'N/A';
          
          // Limpar todos os alertas desta entrega (ID completo) antes de regenerar
          await this.alerts.deleteAlertsByOriginPrefix(`${id}_`);

          // Usar itens atuais do banco (que já foram atualizados pelo update acima se patch.items existia)
          const itemsToProcess = current.items || [];

          for (const item of itemsToProcess) {
            if (item.validUntil) {
              await this.alerts.generateAlerts(
                'epi', 
                `${id}_${item.equipmentId}`, 
                uid, 
                item.validUntil,
                {
                  companyId: current.companyId,
                  companyName,
                  documento: `${item.name} (${empName})`
                }
              );
            }
          }
        }
      }

      // Evita log duplicado se for apenas upload de comprovante
      const businessFields = ['unitId', 'sectorId', 'employeeId', 'employeeName', 'cargoId', 'cargoName', 'cargoCbo', 'deliveryDate', 'items', 'riskIds', 'companyId', 'companyName', 'companyCnpj'];
      const hasBusinessChanges = Object.keys(patch).some(key => 
        businessFields.includes(key) && patch[key as keyof typeof patch] !== undefined
      );

      const isReceiptUpload = !!patch.receiptUrl;

      if (hasBusinessChanges || !isReceiptUpload) {
        await this.auditLog.log({
          action: AuditAction.EPI_DELIVERY_UPDATED,
          appVersion: '',
          osVersion: '',
          user_profile: updatedBy.profile || 'UNKNOWN',
          userEmail: updatedBy.email,
          userId: updatedBy.uid,
          details: { deliveryId: id, patch }
        });
      }
    } catch (error) {
      await this.auditLog.logError(AuditAction.EPI_DELIVERY_UPDATE_ERROR, error, { deliveryId: id, patch });
      throw error;
    }
  }

  async listDeliveriesPaged(employeeId: string | null, pageSize: number, startAfterDoc?: any) {
    const isAdmin = this.isAdmin();
    const scoped = isAdmin ? (this.session.adminScopeCompanyId() ?? null) : (this.getLoggedCompanyId() || null);

    return this.repo.listPaged(scoped, employeeId, pageSize, startAfterDoc);
  }

  listenToDeliveriesPaged(employeeId: string | null, pageSize: number, callback: (res: any) => void) {
    const isAdmin = this.isAdmin();
    const scoped = isAdmin ? (this.session.adminScopeCompanyId() ?? null) : (this.getLoggedCompanyId() || null);

    return this.repo.listenPaged(scoped, employeeId, pageSize, callback);
  }

  async getDelivery(id: string): Promise<EpiDelivery | null> {
    return this.repo.get(id);
  }

  listenToDelivery(id: string, callback: (data: EpiDelivery | null) => void) {
    return this.repo.listen(id, callback);
  }

  async deleteDelivery(id: string): Promise<void> {
    try {
      await this.alerts.deleteAlertsByOriginPrefix(`${id}_`);
      await this.repo.delete(id);

      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.EPI_DELIVERY_DELETED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { deliveryId: id, mode: 'hard' }
      });
    } catch (error) {
      await this.auditLog.logError(AuditAction.EPI_DELIVERY_UPDATE_ERROR, error, { deliveryId: id, mode: 'hard' });
      throw error;
    }
  }

  // Métodos específicos solicitados para log
  async logSignature(id: string, details: any): Promise<void> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    await this.auditLog.log({
      action: AuditAction.EPI_DELIVERY_SIGNED,
      appVersion: '',
      osVersion: '',
      user_profile: user?.profile || 'UNKNOWN',
      userEmail: user?.email ?? '',
      userId: uid,
      details: { deliveryId: id, ...details }
    });
  }

  async logDocumentUpload(id: string, fileName: string): Promise<void> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    await this.auditLog.log({
      action: AuditAction.EPI_DELIVERY_DOCUMENT_UPLOADED,
      appVersion: '',
      osVersion: '',
      user_profile: user?.profile || 'UNKNOWN',
      userEmail: user?.email ?? '',
      userId: uid,
      details: { deliveryId: id, fileName }
    });
  }

  async logDownloadTerm(id: string): Promise<void> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    await this.auditLog.log({
      action: AuditAction.EPI_DELIVERY_TERM_DOWNLOADED,
      appVersion: '',
      osVersion: '',
      user_profile: user?.profile || 'UNKNOWN',
      userEmail: user?.email ?? '',
      userId: uid,
      details: { deliveryId: id }
    });
  }
}
