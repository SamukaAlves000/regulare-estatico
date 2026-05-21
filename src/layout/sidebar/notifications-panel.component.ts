import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { CompaniesService } from '../../modules/cadastros/services/companies.service';
import { LicenseDialogComponent } from '../../modules/licencas/components/license-dialog.component';
import { EpiDeliveryDialogComponent } from '../../modules/epis/epi-delivery-dialog/epi-delivery-dialog.component';
import { ConditionDialogComponent } from '../../modules/licencas/components/condition-dialog.component';
import { AlertsService, AlertNotification } from '../../core/services/alerts.service';

@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatListModule, MatIconModule, MatButtonModule],
  template: `
    <div class="panel-container">
      <div class="panel-header">
        <h2>Notificações</h2>
        <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
      </div>

      <mat-nav-list class="notifications-list">
        <div *ngIf="alertsService.count() === 0" class="empty-state">
          <mat-icon>notifications_none</mat-icon>
          <p>Nenhuma notificação recente</p>
        </div>

        <mat-list-item *ngFor="let alert of alertsService.alerts(); trackBy: trackByFn" class="notification-item" (click)="openAlertDetail(alert)">
          <mat-icon matListItemIcon [color]="alert.origemTipo === 'epi' ? 'accent' : 'primary'">
            {{ alert.origemTipo === 'epi' ? 'engineering' : 'description' }}
          </mat-icon>
          <div matListItemTitle class="alert-title">{{ alert.documento }}</div>
          <div matListItemLine class="alert-subtitle">
            {{ alert.companyName }}
          </div>
          <div matListItemLine class="alert-date">
            {{ alert.enviadoEm.toDate() | date:'dd/MM/yyyy HH:mm' }}
          </div>
        </mat-list-item>
      </mat-nav-list>
    </div>
  `,
  styles: [`
    .panel-container { height: 100vh; display: flex; flex-direction: column; width: 350px; background: white; }
    .panel-header { padding: 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; }
    .panel-header h2 { margin: 0; font-size: 1.2rem; }
    .notifications-list { flex: 1; overflow-y: auto; }
    .notification-item { border-bottom: 1px solid #f9f9f9; height: auto !important; padding: 12px 0; }
    .alert-title { font-weight: 600; white-space: normal; line-height: 1.2; font-size: 0.9rem; }
    .alert-subtitle { font-size: 0.8rem; color: #666; margin-top: 4px; }
    .alert-date { font-size: 0.75rem; color: #999; }
    .empty-state { text-align: center; padding: 40px 20px; color: #ccc; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; }
  `]
})
export class NotificationsPanelComponent { 
  public readonly alertsService = inject(AlertsService);
  private readonly dialogRef = inject(MatDialogRef);
  private readonly dialog = inject(MatDialog);
  private readonly firestore = inject(Firestore);
  private readonly companiesService = inject(CompaniesService);

  close() { this.dialogRef.close(); }

  trackByFn(index: number, item: AlertNotification) { return item.id; }

  async openAlertDetail(alert: AlertNotification) {
    if (!alert.origemId) return;

    this.close(); // Fecha o painel de notificações

    try {
      let dialogComponent: any;
      let dialogData: any = {};
      let config = { width: '900px', maxWidth: '95vw', disableClose: true };

      const originType = alert.origemTipo;

      if (originType === 'epi') {
        const docRef = doc(this.firestore, 'epi_deliveries', alert.origemId);
        const sn = await getDoc(docRef);
        if (!sn.exists()) throw new Error('Entrega de EPI não encontrada');
        
        dialogComponent = EpiDeliveryDialogComponent;
        dialogData = { ...sn.data(), id: sn.id };

      } else if (originType === 'licenca') {
        const docRef = doc(this.firestore, 'licenses', alert.origemId);
        const sn = await getDoc(docRef);
        if (!sn.exists()) throw new Error('Licença não encontrada');
        
        const companies = await this.companiesService.listCompanies();
        
        dialogComponent = LicenseDialogComponent;
        dialogData = { ...sn.data(), id: sn.id, isEdit: true, companies };

      } else if (originType === 'condicionante') {
        const docRef = doc(this.firestore, 'licenseConditions', alert.origemId);
        const sn = await getDoc(docRef);
        if (!sn.exists()) throw new Error('Condicionante não encontrada');
        
        dialogComponent = ConditionDialogComponent;
        dialogData = { ...sn.data(), id: sn.id, isEdit: true };
        config.width = '600px';
      }

      if (dialogComponent) {
        this.dialog.open(dialogComponent, { ...config, data: dialogData });
      }
    } catch (err) {
      console.error('Erro ao abrir detalhe do alerta:', err);
      // Opcional: exibir um snackbar para o usuário informando o erro
    }
  }
}