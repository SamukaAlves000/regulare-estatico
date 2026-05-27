import { Injectable, inject } from '@angular/core';
import {
  Firestore, collection, query, where, getDocs,
  addDoc, doc, updateDoc, getDoc, writeBatch, limit,
} from '@angular/fire/firestore';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';
import { SessionService } from '../../../core/services/session.service';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';
import { LgpdTerm, LgpdTermAcceptance } from '../../../core/models/lgpd-term.model';
import { User } from '../../../core/models/user.model';

@Injectable({ providedIn: 'root' })
export class LgpdTermsService {
  private readonly firestore      = inject(Firestore);
  private readonly auditLog       = inject(AuditLogService);
  private readonly session        = inject(SessionService);
  private readonly companiesRepo  = inject(CompaniesRepository);

  private readonly TERMS_COL       = 'lgpd_terms';
  private readonly ACCEPTANCES_COL = 'lgpd_term_acceptances';

  private actor() { return this.session.user()!; }

  // -------------------------------------------------------------------------
  // Term CRUD
  // -------------------------------------------------------------------------

  async listAll(): Promise<LgpdTerm[]> {
    const snap = await getDocs(collection(this.firestore, this.TERMS_COL));
    return snap.docs
      .map(d => ({ ...d.data(), id: d.id } as LgpdTerm))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<LgpdTerm | null> {
    const snap = await getDoc(doc(this.firestore, this.TERMS_COL, id));
    if (!snap.exists()) return null;
    return { ...snap.data(), id: snap.id } as LgpdTerm;
  }

  async getActive(): Promise<LgpdTerm | null> {
    const q = query(
      collection(this.firestore, this.TERMS_COL),
      where('active', '==', true),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { ...d.data(), id: d.id } as LgpdTerm;
  }

  async createTerm(input: { version: string; title: string; content: string }): Promise<string> {
    const now  = new Date().toISOString();
    const user = this.actor();
    const term = {
      version: input.version,
      title:   input.title,
      content: input.content,
      active:  false,
      status:  'draft' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: user.name,
      updatedBy: user.name,
    };
    const ref = await addDoc(collection(this.firestore, this.TERMS_COL), term);
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_CREATED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: ref.id, version: input.version, title: input.title },
    });
    return ref.id;
  }

  async updateDraft(id: string, input: { title: string; content: string; version: string }): Promise<void> {
    const term = await this.getById(id);
    if (!term || term.status !== 'draft') throw new Error('Apenas rascunhos podem ser editados');
    const user = this.actor();
    const now  = new Date().toISOString();
    await updateDoc(doc(this.firestore, this.TERMS_COL, id), {
      title:   input.title,
      content: input.content,
      version: input.version,
      updatedAt: now,
      updatedBy: user.name,
    });
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_UPDATED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: id, version: input.version },
    });
  }

  async publishTerm(id: string): Promise<void> {
    const term = await this.getById(id);
    if (!term || term.status !== 'draft') throw new Error('Apenas rascunhos podem ser publicados');
    const user = this.actor();
    const now  = new Date().toISOString();
    await updateDoc(doc(this.firestore, this.TERMS_COL, id), {
      status: 'published', publishedAt: now, updatedAt: now, updatedBy: user.name,
    });
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_PUBLISHED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: id, version: term.version },
    });
  }

  async activateTerm(id: string): Promise<void> {
    const term = await this.getById(id);
    if (!term || term.status !== 'published') throw new Error('Apenas termos publicados podem ser ativados');
    const user = this.actor();
    const now  = new Date().toISOString();

    const activeSnap = await getDocs(query(
      collection(this.firestore, this.TERMS_COL),
      where('active', '==', true)
    ));
    const batch = writeBatch(this.firestore);
    activeSnap.docs.forEach(d => {
      if (d.id !== id) batch.update(d.ref, { active: false, updatedAt: now });
    });
    batch.update(doc(this.firestore, this.TERMS_COL, id), {
      active: true, updatedAt: now, updatedBy: user.name,
    });
    await batch.commit();

    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_ACTIVATED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: id, version: term.version },
    });
  }

  async archiveTerm(id: string): Promise<void> {
    const term = await this.getById(id);
    if (!term) throw new Error('Termo não encontrado');
    if (term.status === 'draft') throw new Error('Rascunhos não podem ser arquivados diretamente — publique primeiro');
    const user = this.actor();
    const now  = new Date().toISOString();
    await updateDoc(doc(this.firestore, this.TERMS_COL, id), {
      status: 'archived', active: false, updatedAt: now, updatedBy: user.name,
    });
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_ARCHIVED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: id, version: term.version },
    });
  }

  async versionTerm(id: string): Promise<string> {
    const source = await this.getById(id);
    if (!source) throw new Error('Termo não encontrado');
    const user = this.actor();
    const now  = new Date().toISOString();
    const newVersion = this.nextPatchVersion(source.version);

    // Strip id and time-specific fields before duplicating
    const { id: _id, hash, publishedAt, ...rest } = source as any;
    const newTerm = {
      ...rest,
      version:   newVersion,
      active:    false,
      status:    'draft' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: user.name,
      updatedBy: user.name,
    };
    const ref = await addDoc(collection(this.firestore, this.TERMS_COL), newTerm);
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_VERSIONED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { sourceId: id, newId: ref.id, sourceVersion: source.version, newVersion },
    });
    return ref.id;
  }

  // -------------------------------------------------------------------------
  // Acceptances
  // -------------------------------------------------------------------------

  async hasUserAcceptedActiveTerm(userId: string, termId: string): Promise<boolean> {
    const q = query(
      collection(this.firestore, this.ACCEPTANCES_COL),
      where('userId',   '==', userId),
      where('termId',   '==', termId),
      where('accepted', '==', true),
      limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  }

  async saveAcceptance(term: LgpdTerm, user: User): Promise<void> {
    const now = new Date().toISOString();
    let companyName = '';
    try {
      const company = await this.companiesRepo.getById(user.companyId);
      companyName = company?.razaoSocial ?? company?.nomeFantasia ?? (company as any)?.name ?? '';
    } catch { /* best effort */ }

    const acceptance: Omit<LgpdTermAcceptance, 'id'> = {
      userId:      user.id,
      userName:    user.name,
      userEmail:   user.email,
      companyId:   user.companyId,
      companyName,
      termId:      term.id,
      termVersion: term.version,
      acceptedAt:  now,
      userAgent:   navigator.userAgent,
      accepted:    true,
    };
    await addDoc(collection(this.firestore, this.ACCEPTANCES_COL), acceptance);
    await this.auditLog.log({
      action: AuditAction.LGPD_TERM_ACCEPTED,
      appVersion: '', osVersion: '',
      user_profile: user.profile, userEmail: user.email, userId: user.id,
      details: { termId: term.id, termVersion: term.version, companyId: user.companyId },
    });
  }

  async countAcceptances(termId: string): Promise<number> {
    const q = query(
      collection(this.firestore, this.ACCEPTANCES_COL),
      where('termId', '==', termId)
    );
    const snap = await getDocs(q);
    return snap.size;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  nextPatchVersion(v: string): string {
    const m = v.match(/^v?(\d+)\.(\d+)$/);
    if (!m) return 'v1.0';
    return `v${m[1]}.${parseInt(m[2]) + 1}`;
  }
}