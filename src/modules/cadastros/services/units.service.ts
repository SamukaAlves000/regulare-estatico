import { Injectable } from '@angular/core';
import { UnitsRepository } from '../repositories/units.repository';
import { Unit } from '../models/unit.model';
import { AuditUser, CompanyCnae } from '../models/company.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

// lightweight id generator to avoid extra dependency
function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCnae(input: any): CompanyCnae {
  if (!input) return { id: '', descricao: '', observacoes: [] } as CompanyCnae;
  if (typeof input === 'string') return { id: input, descricao: input, observacoes: [] } as CompanyCnae;
  return {
    id: String(input.id ?? ''),
    descricao: String(input.descricao ?? input.description ?? ''),
    observacoes: Array.isArray(input.observacoes) ? input.observacoes : [],
  } as CompanyCnae;
}

function normalizeCnaeArray(input: any): CompanyCnae[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(normalizeCnae).filter((c) => !!(c.id || c.descricao));
  if (typeof input === 'string') {
    return input
      .split(/\r?\n|,/) // suporta separado por linha ou vírgula
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ id: s, descricao: s, observacoes: [] } as CompanyCnae));
  }
  return [];
}

@Injectable({ providedIn: 'root' })
export class UnitsService {
  constructor(
    private readonly repo: UnitsRepository,
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

  async createUnit(input: Partial<Unit>): Promise<string> {
    const loggedCompanyId = this.getLoggedCompanyId();
    // CLIENTE: sempre persistir companyId do usuário logado
    if (!this.isAdmin()) {
      (input as any).companyId = loggedCompanyId;
    }

    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const audit: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };
    const now = new Date().toISOString();
    const id = `unit_${makeId()}`;

    const street = input.address?.street ?? (input as any).street ?? '';
    const number = input.address?.number ?? (input as any).addressNumber ?? '';
    const complement = input.address?.complement ?? (input as any).complement ?? null;
    const zipCode = input.address?.zipCode ?? (input as any).zipCode ?? null;
    const city = input.address?.city ?? (input as any).city ?? '';
    const state = input.address?.state ?? (input as any).state ?? '';
    const latRaw = input.address?.latitude ?? (input as any).latitude ?? null;
    const lngRaw = input.address?.longitude ?? (input as any).longitude ?? null;
    const latitude = (latRaw !== null && latRaw !== undefined && String(latRaw).trim() !== '') ? String(latRaw) : null;
    const longitude = (lngRaw !== null && lngRaw !== undefined && String(lngRaw).trim() !== '') ? String(lngRaw) : null;

    const email = (input as any).email;
    const phone = (input as any).phone;

    const doc: Unit = {
      id,
      companyId: (this.isAdmin() ? (input.companyId ?? '') : (loggedCompanyId ?? '')),
      name: input.name ?? '',

      documentType: (input.documentType ?? 'CNPJ') as any,
      documentNumber: input.documentNumber ?? '',

      // Persist structured CNAE objects
      cnaeMain: normalizeCnae((input as any).cnaeMain),
      cnaeSecondary: normalizeCnaeArray((input as any).cnaeSecondary),

      address: {
        street,
        number,
        complement,
        zipCode,
        city,
        state,
        latitude,
        longitude,
      },

      workEnvironmentDescription: input.workEnvironmentDescription ?? '',
      email: email ? email : (undefined as any),
      phone: phone ? phone : (undefined as any),

      status: (input.status ?? 'active') as any,
      notes: input.notes ?? '',

      createdAt: now,
      updatedAt: now,
      createdBy: audit,
      updatedBy: audit,

      // backward compatibility
      city,
      state,
      latitude,
      longitude,
    } as any;

    // Remove campos undefined (Firestore não aceita)
    Object.keys(doc as any).forEach((k) => ((doc as any)[k] === undefined ? delete (doc as any)[k] : null));

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.UNIT_CREATE_ERROR, createError, { name: doc.name, companyId: doc.companyId });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.UNIT_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { unitId: id, name: doc.name, companyId: doc.companyId }
      });
    } catch (e) { console.error('Audit error:', e); }

    return id;
  }

  async updateUnit(id: string, patch: Partial<Unit>): Promise<void> {
    const loggedCompanyId = this.getLoggedCompanyId();

    // CLIENTE: não permite alterar companyId e sempre persistir o companyId do usuário
    if (!this.isAdmin()) {
      delete (patch as any).companyId;
      (patch as any).companyId = loggedCompanyId;
    }

    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };

    // Normaliza address/city/state para manter compatibilidade
    const city = patch.address?.city ?? (patch as any).city;
    const state = patch.address?.state ?? (patch as any).state;

    const normalized: Partial<Unit> = {
      ...patch,
      // normalize CNAEs if present in patch
      ...(patch as any).cnaeMain !== undefined ? { cnaeMain: normalizeCnae((patch as any).cnaeMain) } : {},
      ...(patch as any).cnaeSecondary !== undefined ? { cnaeSecondary: normalizeCnaeArray((patch as any).cnaeSecondary) } : {},
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(patch.address || city || state
        ? {
            address: {
              street: patch.address?.street ?? (patch as any).street ?? '',
              number: patch.address?.number ?? (patch as any).addressNumber ?? '',
              city: city ?? '',
              state: state ?? '',
            },
          }
        : {}),
      updatedAt: now,
      updatedBy,
    } as any;

    // Do not allow overwriting createdBy/createdAt
    delete (normalized as any).createdAt;
    delete (normalized as any).createdBy;

    // Remove campos undefined (Firestore não aceita)
    Object.keys(normalized as any).forEach((k) => ((normalized as any)[k] === undefined ? delete (normalized as any)[k] : null));

    try {
      await this.repo.updateUnit(id, normalized as Partial<Unit>);
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.UNIT_UPDATE_ERROR, updateError, { unitId: id, patch: normalized });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.UNIT_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { unitId: id, patch: normalized }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async setActive(id: string, ativo: boolean): Promise<void> {
    try {
      await this.repo.updateUnit(id, { status: ativo ? 'active' : 'inactive' } as any);
    } catch (statusError) {
      await this.auditLog.logError(AuditAction.UNIT_STATUS_ERROR, statusError, { unitId: id, status: ativo ? 'active' : 'inactive' });
      throw statusError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.UNIT_STATUS_CHANGED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { unitId: id, status: ativo ? 'active' : 'inactive' }
      });
    } catch (e) { console.error('Audit error:', e); }
  }

  async listByEmpresa(empresaId: string): Promise<Unit[]> {
    if (!empresaId) return this.repo.listAll();
    return this.repo.listBy('companyId' as any, empresaId, 200);
  }

  async getUnit(id: string) {
    const unit = await this.repo.getById(id);

    if (unit) {
      try {
        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        await this.auditLog.log({
          action: 'unit_viewed',
          appVersion: '',
          osVersion: '',
          user_profile: (user as any)?.profile || 'UNKNOWN',
          userEmail: user?.email ?? '',
          userId: uid,
          details: { unitId: id, name: unit.name }
        });
      } catch (e) { console.error('Audit error:', e); }
    }

    return unit;
  }

  async listUnitsPaged(term: string, pageSize: number, startAfterDoc?: any) {
    // CLIENTE: filtrar por companyId no backend e bloquear quando não houver vínculo
    if (!this.isAdmin()) {
      const cid = this.getLoggedCompanyId();
      if (!cid) {
        // Sem empresa vinculada: não listar nada para CLIENTE
        return { docs: [], lastDoc: null } as any;
      }
      return this.repo.listByNamePaged(cid as any, term, pageSize, startAfterDoc);
    }
    // ADMIN: se houver escopo selecionado, aplica; senão, todas
    const scoped = (this.session as any).adminScopeCompanyId?.() ?? null;
    return this.repo.listByNamePaged((scoped || null) as any, term, pageSize, startAfterDoc);
  }

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }
}
