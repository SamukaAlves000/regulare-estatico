import { Injectable, inject, effect } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SessionService } from '../../../core/services/session.service';
import { LgpdTermsService } from './lgpd-terms.service';
import { LgpdAcceptDialogComponent } from '../components/lgpd-accept-dialog.component';
import { LgpdTerm } from '../../../core/models/lgpd-term.model';
import { User } from '../../../core/models/user.model';

@Injectable({ providedIn: 'root' })
export class LgpdEnforcerService {
  private readonly session = inject(SessionService);
  private readonly lgpd    = inject(LgpdTermsService);
  private readonly dialog  = inject(MatDialog);

  private enforcedForUserId: string | null = null;

  constructor() {
    effect(() => {
      const user = this.session.user();
      if (!user || user.profile !== 'CLIENTE') return;
      if (this.enforcedForUserId === user.id) return;
      this.enforcedForUserId = user.id;
      this.checkAndEnforce(user);
    });
  }

  private async checkAndEnforce(user: User): Promise<void> {
    try {
      const activeTerm = await this.lgpd.getActive();
      if (!activeTerm) {
        console.info('[LgpdEnforcer] Nenhum termo LGPD ativo encontrado — aceite não exigido.');
        return;
      }
      const hasAccepted = await this.lgpd.hasUserAcceptedActiveTerm(user.id, activeTerm.id);
      if (hasAccepted) {
        console.info(`[LgpdEnforcer] Usuário já aceitou o termo ${activeTerm.version}.`);
        return;
      }
      console.info(`[LgpdEnforcer] Exibindo modal de aceite para o termo ${activeTerm.version}.`);
      this.openAcceptDialog(activeTerm, user);
    } catch (e) {
      console.error('[LgpdEnforcer] Erro ao verificar aceite LGPD — verifique as regras do Firestore:', e);
    }
  }

  private openAcceptDialog(term: LgpdTerm, user: User): void {
    this.dialog.open(LgpdAcceptDialogComponent, {
      data:         { term, user, viewOnly: false },
      disableClose: true,
      width:        '720px',
      maxWidth:     '95vw',
      maxHeight:    '92vh',
    });
  }
}