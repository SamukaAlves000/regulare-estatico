import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs, limit, startAfter, doc, updateDoc } from '@angular/fire/firestore';
import { Auth, sendPasswordResetEmail, ActionCodeSettings } from '@angular/fire/auth';
import { initializeApp as firebaseInitApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getAuth as getFirebaseAuth, createUserWithEmailAndPassword as firebaseCreateUser } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { User, UserProfile, UserStatus } from '../../../core/models/user.model';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';
import { SessionService } from '../../../core/services/session.service';
import { EmailService } from '../../../core/services/email.service';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly firestore = inject(Firestore);
  private readonly usersRepo = inject(UsersRepository);
  private readonly auditLog = inject(AuditLogService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(Auth);
  private readonly emailService = inject(EmailService);
  private readonly companiesRepo = inject(CompaniesRepository);

  private readonly collectionName = 'users';

  async listUsers(filters: { name?: string, email?: string, companyId?: string }, pageSize = 50, lastDoc?: any) {
    const usersCol = collection(this.firestore, this.collectionName);
    let q;

    if (filters.companyId) {
      q = query(usersCol, where('companyId', '==', filters.companyId), where('profile', '==', 'CLIENTE'), limit(pageSize));
    } else {
      q = query(usersCol, where('profile', '==', 'CLIENTE'), limit(pageSize));
    }

    if (lastDoc) {
      q = query(q, startAfter(lastDoc));
    }

    const snapshot = await getDocs(q);
    let users = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as User))
      .filter(u => u.profile === 'CLIENTE')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    if (filters.name) {
      const term = filters.name.toLowerCase();
      users = users.filter(u => u.name.toLowerCase().includes(term));
    }
    if (filters.email) {
      const term = filters.email.toLowerCase();
      users = users.filter(u => u.email.toLowerCase().includes(term));
    }

    return {
      users,
      lastDoc: snapshot.docs[snapshot.docs.length - 1]
    };
  }

  async createUser(input: { name: string, email: string, companyId: string, profile: UserProfile }) {
    const now = new Date().toISOString();
    const tempAppName = `temp-user-${makeId()}`;
    let tempApp: FirebaseApp | null = null;

    try {
      tempApp = firebaseInitApp(environment.firebase as any, tempAppName);
      const tempAuth = getFirebaseAuth(tempApp);
      
      // 1. Create in Firebase Auth with a secure random password
      const tempPassword = crypto.randomUUID() + '@Aa1';
      const cred = await firebaseCreateUser(tempAuth, input.email, tempPassword);
      const uid = cred.user.uid;

      // 2. Save in Firestore
      const userDoc: User = {
        id: uid,
        name: input.name,
        email: input.email,
        companyId: input.companyId,
        profile: input.profile,
        status: 'ATIVO',
        active: true,
        createdAt: now,
        updatedAt: now
      };

      await this.usersRepo.set(userDoc);

      // 3. Send professional invite via Netlify Function
      const actionCodeSettings: ActionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      };

      const admin = this.session.user();

      try {
        console.log(`[DEBUG] Gerando link de convite para: ${input.email}`);
        
        // 3.1 Firebase Reset (Backup)
        try {
          // Tentamos o envio padrão do Firebase apenas como redundância.
          // Se falhar (ex: erro 400 por domínio não autorizado), ignoramos e seguimos com o e-mail profissional.
          await sendPasswordResetEmail(this.auth, input.email, actionCodeSettings);
          console.log(`[DEBUG] Reset de senha do Firebase disparado (backup) para: ${input.email}`);
        } catch (fbAuthError: any) {
          console.warn(`[DEBUG] Firebase Auth backup ignorado ou falhou (comum em localhost):`, fbAuthError.message);
        }
        
        // 3.2 Professional Invite (Principal)
        const company = await this.companiesRepo.getById(input.companyId);
        const companyName = company ? (company.razaoSocial || company.nomeFantasia || company.name || 'Empresa') : 'Empresa';

        console.log(`[DEBUG] Enviando e-mail profissional via Netlify Functions...`);
        await this.emailService.sendInviteEmail({
          to: input.email,
          userName: input.name,
          companyName: companyName,
          origin: window.location.origin,
          type: 'INVITE'
        });

        await this.auditLog.log({
          action: AuditAction.INVITE_EMAIL_SENT,
          appVersion: '',
          osVersion: '',
          user_profile: admin?.profile || 'ADMIN',
          userEmail: admin?.email || '',
          userId: admin?.id || '',
          details: { email: input.email, name: input.name, method: 'professional_netlify' }
        });

        console.log(`[DEBUG] Convite profissional enviado com sucesso para: ${input.email}`);
      } catch (emailError: any) {
        console.error('[DEBUG] Erro ao enviar e-mail profissional:', emailError);
        await this.auditLog.logError(AuditAction.INVITE_EMAIL_ERROR, emailError, { email: input.email });
      }

      // 4. Audit log (User Created)
      await this.auditLog.log({
        action: AuditAction.USER_CREATED,
        appVersion: '',
        osVersion: '',
        user_profile: admin?.profile || 'ADMIN',
        userEmail: admin?.email || '',
        userId: admin?.id || '',
        details: { createdUserId: uid, email: input.email, name: input.name, companyId: input.companyId }
      });

      return uid;
    } catch (error: any) {
      await this.auditLog.logError(AuditAction.USER_CREATE_ERROR, error, { email: input.email });
      throw error;
    } finally {
      if (tempApp) await deleteApp(tempApp);
    }
  }

  async updateUser(id: string, patch: Partial<User>) {
    const now = new Date().toISOString();
    const updateData = { ...patch, updatedAt: now };
    
    try {
      const docRef = doc(this.firestore, this.collectionName, id);
      await updateDoc(docRef, updateData as any);

      const admin = this.session.user();
      await this.auditLog.log({
        action: AuditAction.USER_UPDATED,
        appVersion: '',
        osVersion: '',
        user_profile: admin?.profile || 'ADMIN',
        userEmail: admin?.email || '',
        userId: admin?.id || '',
        details: { updatedUserId: id, patch }
      });
    } catch (error: any) {
      await this.auditLog.logError(AuditAction.USER_UPDATE_ERROR, error, { userId: id, patch });
      throw error;
    }
  }

  async toggleStatus(user: User) {
    const newActive = !user.active;
    const newStatus: UserStatus = newActive ? 'ATIVO' : 'INATIVO';
    
    try {
      await this.updateUser(user.id, { active: newActive, status: newStatus });
      
      const admin = this.session.user();
      await this.auditLog.log({
        action: AuditAction.USER_STATUS_CHANGED,
        appVersion: '',
        osVersion: '',
        user_profile: admin?.profile || 'ADMIN',
        userEmail: admin?.email || '',
        userId: admin?.id || '',
        details: { targetUserId: user.id, active: newActive }
      });
    } catch (error: any) {
      await this.auditLog.logError(AuditAction.USER_STATUS_ERROR, error, { userId: user.id });
      throw error;
    }
  }

  async sendPasswordReset(email: string, userId: string) {
    try {
      console.log(`[DEBUG] Iniciando processo de reenvio de convite/reset para: ${email}`);
      
      const actionCodeSettings: ActionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      };

      // 1. Tentar Firebase Auth (Backup silencioso)
      try {
        await sendPasswordResetEmail(this.auth, email, actionCodeSettings);
        console.log(`[DEBUG] Firebase Auth reset disparado via backup.`);
      } catch (fbAuthError: any) {
        console.warn(`[DEBUG] Falha ou bloqueio no Firebase Auth backup (ignorado):`, fbAuthError.message);
      }

      // 2. DISPARAR SEMPRE o e-mail profissional via Netlify (Garante a entrega visual)
      const user = await this.usersRepo.getById(userId);
      const company = user ? await this.companiesRepo.getById(user.companyId) : null;
      const companyName = company ? (company.razaoSocial || company.nomeFantasia || company.name || 'Empresa') : 'Sua Empresa';

      console.log(`[DEBUG] Disparando e-mail profissional para: ${email}`);
      await this.emailService.sendInviteEmail({
        to: email,
        userName: user?.name || 'Usuário',
        companyName: companyName,
        origin: window.location.origin,
        type: 'RESET'
      });
      
      const admin = this.session.user();
      await this.auditLog.log({
        action: AuditAction.USER_PASSWORD_RESET_SENT,
        appVersion: '',
        osVersion: '',
        user_profile: admin?.profile || 'ADMIN',
        userEmail: admin?.email || '',
        userId: admin?.id || '',
        details: { targetUserId: userId, email, method: 'hybrid' }
      });

      console.log(`[DEBUG] Processo de envio concluído com sucesso para: ${email}`);
    } catch (error: any) {
      console.error(`[DEBUG] Erro crítico ao processar reenvio para ${email}:`, error);
      await this.auditLog.logError(AuditAction.USER_PASSWORD_RESET_ERROR, error, { userId, email });
      throw error;
    }
  }
}
