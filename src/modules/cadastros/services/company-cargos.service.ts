import { Injectable, inject } from '@angular/core';
import { CompanyCargosRepository } from '../repositories/company-cargos.repository';
import { CargosRepository } from '../repositories/cargos.repository';
import { CompanyCargo, Cargo } from '../models/cargo.model';
import { AuditUser } from '../models/company.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }

@Injectable({ providedIn: 'root' })
export class CompanyCargosService {
  private readonly repo = inject(CompanyCargosRepository);
  private readonly genericRepo = inject(CargosRepository);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly auditLog = inject(AuditLogService);

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  async createFromGeneric(companyId: string, genericCargo: Cargo): Promise<string> {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `ccargo_${makeId()}`;

    const doc: CompanyCargo = {
      ...genericCargo,
      id,
      companyId,
      sourceCargoId: genericCargo.id,
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,
      status: 'ativo'
    };

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_CARGO_LINK_ERROR, createError, { companyId, genericCargoId: genericCargo.id });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_CARGO_LINKED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { companyId, companyCargoId: id, genericCargoId: genericCargo.id, cargoName: genericCargo.name }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async listByCompany(companyId: string): Promise<CompanyCargo[]> {
    return this.repo.listByCompany(companyId);
  }

  async updateCargo(id: string, patch: Partial<CompanyCargo>): Promise<void> {
    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    
    try {
      await this.repo.updateCargo(id, { ...patch, updatedAt: now, updatedBy });
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.COMPANY_CARGO_UPDATE_ERROR, updateError, { companyCargoId: id, patch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_CARGO_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { companyCargoId: id, patch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async deleteCargo(id: string): Promise<void> {
    try {
      await this.repo.deleteCargo(id);
    } catch (deleteError) {
      await this.auditLog.logError(AuditAction.COMPANY_CARGO_DELETE_ERROR, deleteError, { companyCargoId: id });
      throw deleteError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.COMPANY_CARGO_DELETED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { companyCargoId: id }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async searchCargos(companyId: string, term: string): Promise<CompanyCargo[]> {
    return this.repo.searchByCompany(companyId, term);
  }

  /**
   * Obtém cargos para um contexto de empresa.
   * Se a empresa tiver cargos vinculados, retorna esses.
   * Caso contrário, retorna os cargos genéricos.
   */
  async getCargosForContext(companyId: string, term: string): Promise<any[]> {
    const companyCargos = await this.repo.searchByCompany(companyId, term);
    if (companyCargos.length > 0) {
      return companyCargos;
    }
    // Se não houver cargos vinculados à empresa que correspondam ao termo, 
    // verificamos se a empresa possui QUALQUER cargo vinculado.
    // Se possuir, retornamos apenas os da empresa (mesmo que vazios para o termo).
    // Mas a regra diz: "Se houver cargos vinculados à empresa -> usar esses. Caso contrário -> usar cargos genéricos."
    
    const allCompanyCargos = await this.repo.listByCompany(companyId, 1);
    if (allCompanyCargos.length > 0) {
      return companyCargos; // Retorna o que filtrou (pode ser vazio se o termo não bater)
    }

    // Se a empresa não tem NENHUM cargo vinculado, usa os genéricos
    return this.genericRepo.searchByNameOrCbo(term, 20);
  }
}
