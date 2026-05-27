import { Injectable } from '@angular/core';
import { CargosRepository } from '../repositories/cargos.repository';
import { EmployeesRepository } from '../repositories/employees.repository';
import { Cargo } from '../models/cargo.model';
import { AuditUser } from '../models/company.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';

import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';
import { firstValueFrom } from 'rxjs';

function makeId(prefix = '') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }

@Injectable({ providedIn: 'root' })
export class CargosService {
  constructor(
    private readonly repo: CargosRepository,
    private readonly session: SessionService,
    private readonly usersRepo: UsersRepository,
    private readonly employeesRepo: EmployeesRepository,
    private readonly auditLog: AuditLogService
  ) {}

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  isAdmin(): boolean {
    return this.session.hasRole(['ADMIN'] as any);
  }

  private getLoggedCompanyId(): string {
    const u = (this.session as any).user?.();
    return u?.companyId ?? '';
  }

  /** Verifica se o usuário é CLIENTE (somente visualização de cargos) */
  isCliente(): boolean {
    return this.session.hasRole(['CLIENTE'] as any);
  }

  /** Retorna o companyId selecionado pelo ADMIN (ou null se visão geral) */
  getAdminScopeCompanyId(): string | null {
    return this.session.adminScopeCompanyId();
  }

  /** Verifica se ADMIN tem uma empresa selecionada (não está na visão geral) */
  hasAdminScopeCompany(): boolean {
    return this.isAdmin() && !!this.session.adminScopeCompanyId();
  }

  /** Lista cargos para CLIENTE - baseado nos funcionários da empresa */
  async listCargosForCliente(): Promise<Cargo[]> {
    const companyId = this.getLoggedCompanyId();
    return this.listCargosByCompanyEmployees(companyId);
  }

  /** Lista cargos para ADMIN com empresa selecionada - baseado nos funcionários */
  async listCargosForAdminScope(): Promise<Cargo[]> {
    const companyId = this.session.adminScopeCompanyId();
    if (!companyId) return [];
    return this.listCargosByCompanyEmployees(companyId);
  }

  /** Método interno para listar cargos baseado nos funcionários de uma empresa */
  private async listCargosByCompanyEmployees(companyId: string | null): Promise<Cargo[]> {
    if (!companyId) return [];

    // 1. Buscar todos os funcionários da empresa
    const employees = await this.employeesRepo.listByCompanyId(companyId);

    // 2. Extrair CBOs únicos dos funcionários
    const uniqueCbos = [...new Set(employees.map(e => e.cargoCbo).filter(cbo => !!cbo))];

    if (uniqueCbos.length === 0) return [];

    // 3. Buscar cargos correspondentes aos CBOs
    const cargos = await this.repo.listByCboList(uniqueCbos);

    return cargos;
  }

  async createCargo(input: Partial<Cargo>): Promise<string> {
    // validate unique CBO
    if (!input.cbo) throw new Error('CBO é obrigatório');
    // const exists = await this.repo.findByCbo(input.cbo);
    // if (exists) throw new Error('Já existe um cargo cadastrado com este CBO.');

    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `cargo_${makeId()}`;
    const doc: Cargo = {
      id,
      name: input.name ?? '',
      cbo: input.cbo ?? '',
      gfip: input.gfip ?? '',
      description: input.description ?? '',
      notes: input.notes ?? '',
      riskIds: input.riskIds ?? [],
      epiIds: input.epiIds ?? [],
      status: input.status ?? 'ativo',
      createdAt: now,
      updatedAt: now,
      createdBy: audit,
    } as Cargo;
    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.CARGO_CREATE_ERROR, createError, { name: doc.name, cbo: doc.cbo });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.CARGO_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: audit.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { cargoId: id, name: doc.name, cbo: doc.cbo }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async updateCargo(id: string, patch: Partial<Cargo>): Promise<void> {
    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    try {
      await this.repo.updateCargo(id, { ...patch, updatedAt: now, updatedBy } as Partial<Cargo>);
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.CARGO_UPDATE_ERROR, updateError, { cargoId: id, patch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.CARGO_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: updatedBy.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { cargoId: id, patch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, ativo: boolean) {
    try {
      await this.repo.updateCargo(id, { status: ativo ? 'ativo' : 'inativo' });
    } catch (statusError) {
      await this.auditLog.logError(AuditAction.CARGO_STATUS_ERROR, statusError, { cargoId: id, status: ativo ? 'ativo' : 'inativo' });
      throw statusError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.CARGO_STATUS_CHANGED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { cargoId: id, status: ativo ? 'ativo' : 'inativo' }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async listCargosPaged(term: string, pageSize: number, startAfterDoc?: any) {
    return this.repo.listByNamePaged(term, pageSize, startAfterDoc);
  }

  async getCargo(id: string) {
    const cargo = await this.repo.getById(id);

    if (cargo) {
      try {
        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        await this.auditLog.log({
          action: 'cargo_viewed',
          appVersion: '',
          osVersion: '',
          user_profile: (user as any)?.profile || 'UNKNOWN',
          userEmail: user?.email ?? '',
          userId: uid,
          details: { cargoId: id, name: cargo.name }
        });
      } catch (e) { console.error('Audit error:', e); }
    }

    return cargo;
  }
}
