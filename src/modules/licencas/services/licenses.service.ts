import { Injectable, inject } from '@angular/core';
import { LicensesRepository } from '../repositories/licenses.repository';
import { License, AuditUser, calculateLicenseStatus } from '../models/license.model';
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
export class LicensesService {
    private readonly repo = inject(LicensesRepository);
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

    private getLicenseAlertDate(license: Partial<License>): string {
        const group = license.documentGroup;
        const type = license.documentType;
        const renewalTypes = [
            'Licença Prévia (LP)',
            'Licença de Instalação (LI)',
            'Licença de Operação (LO)',
            'Renovação da LO'
        ];
        const isEnvironmentalWithRenewal = group === 'Licenciamento Ambiental' && renewalTypes.includes(type ?? '');

        return isEnvironmentalWithRenewal && license.renewalDate
            ? license.renewalDate
            : (license.expirationDate ?? '');
    }

    async createLicense(data: Partial<License>): Promise<License> {
        const audit = await this.getAuditUser();
        const id = makeId('lic_');
        const now = new Date().toISOString();

        const license: License = {
            id,
            companyId: data.companyId ?? '',
            unitId: data.unitId ?? '',
            documentGroup: data.documentGroup ?? '',
            documentType: data.documentType ?? '',
            documentNumber: (data.documentNumber ?? '').toUpperCase(),
            issuingAgency: (data.issuingAgency ?? '').toUpperCase(),
            legalBasis: data.legalBasis ?? '',
            periodicity: data.periodicity,
            issueDate: data.issueDate ?? '',
            expirationDate: data.expirationDate ?? '',
            renewalDate: data.renewalDate ?? '',
            status: calculateLicenseStatus(data.expirationDate ?? ''),
            pdfUrl: data.pdfUrl ?? '',
            pdfName: data.pdfName ?? '',
            pdfContentType: data.pdfContentType ?? '',
            notes: data.notes ?? '',
            // Campos do Responsável Técnico (apenas para Programas de SST)
            technicalResponsibleName: data.technicalResponsibleName ?? '',
            technicalResponsibleCpf: data.technicalResponsibleCpf ?? '',
            technicalResponsibleCouncil: data.technicalResponsibleCouncil ?? '',
            technicalResponsibleRegistration: data.technicalResponsibleRegistration ?? '',
            technicalResponsibleArt: data.technicalResponsibleArt ?? '',
            createdAt: now,
            createdBy: audit,
        };

        try {
            await this.repo.create(license);
        } catch (createError) {
            await this.auditLog.logError(AuditAction.LICENSE_CREATE_ERROR, createError, { documentNumber: license.documentNumber, companyId: license.companyId });
            throw createError;
        }

        const company = await this.companiesRepo.get(license.companyId);
        await this.alerts.generateAlerts(
            'licenca',
            license.id,
            audit.uid,
            this.getLicenseAlertDate(license),
            {
                companyId: license.companyId,
                companyName: company?.nomeFantasia || company?.razaoSocial || 'N/A',
                documento: `${license.documentType} (${license.documentNumber})`
            }
        );

        try {
            await this.auditLog.log({
                action: AuditAction.LICENSE_CREATED,
                appVersion: '',
                osVersion: '',
                user_profile: audit.profile || 'UNKNOWN',
                userEmail: audit.email,
                userId: audit.uid,
                details: { licenseId: id, documentType: license.documentType, documentNumber: license.documentNumber }
            });

            if (license.pdfUrl) {
                await this.auditLog.log({
                    action: AuditAction.LICENSE_DOCUMENT_UPLOADED,
                    appVersion: '',
                    osVersion: '',
                    user_profile: audit.profile || 'UNKNOWN',
                    userEmail: audit.email,
                    userId: audit.uid,
                    details: { licenseId: id, fileName: license.pdfName }
                });
            }
        } catch (e) { console.error('Audit error:', e); }

        return license;
    }

    async updateLicense(id: string, data: Partial<License>): Promise<void> {
        const audit = await this.getAuditUser();
        const now = new Date().toISOString();

        const updateData: Partial<License> = {
            ...data,
            updatedAt: now,
            updatedBy: audit,
        };

        // Recalcular status se necessário
        const current = await this.getById(id);
        if (current) {
            const merged = { ...current, ...data };
            updateData.status = calculateLicenseStatus(this.getLicenseAlertDate(merged));
        }

        // Campos em uppercase
        if (updateData.documentNumber) {
            updateData.documentNumber = updateData.documentNumber.toUpperCase();
        }
        if (updateData.issuingAgency) {
            updateData.issuingAgency = updateData.issuingAgency.toUpperCase();
        }

        try {
            await this.repo.updateLicense(id, updateData);
        } catch (updateError) {
            await this.auditLog.logError(AuditAction.LICENSE_UPDATE_ERROR, updateError, { licenseId: id, patch: data });
            throw updateError;
        }

        try {
            // Se apenas o PDF foi atualizado, não registramos o log de LICENSE_UPDATED genérico
            // para evitar duplicidade com o log específico de LICENSE_DOCUMENT_UPLOADED
            // Consideramos apenas PDF se contiver pdfUrl e não contiver campos principais de dados
            const isOnlyPdfUpdate = !!data.pdfUrl && !data.documentType && !data.documentNumber && !data.issueDate && !data.expirationDate && !data.legalBasis;

            if (!isOnlyPdfUpdate) {
                await this.auditLog.log({
                    action: AuditAction.LICENSE_UPDATED,
                    appVersion: '',
                    osVersion: '',
                    user_profile: audit.profile || 'UNKNOWN',
                    userEmail: audit.email,
                    userId: audit.uid,
                    details: { licenseId: id, patch: data }
                });
            }

            if (data.pdfUrl) {
                await this.auditLog.log({
                    action: AuditAction.LICENSE_DOCUMENT_UPLOADED,
                    appVersion: '',
                    osVersion: '',
                    user_profile: audit.profile || 'UNKNOWN',
                    userEmail: audit.email,
                    userId: audit.uid,
                    details: { licenseId: id, fileName: data.pdfName, mode: isOnlyPdfUpdate ? 'upload' : 'update' }
                });
            }
        } catch (e) { console.error('Audit error:', e); }

        if (updateData.expirationDate || updateData.renewalDate || updateData.documentType || updateData.documentNumber || updateData.companyId) {
            if (current) {
                // Clear existing alerts for this specific license before regenerating
                await this.alerts.deleteAlertsByOrigin(id);

                const updatedLicense = { ...current, ...updateData };
                const company = await this.companiesRepo.get(updatedLicense.companyId);
                await this.alerts.generateAlerts(
                    'licenca',
                    id,
                    audit.uid,
                    this.getLicenseAlertDate(updatedLicense), // Usa a data atualizada do registro
                    {
                        companyId: updatedLicense.companyId,
                        companyName: company?.nomeFantasia || company?.razaoSocial || 'N/A',
                        documento: `${updatedLicense.documentType} (${updatedLicense.documentNumber})`
                    }
                );
            }
        }
    }

    async toggleStatus(license: License): Promise<void> {
        // Recalcular status baseado na data correta (renovação ou vencimento)
        const alertDate = this.getLicenseAlertDate(license);
        const newStatus = calculateLicenseStatus(alertDate);
        await this.updateLicense(license.id, { status: newStatus });
    }

    async getById(id: string): Promise<License | null> {
        return this.repo.getById(id);
    }

    async listAll(max = 200): Promise<License[]> {
        return this.repo.listAll(max);
    }

    async listByCompany(companyId: string, max = 200): Promise<License[]> {
        return this.repo.listByCompany(companyId, max);
    }

    async listPaged(
        companyId?: string,
        term?: string,
        pageSize = 30,
        startAfterDoc?: any
    ): Promise<{ docs: License[]; lastDoc: any }> {
        return this.repo.listPaged(companyId, term, pageSize, startAfterDoc);
    }

    async listPagedByFilters(
        filters: {
            companyId?: string;
            unitId?: string;
            documentType?: string;
            status?: string;
        },
        pageSize = 30,
        startAfterDoc?: any
    ): Promise<{ docs: License[]; lastDoc: any }> {
        return this.repo.listPagedByFilters(filters, pageSize, startAfterDoc);
    }

    // Recalcular status de todas as licenças (para manutenção)
    async recalculateAllStatuses(): Promise<void> {
        const licenses = await this.repo.listAll(1000);
        for (const lic of licenses) {
            const alertDate = this.getLicenseAlertDate(lic);
            const newStatus = calculateLicenseStatus(alertDate);
            if (lic.status !== newStatus) {
                await this.repo.updateLicense(lic.id, { status: newStatus });
            }
        }
    }

    // Exclusão lógica (soft delete)
    async softDelete(id: string): Promise<void> {
        const audit = await this.getAuditUser();
        const now = new Date().toISOString();

        try {
            await this.repo.updateLicense(id, {
                deleted: true,
                deletedAt: now,
                deletedBy: audit,
            });

            await this.auditLog.log({
                action: AuditAction.LICENSE_DELETED,
                appVersion: '',
                osVersion: '',
                user_profile: audit.profile || 'UNKNOWN',
                userEmail: audit.email,
                userId: audit.uid,
                details: { licenseId: id }
            });
        } catch (error) {
            await this.auditLog.logError(AuditAction.LICENSE_DELETE_ERROR, error, { licenseId: id });
            throw error;
        }
    }

    // Restaurar registro excluído
    async restore(id: string): Promise<void> {
        const audit = await this.getAuditUser();
        const now = new Date().toISOString();

        try {
            await this.repo.updateLicense(id, {
                deleted: false,
                deletedAt: undefined,
                deletedBy: undefined,
                updatedAt: now,
                updatedBy: audit
            });

            // Poderia ter um AuditAction.LICENSE_RESTORED se necessário
            await this.auditLog.log({
                action: 'license_restored',
                appVersion: '',
                osVersion: '',
                user_profile: audit.profile || 'UNKNOWN',
                userEmail: audit.email,
                userId: audit.uid,
                details: { licenseId: id }
            });
        } catch (error) {
            await this.auditLog.logError('license_restore_error', error, { licenseId: id });
            throw error;
        }
    }
}
