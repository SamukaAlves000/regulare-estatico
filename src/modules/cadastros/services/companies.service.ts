import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { CompaniesRepository } from '../repositories/companies.repository';
import { Company, AuditUser, CompanyCnae } from '../models/company.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';
import { initializeApp as firebaseInitApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getAuth as getFirebaseAuth, createUserWithEmailAndPassword as firebaseCreateUser, deleteUser as firebaseDeleteUser } from 'firebase/auth';
import { environment } from '../../../environments/environment';

// Default temporary password used when not provided in the form
export const DEFAULT_PASSWORD = '@Sysmvn2026';

// lightweight id generator to avoid extra dependency
function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCnae(input: any): CompanyCnae {
  if (!input) return { id: '', descricao: '', observacoes: [] };
  if (typeof input === 'string') {
    // legacy: was a text field
    return { id: input, descricao: input, observacoes: [] };
  }
  return {
    id: String(input.id ?? ''),
    descricao: String(input.descricao ?? input.description ?? ''),
    observacoes: Array.isArray(input.observacoes) ? input.observacoes : [],
  };
}

function normalizeCnaeArray(input: any): CompanyCnae[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(normalizeCnae).filter((c) => !!(c.id || c.descricao));
  // legacy: string[] from textarea (one per line)
  if (typeof input === 'string') {
    return input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ id: s, descricao: s, observacoes: [] }));
  }
  return [];
}

@Injectable({ providedIn: 'root' })
export class CompaniesService {
  private readonly companyCreatedSource = new Subject<void>();
  companyCreated$ = this.companyCreatedSource.asObservable();

  constructor(
    private readonly repo: CompaniesRepository,
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

  /**
   * Retorna o companyId do escopo selecionado pelo ADMIN no topbar.
   * Se ADMIN não selecionou nenhuma empresa específica, retorna null (todas).
   * Se for CLIENTE, retorna o companyId do usuário logado.
   */
  private getScopedCompanyId(): string | null {
    if (this.isAdmin()) {
      // Verifica se ADMIN selecionou uma empresa específica no topbar
      const scopedId = this.session.adminScopeCompanyId();
      return scopedId || null; // null = todas as empresas
    }
    // CLIENTE: sempre retorna a empresa vinculada
    return this.getLoggedCompanyId() || null;
  }

  /**
   * Create company and a CLIENTE user in Firebase Auth + /users in a safe, rollback-capable flow.
   */
    async createCompanyWithClientUser(input: Partial<Company> & { email: string; password?: string }): Promise<string> {
        // CLIENTE não pode criar empresas
        if (!this.isAdmin()) {
            throw new Error('Apenas ADMIN pode criar novas empresas.');
        }

        if (!input.email) throw new Error('Email obrigatório para criar usuário CLIENTE');

        const now = new Date().toISOString();
        const id = `comp_${makeId()}`;

        const loggedUid = this.getUid();
        const loggedUser = await this.usersRepo.get(loggedUid);
        const createdBy: AuditUser = { uid: loggedUid, name: loggedUser?.name ?? '', email: loggedUser?.email ?? '', profile: loggedUser?.profile };

        const company: Company = {
            id,
            status: 'ativo',
            email: input.email,
            createdAt: now,
            updatedAt: now,
            createdBy,

            // New required fields
            razaoSocial: input.razaoSocial ?? input.name ?? '',
            nomeFantasia: input.nomeFantasia ?? '',
            personType: (input.personType as any) ?? 'PJ',
            document: input.document ?? input.cnpj ?? '',
            caepf: input.caepf ?? '',
            cno: input.cno ?? '',
            legalResponsibleName: input.legalResponsibleName ?? '',
            legalResponsibleCpf: input.legalResponsibleCpf ?? '',
            addressStreet: input.addressStreet ?? '',
            addressNumber: input.addressNumber ?? '',
            addressComplement: input.addressComplement ?? '',
            addressZipCode: input.addressZipCode ?? '',
            addressUf: input.addressUf ?? '',
            addressCity: input.addressCity ?? '',
            latitude: input.latitude ?? '',
            longitude: input.longitude ?? '',
            companyType: (input.companyType as any) ?? 'Outro',
            cnaeMain: normalizeCnae((input as any).cnaeMain),
            cnaeSecondary: normalizeCnaeArray((input as any).cnaeSecondary),
            workEnvironmentDescription: input.workEnvironmentDescription ?? '',
            institutionalEmail: input.institutionalEmail ?? input.email,
            phoneWhatsapp: input.phoneWhatsapp ?? '',
            notes: input.notes,

            // Legacy fields
            name: input.name ?? input.razaoSocial ?? '',
            cnpj: input.cnpj ?? input.document ?? '',
        };

    // Create Auth user using a temporary secondary app to avoid touching current session
    const tempAppName = `temp-${makeId()}`;
    let tempApp: FirebaseApp | null = null;
    let createdUserUid: string | null = null;

    try {
      tempApp = firebaseInitApp(environment.firebase as any, tempAppName);
      const tempAuth = getFirebaseAuth(tempApp);
      const password = input.password && input.password.trim().length > 0 ? input.password : DEFAULT_PASSWORD;
      const cred = await firebaseCreateUser(tempAuth, input.email, password);
      createdUserUid = cred.user.uid;

      // Persist user document in /users
      const userDoc = {
        id: createdUserUid,
        name: company.razaoSocial || company.name || '',
        email: input.email,
        profile: 'CLIENTE' as const,
        companyId: id,
        status: 'ATIVO' as const,
        createdAt: now,
        createdBy: loggedUid,
      };

    try {
      await this.usersRepo.set(userDoc as any);
      // Persist company document
      await this.repo.create(company);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_CLIENT_CREATE_ERROR, createError, { companyName: company.razaoSocial, clientEmail: input.email });
      throw createError;
    }

    try {
        await this.auditLog.log({
          action: AuditAction.COMPANY_CLIENT_CREATED,
          appVersion: '',
          osVersion: '',
          user_profile: loggedUser?.profile || 'UNKNOWN',
          userEmail: loggedUser?.email ?? '',
          userId: loggedUid,
          details: { companyId: id, companyName: company.razaoSocial, clientUserEmail: input.email }
        });
      } catch (e) { console.error('Audit error:', e); }

      this.companyCreatedSource.next();

      return id;
    } catch (err) {
      // Rollback: if user created in Auth, try to delete it
      try {
        if (createdUserUid && tempApp) {
          const tempAuth = getFirebaseAuth(tempApp);
          const u = tempAuth.currentUser;
          if (u) {
            await firebaseDeleteUser(u);
          }
        }
      } catch (e) {
        console.error('Rollback failure deleting auth user', e);
      }
      throw err;
    } finally {
      if (tempApp) {
        try {
          await deleteApp(tempApp);
        } catch {
          // ignore
        }
      }
    }
  }

    async createCompany(input: Partial<Company>): Promise<string> {
        if (!this.isAdmin()) {
            throw new Error('Apenas ADMIN pode criar novas empresas.');
        }

        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        const audit: AuditUser = {uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile};
        const now = new Date().toISOString();
        const id = `comp_${makeId()}`;

        const doc: Company = {
            id,
            status: 'ativo',
            email: input.email ?? '',
            createdAt: now,
            updatedAt: now,
            createdBy: audit,

            razaoSocial: input.razaoSocial ?? input.name ?? '',
            nomeFantasia: input.nomeFantasia ?? '',
            personType: (input.personType as any) ?? 'PJ',
            document: input.document ?? input.cnpj ?? '',
            caepf: input.caepf ?? '',
            cno: input.cno ?? '',
            legalResponsibleName: input.legalResponsibleName ?? '',
            legalResponsibleCpf: input.legalResponsibleCpf ?? '',
            addressStreet: input.addressStreet ?? '',
            addressNumber: input.addressNumber ?? '',
            addressComplement: input.addressComplement ?? '',
            addressZipCode: input.addressZipCode ?? '',
            addressUf: input.addressUf ?? '',
            addressCity: input.addressCity ?? '',
            latitude: input.latitude ?? '',
            longitude: input.longitude ?? '',
            companyType: (input.companyType as any) ?? 'Outro',
            cnaeMain: normalizeCnae((input as any).cnaeMain),
            cnaeSecondary: normalizeCnaeArray((input as any).cnaeSecondary),
            workEnvironmentDescription: input.workEnvironmentDescription ?? '',
            institutionalEmail: input.institutionalEmail ?? input.email ?? '',
            phoneWhatsapp: input.phoneWhatsapp ?? '',
            notes: input.notes,

            name: input.name ?? input.razaoSocial ?? '',
            cnpj: input.cnpj ?? input.document ?? '',
        };

    try {
      await this.repo.create(doc);
    } catch (createError) {
      await this.auditLog.logError(AuditAction.COMPANY_CREATE_ERROR, createError, { companyName: doc.razaoSocial });
      throw createError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: audit.email,
        userId: audit.uid,
        details: { companyId: id, companyName: doc.razaoSocial }
      });
    } catch (e) { console.error('Audit error:', e); }

    this.companyCreatedSource.next();
    return id;
  }

  async updateCompany(id: string, patch: Partial<Company>): Promise<void> {
    // CLIENTE só pode editar a própria empresa
    if (!this.isAdmin()) {
      const myCompanyId = this.getLoggedCompanyId();
      if (!myCompanyId || id !== myCompanyId) {
        throw new Error('Sem permissão para editar esta empresa.');
      }
    }

    const now = new Date().toISOString();
    const uid = this.getUid();
    const user = await this.usersRepo.get(uid);
    const updatedBy: AuditUser = { uid, name: user?.name ?? '', email: user?.email ?? '', profile: user?.profile };

    const safePatch: Partial<Company> = {
      ...patch,
      updatedAt: now,
      updatedBy,
    };

    // Normalize CNAE patches, because dialog returns structured objects
    if ((safePatch as any).cnaeMain) {
      (safePatch as any).cnaeMain = normalizeCnae((safePatch as any).cnaeMain);
    }
    if ((safePatch as any).cnaeSecondary) {
      (safePatch as any).cnaeSecondary = normalizeCnaeArray((safePatch as any).cnaeSecondary);
    }

    // Keep legacy fields in sync when new fields are changed
    if (safePatch.razaoSocial && !safePatch.name) safePatch.name = safePatch.razaoSocial;
    if (safePatch.document && !safePatch.cnpj) safePatch.cnpj = safePatch.document;

    try {
      await this.repo.updateCompany(id, safePatch);
    } catch (updateError) {
      await this.auditLog.logError(AuditAction.COMPANY_UPDATE_ERROR, updateError, { companyId: id, patch: safePatch });
      throw updateError;
    }

    try {
      await this.auditLog.log({
        action: AuditAction.COMPANY_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: user?.profile || 'UNKNOWN',
        userEmail: updatedBy.email,
        userId: updatedBy.uid,
        details: { companyId: id, patch: safePatch }
      });
    } catch (e) { console.error('Audit error:', e); }

    this.companyCreatedSource.next();
  }

  async setActive(id: string, ativo: boolean): Promise<void> {
    // Apenas ADMIN pode ativar/inativar empresa
    if (!this.isAdmin()) {
      throw new Error('Apenas ADMIN pode ativar/inativar empresas.');
    }
    try {
      await this.repo.updateCompany(id, { status: ativo ? 'ativo' : 'inativo' });
    } catch (statusError) {
      await this.auditLog.logError(AuditAction.COMPANY_STATUS_ERROR, statusError, { companyId: id, status: ativo ? 'ativo' : 'inativo' });
      throw statusError;
    }

    try {
      const uid = this.getUid();
      const user = await this.usersRepo.get(uid);
      await this.auditLog.log({
        action: AuditAction.COMPANY_STATUS_CHANGED,
        appVersion: '',
        osVersion: '',
        user_profile: (user as any)?.profile || 'UNKNOWN',
        userEmail: user?.email ?? '',
        userId: uid,
        details: { companyId: id, status: ativo ? 'ativo' : 'inativo' }
      });
    } catch (e) { console.error('Audit error:', e); }

    this.companyCreatedSource.next();
  }

  async listCompaniesPaged(term: string, pageSize: number, startAfterDoc?: any) {
    // Obtém o escopo de empresa (ADMIN com seleção ou CLIENTE)
    const scopedCompanyId = this.getScopedCompanyId();

    // Se há um escopo definido (ADMIN selecionou empresa OU é CLIENTE), listar apenas essa empresa
    if (scopedCompanyId) {
      const c = await this.repo.getById(scopedCompanyId);
      // Aplicar filtro de termo se houver
      if (c && term) {
        const t = term.toLowerCase();
        const matchName = (c.name || '').toLowerCase().includes(t);
        const matchRazao = (c.razaoSocial || '').toLowerCase().includes(t);
        const matchFantasia = (c.nomeFantasia || '').toLowerCase().includes(t);
        if (!matchName && !matchRazao && !matchFantasia) {
          return { docs: [], lastDoc: null };
        }
      }
      return { docs: c ? [c] : [], lastDoc: null };
    }

    // ADMIN sem escopo específico: listar todas
    return this.repo.listByNamePaged(term, pageSize, startAfterDoc);
  }

  async listCompanies(): Promise<Company[]> {
    const scopedCompanyId = this.getScopedCompanyId();

    // Se há um escopo definido, listar apenas essa empresa
    if (scopedCompanyId) {
      const c = await this.repo.getById(scopedCompanyId);
      return c ? [c] : [];
    }

    // ADMIN sem escopo: listar todas
    return this.repo.listAll();
  }

  async getCompany(id: string): Promise<Company | null> {
    if (!this.isAdmin()) {
      const myCompanyId = this.getLoggedCompanyId();
      if (!myCompanyId || id !== myCompanyId) return null;
    }
    const company = await this.repo.getById(id);

    if (company) {
      try {
        const uid = this.getUid();
        const user = await this.usersRepo.get(uid);
        await this.auditLog.log({
          action: 'company_viewed',
          appVersion: '',
          osVersion: '',
          user_profile: (user as any)?.profile || 'UNKNOWN',
          userEmail: user?.email ?? '',
          userId: uid,
          details: { companyId: id, companyName: company.razaoSocial }
        });
      } catch (e) { console.error('Audit error:', e); }
    }

    return company;
  }

  private getUid(): string {
    const u = (this.session as any).user?.();
    return u?.id ?? '';
  }
}
