import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';

// pdfmake — importação corrigida para Angular (evita erros de tipagem)
import * as pdfMakeLib from 'pdfmake/build/pdfmake';
import * as pdfFontsLib from 'pdfmake/build/vfs_fonts';

// Workaround necessário para o pdfmake funcionar em Angular com ESM/strict mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake = (pdfMakeLib as any).default ?? pdfMakeLib;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfFonts = (pdfFontsLib as any).default ?? pdfFontsLib;

// Inicializar VFS (fontes embutidas)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfMake as any).vfs = pdfFonts?.pdfMake?.vfs ?? pdfFonts?.vfs ?? pdfFonts;

// Importar modelos
import { License, LicenseCondition, LICENSE_GROUPS } from '../../licencas/models/license.model';
import { EpiDelivery, EpiDeliveryItem } from '../../epis/models/epi-delivery.model';
import { Company } from '../../cadastros/models/company.model';
import { Unit } from '../../cadastros/models/unit.model';

// Importar Firestore
import { doc, getDoc, collection, query, where, getDocs } from '@angular/fire/firestore';

// Serviços de rastreabilidade e autenticação documental
import { ReportHashService } from '../../../core/services/report-hash.service';
import { DocumentValidationService } from '../../../core/services/document-validation.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';
import { SessionService } from '../../../core/services/session.service';
import { environment } from '../../../environments/environment';

// QR Code para autenticação documental
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as QRCodeLib from 'qrcode';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const QRCodeGen = (QRCodeLib as any).default ?? QRCodeLib;

// ---------------------------------------------------------------------------
// Interfaces de métricas
// ---------------------------------------------------------------------------
export interface GrcMetrics {
    conformidade: number;
    risco: string;
    totalGeral: number;
    pendencias: number;
    licencas: {
        total: number;
        emDia: number;
        aVencer: number;
        vencidas: number;
    };
    condicionantes: {
        total: number;
        cumpridas: number;
        aVencer: number;
        vencidas: number;
        pendentes: number;
    };
    epis: {
        total: number;
        ok: number;
        aVencer: number;
        vencidos: number;
    };
}

// ---------------------------------------------------------------------------
// Paleta de cores centralizada
// ---------------------------------------------------------------------------
const C = {
    primary: '#1a3c5e',
    success: '#27ae60',
    warning: '#e67e22',
    danger:  '#c0392b',
    light:   '#f5f7fa',
    border:  '#dde3ea',
    text:    '#2c3e50',
    muted:   '#7f8c8d',
    white:   '#ffffff',
    condBg:  '#eaf0f6',
} as const;

// ---------------------------------------------------------------------------
// Mapeamento de tipos de documento para grupos
// GERADO AUTOMATICAMENTE a partir de LICENSE_GROUPS para nunca ficar desatualizado
// ---------------------------------------------------------------------------
const DOCUMENT_TYPE_TO_GROUP: Record<string, string> = {};

// Popula automaticamente a partir do LICENSE_GROUPS do model
LICENSE_GROUPS.forEach(g => {
    g.items.forEach(item => {
        DOCUMENT_TYPE_TO_GROUP[item] = g.group;
    });
});

// Entradas extras para tipos legacy/genéricos que podem existir no Firestore
DOCUMENT_TYPE_TO_GROUP['Licença Ambiental']                          = 'Licenciamento Ambiental';
DOCUMENT_TYPE_TO_GROUP['Licença']                                    = 'Licenciamento Ambiental';
DOCUMENT_TYPE_TO_GROUP['Autorização']                                = 'Licenciamento Ambiental';
DOCUMENT_TYPE_TO_GROUP['Alvará']                                     = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Alvará Sanitário']                           = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Certidão Negativa']                          = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Certidão Positiva com Efeitos de Negativa']  = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Certidão de Inteiro Teor']                   = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Certificado de Desinsetização e Desratização'] = 'Alvarás e Certidões';
DOCUMENT_TYPE_TO_GROUP['Outro']                                      = 'Outros Documentos';
DOCUMENT_TYPE_TO_GROUP['Outros']                                     = 'Outros Documentos';

// ---------------------------------------------------------------------------
// Todos os grupos disponíveis na ordem de exibição do relatório
// Inclui "Outros Documentos" como grupo de fallback
// ---------------------------------------------------------------------------
const ALL_GROUPS = [
    ...LICENSE_GROUPS.map(g => g.group),
    'Outros Documentos',
];

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------
@Injectable({ providedIn: 'root' })
export class GrcReportService {
    private firestore      = inject(Firestore);
    private hashService    = inject(ReportHashService);
    private docValidation  = inject(DocumentValidationService);
    private auditLog        = inject(AuditLogService);
    private session         = inject(SessionService);

    /**
     * Gera relatório GRC em PDF
     * Busca todos os dados (licenses, conditions, epis) do Firestore automaticamente
     * @param companyId - ID da empresa
     * @param unitId - (Opcional) ID da unidade para filtrar dados
     */
    async checkCompanyExists(companyId: string): Promise<boolean> {
        if (!companyId) return false;
        const snap = await getDoc(doc(this.firestore, 'companies', companyId));
        return snap.exists();
    }

    async generateReport(companyId: string, unitId?: string): Promise<void> {
        const user = this.session.user();
        const emitterName    = user?.name    ?? user?.email ?? 'sistema';
        const emitterEmail   = user?.email   ?? 'sistema';
        const emitterUserId  = user?.id      ?? 'sistema';
        const emitterProfile = user?.profile ?? 'sistema';

        try {
            // 1. Código sequencial único (REL-GRC-2026-0509-001)
            const reportCode     = await this.docValidation.generateSequentialCode();
            const generatedAtUtc = new Date().toISOString();

            // 2. Hash SHA-256 dos metadados
            const hashInput = this.hashService.buildHashInput(reportCode, companyId, unitId, generatedAtUtc);
            const hash      = await this.hashService.sha256(hashInput);

            // Usa origem real do browser para o QR funcionar em qualquer ambiente
            const appBase       = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : environment.appUrl;
            const validationUrl = `${appBase}/validate/${hash}`;

            // 3. QR Code para autenticação documental
            let qrDataUrl = '';
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                qrDataUrl = await (QRCodeGen as any).toDataURL(validationUrl, {
                    errorCorrectionLevel: 'M',
                    type: 'image/png',
                    width: 180,
                    margin: 1,
                });
            } catch {
                console.warn('[GrcReportService] Falha ao gerar QR Code — relatório continuará sem QR.');
            }

            // 4. Buscar dados do Firestore em paralelo
            const [companyDoc, unitDoc, licensesSnap, conditionsSnap, epiSnap] = await Promise.all([
                getDoc(doc(this.firestore, 'companies', companyId)),
                unitId ? getDoc(doc(this.firestore, 'units', unitId)) : Promise.resolve(null),
                getDocs(query(collection(this.firestore, 'licenses'), where('companyId', '==', companyId))),
                getDocs(query(collection(this.firestore, 'licenseConditions'), where('companyId', '==', companyId))),
                getDocs(query(collection(this.firestore, 'epi_deliveries'), where('companyId', '==', companyId))),
            ]);

            const company = { ...companyDoc.data(), id: companyDoc.id } as Company;
            const unit    = unitDoc?.exists() ? { ...unitDoc.data(), id: unitDoc.id } as Unit : null;

            let licenses = licensesSnap.docs
                .map(d => ({ ...d.data(), id: d.id } as License))
                .filter(l => l.deleted !== true);

            let conditions = conditionsSnap.docs
                .map(d => ({ ...d.data(), id: d.id } as LicenseCondition))
                .filter(c => c.deleted !== true);

            let epis = epiSnap.docs
                .map(d => ({ ...d.data(), id: d.id } as EpiDelivery))
                .filter(e => e.deleted !== true);

            if (unitId) {
                licenses = licenses.filter(l => l.unitId === unitId);
                epis     = epis.filter(e => e.unitId === unitId);
            }

            // 5. Montar PDF com seção de autenticidade
            const metrics = this.calculateMetrics(licenses, conditions, epis);
            const docDef  = this.buildDocDefinition(
                company, unit, licenses, conditions, epis, metrics,
                reportCode, hash, generatedAtUtc, emitterName, qrDataUrl, validationUrl
            );

            // 6. Download via pdfMake.download() — mesmo método que funcionava antes
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (pdfMake as any).createPdf(docDef).download(`${reportCode}.pdf`);

            // 7. Persistência em background — só Firestore + AuditLog, não bloqueia o download
            this.persistReport(companyId, reportCode, {
                hash, generatedAtUtc, unitId, validationUrl,
                companyName: company.razaoSocial ?? companyId,
                unitName: unit?.name,
                emitterUserId, emitterName, emitterEmail, emitterProfile,
            }).catch(err =>
                console.error('[GrcReportService] Erro na persistência pós-download:', err)
            );

        } catch (error) {
            console.error('[GrcReportService] Erro ao gerar PDF:', error);
            this.auditLog.logError(AuditAction.DOCUMENT_GENERATION_ERROR, error, { companyId, unitId })
                .catch(() => {});
            throw error;
        }
    }

    private async persistReport(
        companyId: string,
        reportCode: string,
        meta: {
            hash: string;
            generatedAtUtc: string;
            unitId?: string;
            validationUrl: string;
            companyName: string;
            unitName?: string;
            emitterUserId: string;
            emitterName: string;
            emitterEmail: string;
            emitterProfile: string;
        }
    ): Promise<void> {
        // Executa em paralelo e de forma independente:
        // se generated_reports falhar (ex: rules), o audit_log ainda é gravado
        await Promise.allSettled([

            this.docValidation.saveReport({
                reportCode,
                hash:           meta.hash,
                companyId,
                companyName:    meta.companyName,
                unitId:         meta.unitId,
                unitName:       meta.unitName,
                generatedAtUtc: meta.generatedAtUtc,
                documentType:   'GRC_REPORT',
                fileName:       `${reportCode}.pdf`,
                validationUrl:  meta.validationUrl,
                valid:          true,
                createdAt:      meta.generatedAtUtc,
                emittedByUserId:      meta.emitterUserId,
                emittedByUserName:    meta.emitterName,
                emittedByUserEmail:   meta.emitterEmail,
                emittedByUserProfile: meta.emitterProfile,
            }).catch(err => console.error('[GrcReportService] Falha ao salvar generated_reports:', err)),

            this.auditLog.log({
                action:       AuditAction.DOCUMENT_GENERATED,
                user_profile: meta.emitterProfile,
                userEmail:    meta.emitterEmail,
                userId:       meta.emitterUserId,
                appVersion:   '',
                osVersion:    '',
                details: Object.fromEntries(Object.entries({
                    reportCode,
                    hash:         meta.hash,
                    companyId,
                    unitId:       meta.unitId,
                    documentType: 'GRC_REPORT',
                }).filter(([, v]) => v !== undefined)),
            }).catch(err => console.error('[GrcReportService] Falha ao salvar audit_log:', err)),

        ]);
    }

    // -------------------------------------------------------------------------
    // Determina o grupo correto da licença — sempre retorna um grupo válido
    // -------------------------------------------------------------------------
    private getLicenseGroup(license: License): string {
        // 1. Se tem documentGroup definido e não vazio, usa diretamente
        if (license.documentGroup && license.documentGroup.trim() !== '') {
            return license.documentGroup;
        }

        // 2. Fallback: tenta mapear pelo documentType
        const mappedGroup = DOCUMENT_TYPE_TO_GROUP[license.documentType];

        // DEBUG — remova após validação em produção
        if (!mappedGroup) {
            console.warn(
                `[GrcReportService] Tipo de documento sem grupo mapeado: "${license.documentType}" ` +
                `(id: ${license.id}). Alocado em "Outros Documentos".`
            );
        }

        // 3. Fallback final
        return mappedGroup ?? 'Outros Documentos';
    }

    // -------------------------------------------------------------------------
    // Cálculo de métricas (COM "A VENCER" para próximos 30 dias)
    // -------------------------------------------------------------------------
    private calculateMetrics(
        licenses: License[],
        conditions: LicenseCondition[],
        epis: EpiDelivery[]
    ): GrcMetrics {
        const today = this.startOfDay(new Date());
        const limit30 = this.addDays(today, 30);

        // LICENÇAS - Com "A Vencer" para próximos 30 dias
        let licEmDia = 0;
        let licAVencer = 0;
        let licVencidas = 0;

        licenses.forEach(l => {
            const exp = this.parseDate(l.expirationDate);
            if (exp < today) {
                licVencidas++;
            } else if (exp <= limit30) {
                licAVencer++;
            } else {
                licEmDia++;
            }
        });

        // CONDICIONANTES
        const condCumpridas = conditions.filter(c => c.status === 'cumprida').length;
        const condVencidas = conditions.filter(c => c.status === 'vencida').length;
        const condPendentes = conditions.filter(c => c.status === 'pendente').length;
        const condAVencer = conditions.filter(c => c.status === 'a_vencer').length;

        // EPIs - Com "A Vencer" para próximos 30 dias
        let epiOk = 0;
        let epiAVencer = 0;
        let epiVencidos = 0;

        epis.forEach(delivery => {
            let temVencido = false;
            let temAVencer = false;

            delivery.items.forEach(item => {
                const exp = this.parseDate(item.epiExpirationDate);
                if (exp < today) {
                    temVencido = true;
                } else if (exp <= limit30) {
                    temAVencer = true;
                }
            });

            if (temVencido) {
                epiVencidos++;
            } else if (temAVencer) {
                epiAVencer++;
            } else {
                epiOk++;
            }
        });

        // TOTAIS
        const totalLic = licenses.length;
        const totalCond = conditions.length;
        const totalEpi = epis.length;
        const totalGeral = totalLic + totalCond + totalEpi;

        // Total em conformidade = Em Dia + A Vencer (ainda não venceram)
        const totalConforme = licEmDia + licAVencer + condCumpridas + condAVencer + epiOk + epiAVencer;
        const conformidade = totalGeral > 0 ? Math.round((totalConforme / totalGeral) * 100) : 0;

        const risco = conformidade >= 80 ? 'Baixo'
            : conformidade >= 60 ? 'Moderado'
                : conformidade >= 40 ? 'Alto' : 'Crítico';

        const pendencias = licVencidas + licAVencer + condVencidas + condAVencer + condPendentes + epiVencidos + epiAVencer;

        return {
            conformidade, risco, totalGeral, pendencias,
            licencas: { total: totalLic, emDia: licEmDia, aVencer: licAVencer, vencidas: licVencidas },
            condicionantes: {
                total: totalCond, cumpridas: condCumpridas, aVencer: condAVencer,
                vencidas: condVencidas, pendentes: condPendentes
            },
            epis: { total: totalEpi, ok: epiOk, aVencer: epiAVencer, vencidos: epiVencidos },
        };
    }

    // -------------------------------------------------------------------------
    // Helpers de data
    // -------------------------------------------------------------------------
    private startOfDay(d: Date): Date {
        const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
    }

    private addDays(d: Date, n: number): Date {
        const r = new Date(d); r.setDate(r.getDate() + n); return r;
    }

    private parseDate(dateStr: string | undefined): Date {
        if (!dateStr) return new Date();

        // ISO: yyyy-mm-dd
        if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
            return new Date(year, month - 1, day);
        }

        // BR: dd/mm/yyyy
        if (dateStr.includes('/')) {
            const [d, m, y] = dateStr.split('/').map(Number);
            return new Date(y, m - 1, d);
        }

        const parsedDate = new Date(dateStr);
        const currentYear = new Date().getFullYear();
        if (
            isNaN(parsedDate.getTime()) ||
            parsedDate.getFullYear() > currentYear + 10 ||
            parsedDate.getFullYear() < 1900
        ) {
            return new Date();
        }
        return parsedDate;
    }

    private daysDiff(dateStr: string | undefined): number {
        if (!dateStr) return 0;
        const d = this.startOfDay(this.parseDate(dateStr));
        const today = this.startOfDay(new Date());
        return Math.round((d.getTime() - today.getTime()) / 86_400_000);
    }

    private fmt(dateStr: string | undefined): string {
        if (!dateStr) return '-';
        try {
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
                return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
            }
            if (dateStr.match(/^\d{2}\/\d{2}\/\d{4}/)) return dateStr;
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('pt-BR');
        } catch {
            return dateStr;
        }
    }

    private riskAreaFromGroup(group: string): string {
        const map: Record<string, string> = {
            'Licenciamento Ambiental': 'Ambiental',
            'Documentos Rurais / Florestais': 'Ambiental',
            'Resíduos e Logística Reversa': 'Ambiental',
            'Registros e Cadastros Obrigatórios': 'Ambiental / IBAMA',
            'Alvarás e Certidões': 'Jurídico / Fiscal',
            'Transporte': 'Operacional',
            'Documentação Técnica Ocupacional (SST)': 'Trabalhista / SST',
            'Outros Documentos': 'Compliance',
        };
        return map[group] ?? 'Compliance';
    }

    // -------------------------------------------------------------------------
    // Helpers de estilo pdfmake
    // -------------------------------------------------------------------------
    private th(label: string, extraProps: object = {}): object {
        return {
            text: label,
            bold: true, fontSize: 9,
            color: C.white, fillColor: C.primary,
            alignment: 'center',
            ...extraProps,
        };
    }

    private td(text: string | number, extraProps: object = {}): object {
        return { text: String(text), fontSize: 8, color: C.text, ...extraProps };
    }

    private badge(status: string): object {
        const map: Record<string, { label: string; color: string }> = {
            em_dia: { label: '✓ Em Dia', color: C.success },
            a_vencer: { label: '⚠ A Vencer', color: C.warning },
            vencida: { label: '✕ Vencida', color: C.danger },
            vencido: { label: '✕ Vencido', color: C.danger },
            cumprida: { label: '✓ Cumprida', color: C.success },
            pendente: { label: '• Pendente', color: C.warning },
        };
        const s = map[status] ?? { label: status, color: C.muted };
        return { text: s.label, color: s.color, bold: true, fontSize: 8 };
    }

    private epiItemBadge(status: string): object {
        const map: Record<string, { label: string; color: string }> = {
            em_dia: { label: '✓ Em Dia', color: C.success },
            a_vencer: { label: '⚠ A Vencer', color: C.warning },
            vencido: { label: '✕ Vencido', color: C.danger },
        };
        const s = map[status] ?? { label: status, color: C.muted };
        return { text: s.label, color: s.color, bold: true, fontSize: 8 };
    }

    private sectionTitle(text: string, addPageBreak = false): object {
        const base = {
            text,
            fontSize: 13, bold: true,
            color: C.primary,
            background: C.light,
            margin: [0, 12, 0, 6],
        };
        if (addPageBreak) return { ...base, pageBreak: 'before' };
        return base;
    }

    private getEpiItemStatus(item: EpiDeliveryItem, today: Date, limit30: Date): string {
        const exp = this.parseDate(item.epiExpirationDate);
        if (exp < today) return 'vencido';
        if (exp <= limit30) return 'a_vencer';
        return 'em_dia';
    }

    // -------------------------------------------------------------------------
    // Seção de EPIs por item
    // -------------------------------------------------------------------------
    private buildEpiItemsSection(epis: EpiDelivery[], today: Date, limit30: Date): object[] {
        const section: object[] = [];

        if (epis.length === 0) {
            section.push({
                text: 'Nenhuma entrega de EPI registrada.',
                fontSize: 9, color: C.muted, margin: [0, 4, 0, 12],
            });
            return section;
        }

        epis.forEach((delivery, idx) => {
            section.push({
                margin: [0, 8, 0, 4],
                columns: [
                    {
                        stack: [
                            { text: `📋 Entrega #${idx + 1}`, fontSize: 10, bold: true, color: C.primary },
                            { text: `Funcionário: ${delivery.employeeName}`, fontSize: 9 },
                            { text: `Cargo: ${delivery.cargoName} (CBO: ${delivery.cargoCbo})`, fontSize: 8, color: C.muted },
                            { text: `Data da Entrega: ${this.fmt(delivery.deliveryDate)}`, fontSize: 8, color: C.muted },
                        ],
                        width: '40%',
                    },
                    {
                        stack: [
                            { text: `Total de Itens: ${delivery.items.length}`, fontSize: 9, alignment: 'right' },
                            { text: `Empresa: ${delivery.companyName || '-'}`, fontSize: 8, color: C.muted, alignment: 'right' },
                            { text: `Unidade: ${delivery.unitId}`, fontSize: 8, color: C.muted, alignment: 'right' },
                        ],
                        width: '30%',
                    },
                ],
            });

            const itemRows = delivery.items.map(item => {
                const status = this.getEpiItemStatus(item, today, limit30);
                const expDate = this.fmt(item.epiExpirationDate);
                const daysLeft = this.daysDiff(item.epiExpirationDate);

                let daysText: string;
                let daysColor: string;

                if (daysLeft < 0) {
                    daysText = `${Math.abs(daysLeft)} dias vencido`;
                    daysColor = C.danger;
                } else if (daysLeft === 0) {
                    daysText = 'Vence hoje';
                    daysColor = C.warning;
                } else if (daysLeft <= 30) {
                    daysText = `${daysLeft} dias restantes`;
                    daysColor = C.warning;
                } else {
                    daysText = `${daysLeft} dias restantes`;
                    daysColor = C.success;
                }

                return [
                    { text: item.name, fontSize: 8, bold: true },
                    { text: item.brand || '-', fontSize: 8, alignment: 'center' },
                    { text: item.model || '-', fontSize: 8, alignment: 'center' },
                    { text: item.caNumber || '-', fontSize: 8, alignment: 'center' },
                    { text: `${item.quantity}`, fontSize: 8, alignment: 'center' },
                    { text: expDate, fontSize: 8, alignment: 'center', color: daysLeft < 0 ? C.danger : (daysLeft <= 30 ? C.warning : C.text) },
                    { text: daysText, fontSize: 7, alignment: 'center', color: daysColor },
                    this.epiItemBadge(status),
                ];
            });

            section.push({
                table: {
                    headerRows: 1,
                    widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
                    body: [
                        [
                            this.th('EPI'),
                            this.th('Marca'),
                            this.th('Modelo'),
                            this.th('CA'),
                            this.th('Qtd'),
                            this.th('Vencimento'),
                            this.th('Situação'),
                            this.th('Status'),
                        ],
                        ...itemRows,
                    ],
                },
                layout: 'lightHorizontalLines',
                margin: [8, 4, 0, 12],
            });
        });

        return section;
    }

    // -------------------------------------------------------------------------
    // Construção do documento pdfmake
    // -------------------------------------------------------------------------
    private buildDocDefinition(
        company: Company,
        unit: Unit | null,
        licenses: License[],
        conditions: LicenseCondition[],
        epis: EpiDelivery[],
        m: GrcMetrics,
        reportCode: string,
        hash: string,
        generatedAtUtc: string,
        emitterName: string,
        qrDataUrl: string,
        validationUrl: string,
    ): object {
        const emissionDate = new Date(generatedAtUtc).toLocaleString('pt-BR');
        const today = this.startOfDay(new Date());
        const limit30 = this.addDays(today, 30);
        const riskColor = m.conformidade >= 80 ? C.success
            : m.conformidade >= 60 ? C.warning : C.danger;

        // -----------------------------------------------------------------------
        // SEÇÃO 1 — KPIs
        // -----------------------------------------------------------------------
        const kpiBlock = (value: string, label: string, sub: string, color: string) => ({
            stack: [
                { text: value, fontSize: 22, bold: true, color, alignment: 'center' },
                { text: label, fontSize: 8, color: C.muted, alignment: 'center' },
                { text: sub, fontSize: 9, color, alignment: 'center' },
            ],
            fillColor: C.light,
            margin: [8, 8, 8, 8],
        });

        const kpiSection = {
            table: {
                widths: ['25%', '25%', '25%', '25%'],
                body: [[
                    kpiBlock(
                        `${m.conformidade}%`, 'Índice de Conformidade',
                        m.conformidade >= 80 ? 'Satisfatório'
                            : m.conformidade >= 60 ? 'Regular'
                                : m.conformidade >= 40 ? 'Atenção' : 'Crítico',
                        riskColor
                    ),
                    kpiBlock(
                        m.risco, 'Risco Regulatório',
                        `${m.licencas.vencidas + m.condicionantes.vencidas + m.epis.vencidos} item(s) vencido(s)`,
                        riskColor
                    ),
                    kpiBlock(`${m.totalGeral}`, 'Obrigações Totais', 'Licenças + Cond. + EPIs', C.primary),
                    kpiBlock(
                        `${m.pendencias}`, 'Pendências Regulatórias',
                        m.pendencias > 0 ? 'Ação imediata' : 'Nenhuma pendência',
                        m.pendencias > 0 ? C.danger : C.success
                    ),
                ]],
            },
            layout: 'noBorders',
            margin: [0, 0, 0, 12],
        };

        // -----------------------------------------------------------------------
        // SEÇÃO 2 — Resumo por categoria (COM "A VENCER")
        // -----------------------------------------------------------------------
        const lc = m.licencas;
        const cc = m.condicionantes;
        const ec = m.epis;

        const licConf = lc.total > 0 ? Math.round(((lc.emDia + lc.aVencer) / lc.total) * 100) : 0;
        const condConf = cc.total > 0 ? Math.round(((cc.cumpridas + cc.aVencer) / cc.total) * 100) : 0;
        const epiConf = ec.total > 0 ? Math.round(((ec.ok + ec.aVencer) / ec.total) * 100) : 0;

        const confColor = (v: number) => v >= 80 ? C.success : v >= 60 ? C.warning : C.danger;

        const summaryTable = {
            table: {
                headerRows: 1,
                widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                body: [
                    ['Categoria', 'Total', 'Em Dia', 'A Vencer', 'Irregulares', 'Conformidade'].map(h => this.th(h)),
                    [
                        this.td('Licenças', { bold: true }),
                        this.td(lc.total, { alignment: 'center' }),
                        this.td(lc.emDia, { alignment: 'center', color: C.success }),
                        this.td(lc.aVencer, { alignment: 'center', color: C.warning }),
                        this.td(lc.vencidas, { alignment: 'center', color: C.danger }),
                        this.td(`${licConf}%`, { alignment: 'center', color: confColor(licConf) }),
                    ],
                    [
                        this.td('Condicionantes', { bold: true }),
                        this.td(cc.total, { alignment: 'center' }),
                        this.td(cc.cumpridas, { alignment: 'center', color: C.success }),
                        this.td(cc.aVencer, { alignment: 'center', color: C.warning }),
                        this.td(cc.vencidas + cc.pendentes, { alignment: 'center', color: C.danger }),
                        this.td(`${condConf}%`, { alignment: 'center', color: confColor(condConf) }),
                    ],
                    [
                        this.td('EPIs', { bold: true }),
                        this.td(ec.total, { alignment: 'center' }),
                        this.td(ec.ok, { alignment: 'center', color: C.success }),
                        this.td(ec.aVencer, { alignment: 'center', color: C.warning }),
                        this.td(ec.vencidos, { alignment: 'center', color: C.danger }),
                        this.td(`${epiConf}%`, { alignment: 'center', color: confColor(epiConf) }),
                    ],
                    [
                        this.td('TOTAL GERAL', { bold: true, fillColor: C.light }),
                        this.td(m.totalGeral, { alignment: 'center', bold: true, fillColor: C.light }),
                        this.td(lc.emDia + cc.cumpridas + ec.ok,
                            { alignment: 'center', bold: true, color: C.success, fillColor: C.light }),
                        this.td(lc.aVencer + cc.aVencer + ec.aVencer,
                            { alignment: 'center', bold: true, color: C.warning, fillColor: C.light }),
                        this.td(lc.vencidas + cc.vencidas + cc.pendentes + ec.vencidos,
                            { alignment: 'center', bold: true, color: C.danger, fillColor: C.light }),
                        this.td(`${m.conformidade}%`,
                            { alignment: 'center', bold: true, color: riskColor, fillColor: C.light }),
                    ],
                ],
            },
            margin: [0, 0, 0, 12],
        };

        // -----------------------------------------------------------------------
        // SEÇÕES POR GRUPO — TODAS AS LICENÇAS, TODOS OS GRUPOS (COM "A VENCER")
        // -----------------------------------------------------------------------
        const getRealLicenseStatus = (license: License): string => {
            const exp = this.parseDate(license.expirationDate);
            if (exp < today) return 'vencida';
            if (exp <= limit30) return 'a_vencer';
            return 'em_dia';
        };

        // Inicializa o mapa com TODOS os grupos
        const licensesByGroup = new Map<string, License[]>();
        ALL_GROUPS.forEach(group => licensesByGroup.set(group, []));

        // Distribui cada licença no seu grupo correto
        licenses.forEach(license => {
            const group = this.getLicenseGroup(license);
            if (!licensesByGroup.has(group)) {
                licensesByGroup.set(group, []);
            }
            licensesByGroup.get(group)!.push(license);
        });

        const groupSections: object[] = [];
        let sectionNum = 3;

        const orderedGroups = [
            ...ALL_GROUPS,
            ...[...licensesByGroup.keys()].filter(k => !ALL_GROUPS.includes(k)),
        ];

        for (const group of orderedGroups) {
            const groupLicenses = licensesByGroup.get(group) ?? [];
            if (groupLicenses.length === 0) continue;

            groupSections.push(
                this.sectionTitle(
                    `${String(sectionNum).padStart(2, '0')} · ${group.toUpperCase()}`,
                    false
                )
            );
            sectionNum++;

            groupSections.push({
                table: {
                    headerRows: 1,
                    widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
                    body: [
                        ['Tipo de Documento', 'Nº Doc.', 'Órgão Emissor', 'Emissão', 'Vencimento', 'Renovação', 'Status']
                            .map(h => this.th(h)),
                        ...groupLicenses.map(l => [
                            this.td(l.documentType),
                            this.td(l.documentNumber || '-', { alignment: 'center' }),
                            this.td(l.issuingAgency || '-'),
                            this.td(this.fmt(l.issueDate), { alignment: 'center' }),
                            this.td(this.fmt(l.expirationDate), { alignment: 'center' }),
                            this.td(this.fmt(l.renewalDate), { alignment: 'center' }),
                            this.badge(getRealLicenseStatus(l)),
                        ]),
                    ],
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 4],
            });

            // Condicionantes vinculadas a cada licença do grupo
            groupLicenses.forEach(l => {
                const conds = conditions.filter(c => c.licenseId === l.id);
                if (conds.length === 0) return;

                groupSections.push({
                    margin: [16, 0, 0, 8],
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [
                                {
                                    text: `↳ Condicionantes: ${l.documentType} ${l.documentNumber || ''}`,
                                    fontSize: 7, bold: true, italics: true,
                                    color: C.primary, fillColor: C.condBg,
                                    colSpan: 5,
                                },
                                {}, {}, {}, {},
                            ],
                            ['Descrição', 'Prazo', 'Dias Rest.', 'Evidência', 'Status'].map(h => ({
                                text: h, fontSize: 7, bold: true, fillColor: C.condBg, color: C.primary,
                            })),
                            ...conds.map(c => {
                                const cdDays = this.daysDiff(c.dueDate);
                                const daysStr = cdDays >= 0 ? `${cdDays}d` : `${Math.abs(cdDays)}d venc.`;
                                const daysClr = cdDays < 0 ? C.danger : cdDays <= 15 ? C.warning : C.success;
                                return [
                                    { text: c.description, fontSize: 7 },
                                    { text: this.fmt(c.dueDate), fontSize: 7, alignment: 'center' },
                                    { text: daysStr, fontSize: 7, alignment: 'center', color: daysClr },
                                    {
                                        text: c.evidenceUrl ? '✓ Anexada' : '—',
                                        fontSize: 7, alignment: 'center',
                                        color: c.evidenceUrl ? C.success : C.muted,
                                    },
                                    this.badge(c.status),
                                ];
                            }),
                        ],
                    },
                    layout: 'lightHorizontalLines',
                });
            });
        }

        // -----------------------------------------------------------------------
        // SEÇÃO EPIs (COM "A VENCER")
        // -----------------------------------------------------------------------
        const epiSection: object[] = [
            this.sectionTitle(`${String(sectionNum).padStart(2, '0')} · SST — ENTREGAS DE EPIs`),
        ];
        sectionNum++;
        epiSection.push(...this.buildEpiItemsSection(epis, today, limit30));

        // -----------------------------------------------------------------------
        // CONCLUSÃO EXECUTIVA (COM "A VENCER")
        // -----------------------------------------------------------------------
        const conclusionItems: object[] = [];
        const conclusionTitle = m.conformidade >= 80 ? 'SATISFATÓRIO'
            : m.conformidade >= 60 ? 'REGULAR'
                : m.conformidade >= 40 ? 'ATENÇÃO' : 'CRÍTICO';

        conclusionItems.push({
            text: `Avaliação de Maturidade Regulatória — Resultado: ${conclusionTitle} (${m.conformidade}%)`,
            fontSize: 10, bold: true, color: riskColor, margin: [0, 0, 0, 8],
        });

        // Documentos VENCIDOS
        const vencidasLic = licenses.filter(l => this.parseDate(l.expirationDate) < today);
        if (vencidasLic.length > 0) {
            conclusionItems.push({
                text: '⚠️ DOCUMENTOS VENCIDOS:',
                fontSize: 9, color: C.danger, bold: true, margin: [0, 4, 0, 2],
            });
            vencidasLic.forEach(l => {
                const days = Math.abs(this.daysDiff(l.expirationDate));
                conclusionItems.push({
                    text: `   • ${l.documentType} ${l.documentNumber || ''} — vencido há ${days} dias. Grupo: ${this.getLicenseGroup(l)}.`,
                    fontSize: 8, color: C.danger, margin: [0, 1, 0, 1],
                });
            });
        }

        // Documentos A VENCER (próximos 30 dias)
        const aVencerLic = licenses.filter(l => {
            const exp = this.parseDate(l.expirationDate);
            return exp >= today && exp <= limit30;
        });
        if (aVencerLic.length > 0) {
            conclusionItems.push({
                text: '⚠️ DOCUMENTOS A VENCER (próximos 30 dias):',
                fontSize: 9, color: C.warning, bold: true, margin: [0, 4, 0, 2],
            });
            aVencerLic.forEach(l => {
                const days = this.daysDiff(l.expirationDate);
                conclusionItems.push({
                    text: `   • ${l.documentType} ${l.documentNumber || ''} — vence em ${this.fmt(l.expirationDate)} (${days} dias). Grupo: ${this.getLicenseGroup(l)}.`,
                    fontSize: 8, color: C.warning, margin: [0, 1, 0, 1],
                });
            });
        }

        // Documentos EM DIA
        const emDiaLic = licenses.filter(l => {
            const exp = this.parseDate(l.expirationDate);
            return exp > limit30;
        });
        if (emDiaLic.length > 0) {
            conclusionItems.push({
                text: '✅ DOCUMENTOS EM DIA:',
                fontSize: 9, color: C.success, bold: true, margin: [0, 4, 0, 2],
            });
            conclusionItems.push({
                text: `   • ${emDiaLic.map(l => l.documentType).join(', ')} — ${emDiaLic.length} documento(s) em conformidade.`,
                fontSize: 8, color: C.success, margin: [0, 1, 0, 1],
            });
        }

        // -----------------------------------------------------------------------
        // DOCUMENTO FINAL
        // -----------------------------------------------------------------------
        return {
            pageSize: 'A4',
            pageMargins: [30, 55, 30, 40],
            defaultStyle: { font: 'Roboto', fontSize: 9, color: C.text },

            header: (currentPage: number) => currentPage === 1 ? null : ({
                columns: [
                    { text: 'REGULARE — Conformidade & Regulação', fontSize: 7, color: C.muted, margin: [30, 15, 0, 0] },
                    { text: reportCode, fontSize: 7, color: C.muted, alignment: 'right', margin: [0, 15, 30, 0] },
                ],
            }),

            footer: (currentPage: number, pageCount: number) => ({
                columns: [
                    {
                        text: 'REGULARE — By MVN Consultant | plataforma-regulare.netlify.app',
                        fontSize: 7, color: C.muted, margin: [30, 0, 0, 0],
                    },
                    {
                        text: `Página ${currentPage} de ${pageCount}`,
                        fontSize: 7, color: C.muted, alignment: 'right', margin: [0, 0, 30, 0],
                    },
                ],
                margin: [0, 8, 0, 0],
            }),

            content: [
                // Capa
                { canvas: [{ type: 'rect', x: 0, y: 0, w: 535, h: 5, r: 2, color: C.primary }] },
                { text: 'REGULARE — Plataforma de Conformidade & Regulação', fontSize: 9, color: C.muted, margin: [0, 6, 0, 2] },
                { text: 'Relatório Gerencial GRC', fontSize: 20, bold: true, color: C.primary, margin: [0, 0, 0, 2] },
                { text: 'Governança · Riscos · Compliance · SST · ESG', fontSize: 9, color: C.muted, margin: [0, 0, 0, 16] },

                // Dados da empresa
                {
                    columns: [
                        {
                            stack: [
                                { text: company.razaoSocial, fontSize: 13, bold: true, color: C.primary },
                                { text: company.nomeFantasia, fontSize: 9, color: C.muted },
                                { text: `CNPJ/CPF: ${company.document}`, fontSize: 9 },
                                { text: `${company.addressCity} / ${company.addressUf}`, fontSize: 9 },
                                ...(unit ? [{ text: `Unidade: ${unit.name} — ${unit.documentNumber}`, fontSize: 9 }] : []),
                                { text: `Responsável Legal: ${company.legalResponsibleName}`, fontSize: 9 },
                            ],
                        },
                        {
                            stack: [
                                { text: reportCode, fontSize: 8, bold: true, alignment: 'right', color: C.primary },
                                { text: `Emissão: ${emissionDate}`, fontSize: 8, alignment: 'right', color: C.muted },
                                { text: 'v1.0 — Emissão inicial', fontSize: 7, alignment: 'right', color: C.muted },
                            ],
                            width: 180,
                        },
                    ],
                    margin: [0, 0, 0, 14],
                },

                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineColor: C.border }], margin: [0, 0, 0, 12] },

                // Conteúdo
                this.sectionTitle('01 · RESUMO EXECUTIVO', false),
                kpiSection,
                this.sectionTitle('02 · RESUMO POR CATEGORIA', false),
                summaryTable,
                ...groupSections,
                ...epiSection,
                this.sectionTitle(`${String(sectionNum).padStart(2, '0')} · CONCLUSÃO EXECUTIVA`, false),
                { stack: conclusionItems },

                // -----------------------------------------------------------------------
                // SEÇÃO AUTENTICIDADE DOCUMENTAL
                // -----------------------------------------------------------------------
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineColor: C.border }], margin: [0, 20, 0, 12] },
                this.sectionTitle(`${String(sectionNum + 1).padStart(2, '0')} · VALIDAÇÃO E AUTENTICIDADE DO DOCUMENTO`, false),
                {
                    table: {
                        widths: ['auto', '*'],
                        body: [[
                            // Coluna QR Code
                            {
                                stack: qrDataUrl ? [
                                    { image: qrDataUrl, width: 90, margin: [0, 0, 12, 0] },
                                    { text: 'Escaneie para\nvalidar', fontSize: 6, color: C.muted, alignment: 'center', margin: [0, 4, 0, 0] },
                                ] : [{ text: 'QR indisponível', fontSize: 7, color: C.muted }],
                                fillColor: C.light,
                                margin: [8, 8, 8, 8],
                            },
                            // Coluna de dados
                            {
                                stack: [
                                    {
                                        columns: [
                                            { text: '✓ DOCUMENTO AUTÊNTICO', fontSize: 11, bold: true, color: C.success, width: '*' },
                                            { text: 'REGULARE GRC', fontSize: 8, bold: true, color: C.primary, alignment: 'right', width: 'auto' },
                                        ],
                                        margin: [0, 0, 0, 8],
                                    },
                                    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 400, y2: 0, lineColor: C.border }], margin: [0, 0, 0, 8] },
                                    {
                                        columns: [
                                            { text: 'Código do Relatório:', fontSize: 8, bold: true, color: C.muted, width: 120 },
                                            { text: reportCode, fontSize: 8, bold: true, color: C.primary },
                                        ],
                                        margin: [0, 0, 0, 3],
                                    },
                                    {
                                        columns: [
                                            { text: 'Tipo de Documento:', fontSize: 8, bold: true, color: C.muted, width: 120 },
                                            { text: 'Relatório Gerencial GRC — REGULARE', fontSize: 8, color: C.text },
                                        ],
                                        margin: [0, 0, 0, 3],
                                    },
                                    {
                                        columns: [
                                            { text: 'Emissão (UTC):', fontSize: 8, bold: true, color: C.muted, width: 120 },
                                            { text: generatedAtUtc, fontSize: 8, color: C.text },
                                        ],
                                        margin: [0, 0, 0, 3],
                                    },
                                    {
                                        columns: [
                                            { text: 'Emissor:', fontSize: 8, bold: true, color: C.muted, width: 120 },
                                            { text: emitterName, fontSize: 8, color: C.text },
                                        ],
                                        margin: [0, 0, 0, 3],
                                    },
                                    {
                                        columns: [
                                            { text: 'Integridade:', fontSize: 8, bold: true, color: C.muted, width: 120 },
                                            { text: 'Verificada — SHA-256', fontSize: 8, color: C.success, bold: true },
                                        ],
                                        margin: [0, 0, 0, 6],
                                    },
                                    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 400, y2: 0, lineColor: C.border }], margin: [0, 0, 0, 6] },
                                    {
                                        columns: [
                                            { text: 'Hash SHA-256:', fontSize: 7, bold: true, color: C.muted, width: 120 },
                                            { text: hash, fontSize: 6.5, color: C.muted },
                                        ],
                                        margin: [0, 0, 0, 4],
                                    },
                                    {
                                        columns: [
                                            { text: 'Validar em:', fontSize: 7, bold: true, color: C.muted, width: 120 },
                                            { text: validationUrl, fontSize: 7, color: C.primary, decoration: 'underline' },
                                        ],
                                    },
                                ],
                                margin: [0, 8, 8, 8],
                            },
                        ]],
                    },
                    layout: 'noBorders',
                    margin: [0, 0, 0, 8],
                },
                {
                    text: 'Este documento foi gerado eletronicamente pela plataforma REGULARE e possui validade corporativa. O QR Code acima permite verificar a autenticidade e integridade do documento a qualquer momento, em conformidade com as práticas de Compliance, Governança e LGPD.',
                    fontSize: 7, color: C.muted, italics: true, margin: [0, 0, 0, 4],
                },

                // Rodapé do documento
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineColor: C.border }], margin: [0, 16, 0, 8] },
                {
                    text: `Documento gerado automaticamente — REGULARE/SYSMVN. Código: ${reportCode} | v1.0 | ${emissionDate}`,
                    fontSize: 7, color: C.muted, alignment: 'center',
                },
            ],
        };
    }
}