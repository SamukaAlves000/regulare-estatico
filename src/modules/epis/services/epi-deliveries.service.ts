import { Injectable, inject } from '@angular/core';
import { EpiDeliveriesRepository } from '../repositories/epi-deliveries.repository';
import { EpiDelivery } from '../models/epi-delivery.model';
import { SessionService } from '../../../core/services/session.service';
import { UsersRepository } from '../../../core/services/users.repository';
import { AuditUser } from '../../cadastros/models/company.model';
import { AlertsService } from '../../alertas/services/alerts.service';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';
import { UnitsRepository } from '../../cadastros/repositories/units.repository';
import { SectorsFiltersRepository } from '../../cadastros/repositories/sectors-filters.repository';
import { EmployeesRepository } from '../../cadastros/repositories/employees.repository';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditAction } from '../../../core/models/audit-log.model';

function makeId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function buildDiff(
  current: Partial<EpiDelivery> | null,
  patch: Partial<EpiDelivery>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as (keyof EpiDelivery)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    const prev = current?.[key];
    const hasChanged =
      next !== null && typeof next === 'object'
        ? JSON.stringify(prev) !== JSON.stringify(next)
        : prev !== next;
    if (hasChanged) {
      diff[key] = { from: prev, to: next };
    }
  }
  return diff;
}

@Injectable({ providedIn: 'root' })
export class EpiDeliveriesService {
  private readonly repo = inject(EpiDeliveriesRepository);
  private readonly session = inject(SessionService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly alerts = inject(AlertsService);
  private readonly companiesRepo = inject(CompaniesRepository);
  private readonly unitsRepo = inject(UnitsRepository);
  private readonly sectorsRepo = inject(SectorsFiltersRepository);
  private readonly employeesRepo = inject(EmployeesRepository);
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
      unitName: input.unitName,
      sectorName: input.sectorName,
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

    const before = await this.getDelivery(id);
    const diff = buildDiff(before, patch);

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
          details: { deliveryId: id, changes: diff }
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

  async downloadTermById(id: string): Promise<void> {
    // Buscar dados da entrega
    const delivery = await this.getDelivery(id);
    if (!delivery) {
      throw new Error('Entrega não encontrada');
    }

    // Buscar dados relacionados usando repositórios injetados
    const company = await this.companiesRepo.get(delivery.companyId);
    const unit = delivery.unitId ? await this.unitsRepo.get(delivery.unitId) : null;
    const sector = delivery.sectorId ? await this.sectorsRepo.get(delivery.sectorId) : null;
    
    // Buscar dados completos do funcionário (com CPF)
    let employee: any = null;
    if (delivery.employeeId) {
      employee = await this.employeesRepo.get(delivery.employeeId);
    }
    
    // Se não encontrar o funcionário pelo ID, usar os dados do próprio delivery
    const emp = employee || delivery;

    const cpf = emp.cpf || (delivery as any).employeeCpf || 'N/A';
    const esocial = (emp as any).esocialRegistration || (delivery as any).employeeEsocialRegistration || 'N/A';
    const admission = (emp as any).admissionDate || (delivery as any).employeeAdmissionDate;
    const cnpj = company?.document || company?.cnpj || (delivery as any).companyCnpj || 'N/A';

    // Imports dinâmicos necessários para geração do PDF
    const { default: pdfMake } = await import('pdfmake/build/pdfmake');
    const pdfFonts = await import('pdfmake/build/vfs_fonts');
    (pdfMake as any).vfs = (pdfFonts as any).pdfMake ? (pdfFonts as any).pdfMake.vfs : (pdfFonts as any).vfs;
    const QRCode = (await import('qrcode')).default;

    // Carregar assinatura se existir
    let signatureBase64 = null;
    let qrCodeBase64 = null;

    if (delivery.signed && delivery.signatureUrl) {
      try {
        // Importar Storage do Firebase
        const { getStorage, ref, getBytes } = await import('@angular/fire/storage');
        const storage = getStorage();
        
        const url = delivery.signatureUrl;
        if (url.includes('firebasestorage.googleapis.com')) {
          const match = url.match(/\/o\/(.+?)\?/);
          if (match && match[1]) {
            const storagePath = decodeURIComponent(match[1]);
            const storageRef = ref(storage, storagePath);
            const bytes = await getBytes(storageRef);
            
            const bytesArr = new Uint8Array(bytes);
            const CHUNK_SIZE = 0x8000;
            let binary = '';
            for (let i = 0; i < bytesArr.length; i += CHUNK_SIZE) {
              binary += String.fromCharCode.apply(null, Array.from(bytesArr.subarray(i, i + CHUNK_SIZE)));
            }
            signatureBase64 = 'data:image/png;base64,' + btoa(binary);
          }
        }
      } catch (error) {
        console.error('Erro ao converter assinatura para Base64:', error);
      }
    }

    // Gerar QR Code
    const signatureLink = `${window.location.origin}/assinatura/${delivery.id}`;
    if (signatureLink) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(signatureLink, {
          width: 150,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
      } catch (err) {
        console.error('Erro ao gerar QR Code para o PDF:', err);
      }
    }

    const formatDate = (dateStr: string): string => {
      if (!dateStr) return 'N/A';
      try {
        const date = new Date(dateStr);
        date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
        return date.toLocaleDateString('pt-BR');
      } catch (e) {
        return dateStr;
      }
    };

    const formatDateTime = (dateStr: string | undefined): string => {
      if (!dateStr) return '____ / ____ / ______';
      try {
        const date = new Date(dateStr);
        return date.toLocaleString('pt-BR');
      } catch (e) {
        return dateStr;
      }
    };

    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      content: [
        {
          text: 'TERMO DE ENTREGA, ORIENTAÇÃO E RESPONSABILIDADE PELO USO DE EPI',
          style: 'header',
          alignment: 'center'
        },
        {
          text: 'Art. 166 e Art. 158 da CLT – NR-06 – NR-01 / GRO / PGR',
          style: 'subheader',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },

        {
          stack: [
            { text: `Nome do empregado: ${delivery.employeeName}` },
            { text: `CPF: ${cpf}` },
            { text: `Matrícula eSocial: ${esocial}` },
            { text: `Data de Admissão: ${formatDate(admission)}` },
            { text: `Cargo: ${delivery.cargoName || 'N/A'}` },
            { text: `CBO: ${delivery.cargoCbo || 'N/A'}` },
            { text: `Empresa: ${company?.razaoSocial || company?.name || (delivery as any).companyName || delivery.companyId}` },
            { text: `CNPJ: ${cnpj}` },
            { text: `Unidade: ${unit?.name || (delivery as any).unitName || delivery.unitId}` },
            { text: `Setor: ${sector?.name || (delivery as any).sectorName || delivery.sectorId}` },
            { text: `Data da entrega: ${formatDate(delivery.deliveryDate)}` },
          ],
          margin: [0, 0, 0, 20]
        },

        {
          text: 'DECLARAÇÃO DE ENTREGA E ORIENTAÇÃO',
          style: 'sectionTitle',
          margin: [0, 10, 0, 5]
        },
        {
          text: 'Declaro que recebi gratuitamente da empresa os Equipamentos de Proteção Individual (EPIs) abaixo relacionados, adequados aos riscos das atividades por mim desempenhadas, conforme avaliação realizada no Programa de Gerenciamento de Riscos (PGR), em conformidade com o disposto no Art. 166 da Consolidação das Leis do Trabalho (CLT) e na Norma Regulamentadora nº 06 (NR-06).',
          alignment: 'justify',
          margin: [0, 0, 0, 10]
        },
        {
          text: 'Declaro também que recebi orientação quanto ao uso correto, limitações de proteção, guarda, conservação, higienização e obrigatoriedade de utilização dos EPIs durante a jornada de trabalho.',
          alignment: 'justify',
          margin: [0, 0, 0, 20]
        },

        {
          text: 'REGISTRO DE ENTREGA DE EPIs',
          style: 'sectionTitle',
          margin: [0, 0, 0, 5]
        },
        {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              [
                { text: 'Data Entrega', style: 'tableHeader' },
                { text: 'Qtd', style: 'tableHeader' },
                { text: 'Descrição do EPI', style: 'tableHeader' },
                { text: 'Fabricante', style: 'tableHeader' },
                { text: 'Nº CA', style: 'tableHeader' },
                { text: 'Validade CA', style: 'tableHeader' },
                { text: 'Tamanho', style: 'tableHeader' },
                { text: 'Nota Fiscal/Ano', style: 'tableHeader' },
              ],
              ...(delivery.items || []).map(item => [
                formatDate(delivery.deliveryDate),
                item.quantity?.toString() || '1',
                item.name,
                item.manufacturer || 'N/A',
                item.certificationNumber || 'N/A',
                item.validUntil ? item.validUntil : 'N/A',
                item.epiSize || 'N/A',
                item.invoiceNumber || 'N/A',
              ])
            ]
          },
          margin: [0, 0, 0, 20]
        },

        {
          text: 'RESPONSABILIDADES DO TRABALHADOR',
          style: 'sectionTitle',
          margin: [0, 0, 0, 5]
        },
        {
          text: 'Nos termos da NR-06 e do Art. 158 da CLT, comprometo-me a:',
          margin: [0, 0, 0, 5]
        },
        {
          ul: [
            'Utilizar os EPIs apenas para a finalidade a que se destinam.',
            'Utilizar corretamente os equipamentos fornecidos.',
            'Zelar pela guarda e conservação dos equipamentos.',
            'Comunicar imediatamente qualquer dano ou perda.',
            'Devolver os equipamentos substituídos ou quando solicitado.'
          ],
          margin: [0, 0, 0, 10]
        },
        {
          text: 'Estou ciente de que a recusa injustificada ao uso de Equipamento de Proteção Individual poderá caracterizar ato de indisciplina nos termos do Art. 482 da CLT.',
          alignment: 'justify',
          margin: [0, 0, 0, 20]
        },

        {
          text: 'DECLARAÇÃO FINAL',
          style: 'sectionTitle',
          margin: [0, 0, 0, 5]
        },
        {
          text: 'Declaro que recebi os Equipamentos de Proteção Individual acima descritos, que fui devidamente orientado quanto ao seu uso correto e que estou ciente das minhas responsabilidades quanto à sua utilização, conservação e comunicação de eventuais irregularidades.',
          alignment: 'justify',
          margin: [0, 0, 0, 20]
        },

        // --- Seção: Assinatura do Empregado ---
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    { text: 'IDENTIFICAÇÃO E ASSINATURA DO EMPREGADO', bold: true, fontSize: 10, margin: [0, 0, 0, 10] },
                    {
                      columns: [
                        { 
                          text: `Data: ${delivery.signed ? formatDateTime(delivery.signatureDate) : '____ / ____ / ______'}`, 
                          margin: [0, 0, 0, 10] 
                        }
                      ]
                    },
                    // Se estiver assinado e o base64 estiver disponível, mostra a imagem da assinatura, caso contrário mostra a linha para assinatura manual
                    delivery.signed && signatureBase64 ? 
                    {
                      image: 'signatureImage',
                      width: 200,
                      alignment: 'center',
                      margin: [0, 10, 0, 5]
                    } :
                    { text: '________________________________________________________________________', alignment: 'center', margin: [0, 20, 0, 0] },
                    
                    { text: `Assinatura do Empregado: ${delivery.employeeName}`, alignment: 'center', fontSize: 9 }
                  ],
                  margin: [5, 5, 5, 5]
                }
              ]
            ]
          },
          margin: [0, 0, 0, 15]
        },

        // --- Seção: Autenticidade Digital (QR Code e Texto Legal) ---
        delivery.signed && qrCodeBase64 ? {
          columns: [
            {
              image: 'qrCodeImage',
              width: 60,
              alignment: 'left'
            },
            {
              stack: [
                {
                  text: `Documento assinado eletronicamente por ${delivery.employeeName} em ${formatDateTime(delivery.signatureDate)}.`,
                  fontSize: 8,
                  bold: true,
                  margin: [0, 5, 0, 2]
                },
                {
                  text: 'A Lei nº 14.063/2020, de 23 de setembro de 2020.',
                  fontSize: 8,
                  margin: [0, 0, 0, 2]
                },
                {
                  text: [
                    { text: 'Verifique a autenticidade deste documento em: ', fontSize: 8 },
                    { text: signatureLink, fontSize: 8, color: '#1565c0', decoration: 'underline' }
                  ]
                }
              ],
              margin: [10, 0, 0, 0]
            }
          ],
          margin: [0, 0, 0, 20]
        } : {},

      ],
      footer: (currentPage: number, pageCount: number) => {
        const creator = (delivery as any).createdBy?.name || 'Sistema';
        const deliveryDateStr = formatDate(delivery.deliveryDate);
        return {
          stack: [
            {
              text: `Entregue por: ${creator} |  Data de entrega: ${deliveryDateStr} | Gerado automaticamente pelo sistema de gestão de EPIs.`,
              alignment: 'center',
              fontSize: 8,
              color: '#666'
            },
            {
              text: `Data de geração: ${new Date().toLocaleString()} - Página ${currentPage} de ${pageCount}`,
              alignment: 'center',
              fontSize: 8,
              color: '#666'
            }
          ],
          margin: [0, 20, 0, 0]
        };
      },
      images: {
        ...(signatureBase64 ? { signatureImage: signatureBase64 } : {}),
        ...(qrCodeBase64 ? { qrCodeImage: qrCodeBase64 } : {})
      },
      styles: {
        header: {
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 5]
        },
        subheader: {
          fontSize: 10,
          bold: false
        },
        sectionTitle: {
          fontSize: 11,
          bold: true,
          decoration: 'underline'
        },
        tableHeader: {
          bold: true,
          fontSize: 9,
          color: 'black',
          fillColor: '#eeeeee'
        }
      },
      defaultStyle: {
        fontSize: 10
      }
    };

    const fileName = `termo_epi_${(delivery.employeeName || 'entrega').replace(/\s+/g, '_')}.pdf`;
    pdfMake.createPdf(docDefinition).download(fileName);

    // Log do download
    await this.logDownloadTerm(id);

    // Pequeno delay para garantir que o download foi iniciado
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 500);
    });
  }
}
