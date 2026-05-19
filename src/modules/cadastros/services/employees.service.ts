import { Injectable } from '@angular/core';
import { EmployeesRepository } from '../repositories/employees.repository';
import { Employee } from '../models/employee.model';
import { AuditUser } from '../models/company.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { CompaniesRepository } from '../repositories/companies.repository';
import { UnitsRepository } from '../repositories/units.repository';
import { CargosRepository } from '../repositories/cargos.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`; }

@Injectable({ providedIn: 'root' })
export class EmployeesService {
  constructor(
    private readonly repo: EmployeesRepository,
    private readonly session: SessionService,
    private readonly usersRepo: UsersRepository,
    private readonly companiesRepo: CompaniesRepository,
    private readonly unitsRepo: UnitsRepository,
    private readonly cargosRepo: CargosRepository,
    private readonly auditLog: AuditLogService
  ) {}

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }

  private isAdmin(): boolean {
    return this.session.hasRole(['ADMIN'] as any);
  }

  private getLoggedCompanyId(): string {
    const u = (this.session as any).user?.();
    return u?.companyId ?? '';
  }

  async createEmployee(input: Partial<Employee>): Promise<string> {
    // Force company for CLIENTE
    if (!this.isAdmin()) {
      (input as any).companyId = this.getLoggedCompanyId();
    }

    // validate required fields
    if (!input.companyId) throw new Error('companyId is required');
    if (!input.unitId) throw new Error('unitId is required');
    if (!input.sectorId) throw new Error('sectorId is required');
    if (!input.name) throw new Error('name is required');
    if (!input.cargoId) throw new Error('cargoId is required');

    // new required fields
    if (!input.esocialRegistration) throw new Error('esocialRegistration is required');
    if (!input.esocialCategory) throw new Error('esocialCategory is required');
    if (!input.admissionDate) throw new Error('admissionDate is required');

    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const createdBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `emp_${makeId()}`;

    const doc: Employee = {
      id,
      companyId: (this.isAdmin() ? (input.companyId ?? '') : (this.getLoggedCompanyId() || ''))!,
      unitId: input.unitId!,
      sectorId: input.sectorId!,
      name: input.name!,
      socialName: input.socialName ?? '',
      rg: input.rg ?? '',
      rgIssuingAgency: input.rgIssuingAgency ?? '',
      cpf: input.cpf ?? '',
      cargoId: input.cargoId!,
      cargoName: input.cargoName ?? (input as any)['cargoName'] ?? '',
      cargoCbo: input.cargoCbo ?? (input as any)['cargoCbo'] ?? '',

      // new fields
      esocialRegistration: input.esocialRegistration!,
      esocialCategory: input.esocialCategory!,
      admissionDate: input.admissionDate!,
      birthDate: input.birthDate ?? '',
      nisPis: input.nisPis ?? '',
      gender: input.gender ?? '',
      fatherName: input.fatherName ?? '',
      motherName: input.motherName ?? '',
      jobDescription: input.jobDescription ?? '',

      // endereço
      addressStreet: input.addressStreet ?? '',
      addressNumber: input.addressNumber ?? '',
      addressComplement: input.addressComplement ?? '',
      addressZipCode: input.addressZipCode ?? '',
      addressUf: input.addressUf ?? '',
      addressCity: input.addressCity ?? '',

      // optionals (avoid undefined to keep Firestore happy)
      phone: input.phone ?? '',
      email: input.email ?? '',
      notes: input.notes ?? '',

      status: input.status ?? 'ativo',
      createdAt: now,
      updatedAt: now,
      createdBy,
    } as Employee;

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.EMPLOYEE_CREATE_ERROR, createError, { name: doc.name, companyId: doc.companyId });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.EMPLOYEE_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: createdBy.email,
        userId: createdBy.uid,
        details: { employeeId: id, name: doc.name, companyId: doc.companyId }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async updateEmployee(id: string, patch: Partial<Employee>) {
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();

    // CLIENTE: não permitir trocar companyId e sempre garantir companyId do logado
    if (!this.isAdmin()) {
      delete (patch as any).companyId;
      (patch as any).companyId = this.getLoggedCompanyId();
    }

    // Avoid sending undefined to Firestore
    const safePatch: any = { ...patch, updatedAt: now, updatedBy };
    Object.keys(safePatch).forEach((k) => safePatch[k] === undefined && delete safePatch[k]);

    try {
      await this.repo.updateEmployee(id, safePatch);
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.EMPLOYEE_UPDATE_ERROR, updateError, { employeeId: id, patch: safePatch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.EMPLOYEE_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { employeeId: id, patch: safePatch }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, ativo: boolean) {
    // Reuse update flow to persist updatedAt/updatedBy metadata
    await this.updateEmployee(id, { status: ativo ? 'ativo' : 'inativo' });
  }

  async listEmployeesPaged(term: string, pageSize: number, startAfterDoc?: any) {
    if (!this.isAdmin()) {
      const cid = this.getLoggedCompanyId() || null;
      return this.repo.listByNamePaged(cid, term, pageSize, startAfterDoc);
    }
    const scoped = (this.session as any).adminScopeCompanyId?.() ?? null;
    return this.repo.listByNamePaged(scoped, term, pageSize, startAfterDoc);
  }

  async getEmployee(id: string) {
    const employee = await this.repo.getById(id);

    if (employee) {
      try {
        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        await this.auditLog.log({
          action: AuditAction.EMPLOYEE_VIEWED,
          appVersion: '',
          osVersion: '',
          user_profile: user?.profile || 'UNKNOWN',
          userEmail: user?.email ?? '',
          userId: uid,
          details: { employeeId: id, name: employee.name }
        });
      } catch (e) { console.error('Audit error:', e); }
    }

    return employee;
  }

  async listByFilters(filters: { companyId?: string; unitId?: string; cargoId?: string; status?: string }) {
    return this.repo.listByFilters(filters);
  }

  // Aggregated search by employee name, company name, unit name, and cargo (name or CBO)
  async searchAggregated(term: string, max = 300): Promise<Employee[]> {
    const t = (term || '').trim();
    if (!t) return [];

    // Parallel queries
    const [byName, byCargoName, byCargoCbo, companiesRes, unitsRes, cargos] = await Promise.all([
      this.repo.listByFieldPrefix('name', t, Math.min(80, max)),
      this.repo.listByFieldPrefix('cargoName', t, Math.min(80, max)),
      this.repo.listByFieldPrefix('cargoCbo', t, Math.min(80, max)),
      this.companiesRepo.listByNamePaged(t, 20),
      this.unitsRepo.listByNamePaged(
        (this.isAdmin() ? ((this.session as any).adminScopeCompanyId?.() ?? null) : (this.getLoggedCompanyId() || null)),
        t,
        20
      ),
      this.cargosRepo.searchByNameOrCbo(t, 20),
    ]);

    const resultMap = new Map<string, Employee>();
    const addAll = (arr: Employee[]) => { for (const e of arr) { if (!resultMap.has(e.id)) resultMap.set(e.id, e); if (resultMap.size >= max) break; } };

    addAll(byName);
    addAll(byCargoName);
    addAll(byCargoCbo);

    // From companies
    const companyIds: string[] = Array.isArray(companiesRes?.docs) ? companiesRes.docs.map((c: any) => c.id).slice(0, 10) : [];
    for (const cid of companyIds) {
      if (resultMap.size >= max) break;
      const list = await this.repo.listByFieldEquals('companyId', cid, 100);
      addAll(list);
      if (resultMap.size >= max) break;
    }

    // From units
    const unitIds: string[] = Array.isArray(unitsRes?.docs) ? unitsRes.docs.map((u: any) => u.id).slice(0, 10) : [];
    for (const uid of unitIds) {
      if (resultMap.size >= max) break;
      const list = await this.repo.listByFieldEquals('unitId', uid, 100);
      addAll(list);
      if (resultMap.size >= max) break;
    }

    // From cargos by id
    const cargoIds: string[] = Array.isArray(cargos) ? cargos.map((cg: any) => cg.id).slice(0, 10) : [];
    for (const cargoId of cargoIds) {
      if (resultMap.size >= max) break;
      const list = await this.repo.listByFieldEquals('cargoId', cargoId, 100);
      addAll(list);
      if (resultMap.size >= max) break;
    }

    return Array.from(resultMap.values()).slice(0, max);
  }
}
