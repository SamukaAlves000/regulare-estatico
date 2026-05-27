import { Injectable, inject } from '@angular/core';
import { BaseFirestoreService } from './base-firestore.service';
import { AuditLog, AuditAction } from '../models/audit-log.model';
import { addDoc, collection } from '@angular/fire/firestore';
import { SessionService } from './session.service';

@Injectable({ providedIn: 'root' })
export class AuditLogService extends BaseFirestoreService<any> {
  protected override collectionPath = 'audit_logs';

  private readonly ACTION_DESCRIPTIONS: Record<string, string> = {
    [AuditAction.LOGIN_SUCCESS]: 'Login realizado com sucesso',
    [AuditAction.LOGIN_ERROR]: 'Falha na tentativa de login',
    [AuditAction.LOGOUT]: 'Logout do sistema',
    [AuditAction.USER_REGISTERED]: 'Novo usuário cadastrado',
    [AuditAction.USER_REGISTER_ERROR]: 'Erro ao cadastrar novo usuário',
    
    [AuditAction.USER_CREATED]: 'Novo usuário criado pelo administrador',
    [AuditAction.USER_UPDATED]: 'Dados do usuário atualizados pelo administrador',
    [AuditAction.USER_STATUS_CHANGED]: 'Status de ativação do usuário alterado',
    [AuditAction.USER_PASSWORD_RESET_SENT]: 'E-mail de redefinição de senha enviado',
    
    [AuditAction.CARGO_CREATED]: 'Novo cargo genérico criado',
    [AuditAction.CARGO_UPDATED]: 'Cargo genérico atualizado',
    [AuditAction.CARGO_STATUS_CHANGED]: 'Status do cargo genérico alterado',

    [AuditAction.COMPANY_CREATED]: 'Nova empresa cadastrada',
    [AuditAction.COMPANY_UPDATED]: 'Dados da empresa atualizados',
    [AuditAction.COMPANY_CLIENT_CREATED]: 'Empresa e usuário cliente criados',
    [AuditAction.COMPANY_STATUS_CHANGED]: 'Status da empresa alterado',

    [AuditAction.COMPANY_CARGO_LINKED]: 'Cargo vinculado à empresa',
    [AuditAction.COMPANY_CARGO_UPDATED]: 'Cargo da empresa atualizado',
    [AuditAction.COMPANY_CARGO_DELETED]: 'Cargo desvinculado da empresa',

    [AuditAction.EMPLOYEE_CREATED]: 'Novo funcionário cadastrado',
    [AuditAction.EMPLOYEE_UPDATED]: 'Dados do funcionário atualizados',
    [AuditAction.EMPLOYEE_VIEWED]: 'Visualização de ficha de funcionário',

    [AuditAction.LICENSE_CREATED]: 'Nova licença/documento cadastrado',
    [AuditAction.LICENSE_UPDATED]: 'Licença/documento atualizado',
    [AuditAction.LICENSE_DELETED]: 'Licença/documento excluído',
    [AuditAction.LICENSE_DOCUMENT_UPLOADED]: 'Upload de documento da licença',
    [AuditAction.CONDITION_CREATED]: 'Nova condicionante cadastrada',
    [AuditAction.CONDITION_UPDATED]: 'Condicionante atualizada',
    [AuditAction.CONDITION_MARKED_AS_CUMPRIDA]: 'Condicionante marcada como cumprida',
    [AuditAction.CONDITION_DOCUMENT_UPLOADED]: 'Upload de comprovante da condicionante',

    [AuditAction.EPI_DELIVERY_CREATED]: 'Nova entrega de EPI registrada',
    [AuditAction.EPI_DELIVERY_SIGNED]: 'Entrega de EPI assinada pelo funcionário',
    [AuditAction.EPI_DELIVERY_DOCUMENT_UPLOADED]: 'Documento de comprovante de EPI enviado',
    [AuditAction.EPI_DELIVERY_TERM_DOWNLOADED]: 'Download do termo de responsabilidade de EPI',

    [AuditAction.ALERTS_GENERATED]: 'Alertas automáticos gerados pelo sistema',
    [AuditAction.DOCUMENT_GENERATED]: 'Relatório GRC gerado e registrado no sistema',
    [AuditAction.DOCUMENT_GENERATION_ERROR]: 'Erro ao gerar relatório GRC',

    [AuditAction.LGPD_TERM_CREATED]: 'Novo termo LGPD criado como rascunho',
    [AuditAction.LGPD_TERM_UPDATED]: 'Rascunho do termo LGPD atualizado',
    [AuditAction.LGPD_TERM_PUBLISHED]: 'Termo LGPD publicado',
    [AuditAction.LGPD_TERM_ACTIVATED]: 'Termo LGPD ativado como versão vigente',
    [AuditAction.LGPD_TERM_ARCHIVED]: 'Termo LGPD arquivado',
    [AuditAction.LGPD_TERM_VERSIONED]: 'Nova versão do termo LGPD criada',
    [AuditAction.LGPD_TERM_ACCEPTED]: 'Usuário aceitou os Termos LGPD',
  };

  private readonly session = inject(SessionService);

  async log(entry: Omit<AuditLog, 'id' | 'timestamp' | 'origin' | 'day' | 'month' | 'year' | 'description'> & { description?: string }): Promise<void> {
    const now = new Date();
    const actionKey = typeof entry.action === 'string' ? entry.action : entry.action;
    
    const logEntry: AuditLog = {
      ...entry,
      description: entry.description || this.ACTION_DESCRIPTIONS[actionKey] || '',
      timestamp: now.toISOString(),
      origin: 'web',
      appVersion: entry.appVersion || '',
      osVersion: entry.osVersion || '',
      day: now.getDate(),
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    };

    // Usando addDoc diretamente para gerar ID automático no Firestore
    await addDoc(collection(this.firestore, this.collectionPath), logEntry);
  }

  /**
   * Registra um log de erro
   */
  async logError(action: AuditAction | string, error: any, extraDetails?: any): Promise<void> {
    try {
      const u = this.session.user();
      
      let actionEnum = action;
      if (typeof action === 'string' && !action.endsWith('_error')) {
        // Tentar mapear para enum de erro se vier como string simples
        const errorActionName = `${action.toUpperCase()}_ERROR`;
        if (errorActionName in AuditAction) {
          actionEnum = (AuditAction as any)[errorActionName];
        }
      }

      await this.log({
        action: actionEnum,
        appVersion: '',
        osVersion: '',
        user_profile: u?.profile || 'UNKNOWN',
        userEmail: u?.email || 'N/A',
        userId: u?.id || 'N/A',
        details: {
          errorMessage: error?.message || String(error),
          errorStack: error?.stack,
          ...extraDetails
        }
      });
    } catch (e) {
      console.error('Critical failure in AuditLogService.logError:', e);
    }
  }
}
