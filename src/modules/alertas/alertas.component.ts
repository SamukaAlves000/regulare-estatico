import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { AlertsService } from './services/alerts.service';
import { SessionService } from '../../core/services/session.service';
import { Alert, AlertGroup } from './models/alert.model';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-alertas',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatMenuModule,
    MatDialogModule,
    MatButtonModule,
    MatPaginatorModule,
  ],
  templateUrl: './alertas.component.html',
  styleUrls: ['./alertas.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertasComponent {
  private readonly alertsService = inject(AlertsService);
  private readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);

  pageIndex = 0;
  readonly pageSize = 30;

  // Combina o perfil do usuário e o escopo selecionado (para ADMIN) para filtrar os alertas
  alertsList$: Observable<AlertGroup[]> = toObservable(computed(() => {
    const user = this.session.user();
    if (!user) return { companyId: null, profile: null };
    
    // Se for ADMIN, respeita o escopo selecionado na Topbar
    if (user.profile === 'ADMIN') {
      return { companyId: this.session.adminScopeCompanyId(), profile: 'ADMIN' };
    }
    
    // Se for CLIENTE ou CONSULTOR, usa a empresa do próprio usuário
    return { companyId: user.companyId, profile: user.profile };
  })).pipe(
    switchMap(scope => {
      if (scope.profile === 'ADMIN') {
        // Se ADMIN selecionou uma empresa específica
        if (scope.companyId) {
          return this.alertsService.listByCompany(scope.companyId);
        }
        // Se ADMIN não selecionou empresa (vê todas)
        return this.alertsService.listAll();
      }
      
      // Para CLIENTE/CONSULTOR
      if (scope.companyId) {
        return this.alertsService.listByCompany(scope.companyId);
      }
      
      return of([]);
    }),
    map(alerts => this.groupAlerts(alerts || [])),
    tap(() => this.pageIndex = 0)
  );
  
  private groupAlerts(alerts: Alert[]): AlertGroup[] {
    const groups = new Map<string, AlertGroup>();

    alerts.forEach(alert => {
      const key = `${alert.origemId}_${alert.origemTipo}`;
      if (!groups.has(key)) {
        groups.set(key, {
          origemId: alert.origemId,
          origemTipo: alert.origemTipo,
          documento: alert.documento,
          companyName: alert.companyName,
          dataBaseVencimento: alert.dataBaseVencimento,
          alertas: [],
          dataMaisProxima: alert.dataDisparo // Provisório
        });
      }

      const group = groups.get(key)!;
      group.alertas.push({
        offsetDias: alert.offsetDias,
        dataDisparo: alert.dataDisparo,
        enviado: alert.enviado
      });
    });

    return Array.from(groups.values()).map(group => {
      // Ordenar alertas internos por dataDisparo crescente
      group.alertas.sort((a, b) => new Date(a.dataDisparo).getTime() - new Date(b.dataDisparo).getTime());

      // dataMaisProxima: menor dataDisparo de todos os alertas
      group.dataMaisProxima = group.alertas[0].dataDisparo;

      // proximoAlerta: alerta mais próximo com enviado = false
      group.proximoAlerta = group.alertas.find(a => !a.enviado);

      return group;
    }).sort((a, b) => new Date(a.dataMaisProxima).getTime() - new Date(b.dataMaisProxima).getTime());
  }
  
  // Colunas a serem exibidas na tabela
  get displayedColumns(): string[] {
    const cols = ['origemTipo', 'companyName', 'documento', 'dataBaseVencimento', 'proximoAlerta', 'antecedencias'];
    if (!this.isAdmin()) {
      return cols.filter(c => c !== 'companyName');
    }
    return cols;
  }

  isAdmin(): boolean {
    return this.session.hasRole(['ADMIN']);
  }

  getOrigemLabel(tipo: string): string {
    switch (tipo) {
      case 'licenca': return 'Licença';
      case 'condicionante': return 'Condicionante';
      case 'epi': return 'EPI';
      default: return tipo;
    }
  }

  getOrigemClass(tipo: string): string {
    return `tipo-${tipo}`;
  }

  getDiasRestantes(dataDisparo: string): number {
    if (!dataDisparo) return 0;
    const base = new Date(dataDisparo);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    // Calcula diferença em relação à data atual (hoje)
    const diffTime = base.getTime() - hoje.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  onPageChange(e: PageEvent): void {
    this.pageIndex = e.pageIndex;
  }

  openAlertSummary(group: AlertGroup) {
    this.dialog.open(AlertSummaryDialogComponent, {
      data: group,
      width: '500px'
    });
  }
}

@Component({
  selector: 'app-alert-summary-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatIconModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Resumo de Alertas - {{ data.documento }}</h2>
    <mat-dialog-content>
      <div class="summary-info">
        <p><strong>Tipo:</strong> {{ getOrigemLabel(data.origemTipo) }}</p>
        <p><strong>Vencimento:</strong> {{ data.dataBaseVencimento | date:'dd/MM/yyyy' }}</p>
      </div>
      
      <table mat-table [dataSource]="data.alertas" class="full-width-table">
        <ng-container matColumnDef="offset">
          <th mat-header-cell *matHeaderCellDef>Antecedência</th>
          <td mat-cell *matCellDef="let alert">{{ alert.offsetDias === 0 ? 'No dia' : alert.offsetDias + ' dias' }}</td>
        </ng-container>

        <ng-container matColumnDef="dataDisparo">
          <th mat-header-cell *matHeaderCellDef>Data Alerta</th>
          <td mat-cell *matCellDef="let alert">{{ alert.dataDisparo | date:'dd/MM/yyyy HH:mm' }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let alert">
            <span class="status-badge" [ngClass]="alert.enviado ? 'enviado' : 'pendente'">
              {{ alert.enviado ? 'Enviado' : 'Pendente' }}
            </span>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="['offset', 'dataDisparo', 'status']"></tr>
        <tr mat-row *matRowDef="let row; columns: ['offset', 'dataDisparo', 'status'];"></tr>
      </table>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .summary-info { margin-bottom: 20px; }
    .status-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .status-badge.enviado { background: #e8f5e9; color: #2e7d32; }
    .status-badge.pendente { background: #fff3e0; color: #ef6c00; }
    .full-width-table { width: 100%; }
  `]
})
export class AlertSummaryDialogComponent {
  private readonly session = inject(SessionService);
  public readonly data: AlertGroup = inject(MAT_DIALOG_DATA);

  getOrigemLabel(tipo: string): string {
    switch (tipo) {
      case 'licenca': return 'Licença';
      case 'condicionante': return 'Condicionante';
      case 'epi': return 'EPI';
      default: return tipo;
    }
  }
}
