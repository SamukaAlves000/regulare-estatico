import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { EpiDeliveriesService } from '../services/epi-deliveries.service';

@Component({
  selector: 'app-relatorio-entrega-epi',
  standalone: true,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatIconModule,
  ],
  template: `
    <div class="container">
      <div class="card">
        <ng-container *ngIf="loading">
          <mat-spinner diameter="50" class="spinner"></mat-spinner>
          <h2>Gerando termo de entrega...</h2>
          <p>Aguarde enquanto preparamos o documento para download.</p>
        </ng-container>
        
        <ng-container *ngIf="!loading && downloaded && !error">
          <div class="success-icon">
            <mat-icon>check_circle</mat-icon>
          </div>
          <h2>Download concluído!</h2>
          <p>O termo de entrega de EPI foi baixado com sucesso.</p>
          <p class="hint">Verifique a pasta de downloads do seu navegador.</p>
          
          <div class="actions">
            <button class="btn-secondary" (click)="downloadAgain()">
              <mat-icon>refresh</mat-icon>
              Baixar novamente
            </button>
            <button class="btn-primary" (click)="goHome()">
              <mat-icon>home</mat-icon>
              Voltar ao início
            </button>
          </div>
        </ng-container>
        
        <ng-container *ngIf="!loading && error">
          <div class="error-icon">
            <mat-icon>error</mat-icon>
          </div>
          <h2>Erro ao gerar documento</h2>
          <p>{{ error }}</p>
          
          <div class="actions">
            <button class="btn-primary" (click)="retry()">
              <mat-icon>refresh</mat-icon>
              Tentar novamente
            </button>
            <button class="btn-secondary" (click)="goHome()">
              <mat-icon>home</mat-icon>
              Voltar ao início
            </button>
          </div>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: #f5f5f5;
      padding: 20px;
    }

    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      max-width: 450px;
      width: 100%;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    .spinner {
      margin: 0 auto 24px;
    }

    h2 {
      color: #333;
      margin: 0 0 12px;
      font-size: 24px;
      font-weight: 600;
    }

    p {
      color: #666;
      margin: 0 0 8px;
      font-size: 16px;
    }

    .hint {
      color: #999;
      font-size: 14px;
    }

    .success-icon {
      margin-bottom: 20px;
      
      mat-icon {
        font-size: 72px;
        width: 72px;
        height: 72px;
        color: #4caf50;
      }
    }

    .error-icon {
      margin-bottom: 20px;
      
      mat-icon {
        font-size: 72px;
        width: 72px;
        height: 72px;
        color: #f44336;
      }
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 32px;
      flex-wrap: wrap;
    }

    button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .btn-primary {
      background: #1976d2;
      color: white;

      &:hover {
        background: #1565c0;
      }
    }

    .btn-secondary {
      background: #f5f5f5;
      color: #333;

      &:hover {
        background: #e0e0e0;
      }
    }
  `]
})
export class RelatorioEntregaEpiComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly epiDeliveriesService = inject(EpiDeliveriesService);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  downloaded = false;
  error: string | null = null;
  private entregaId: string | null = null;

  ngOnInit() {
    this.entregaId = this.route.snapshot.paramMap.get('entregaId');
    
    if (!this.entregaId) {
      this.loading = false;
      this.error = 'ID da entrega não encontrado na URL';
      this.cdr.markForCheck();
      return;
    }

    this.generateReport();
  }

  generateReport() {
    if (!this.entregaId) return;

    this.loading = true;
    this.downloaded = false;
    this.error = null;
    this.cdr.markForCheck();

    // Timeout de 30 segundos para evitar loop infinito
    const timeoutId = setTimeout(() => {
      this.loading = false;
      this.error = 'Tempo limite excedido. Tente novamente.';
      this.cdr.markForCheck();
    }, 30000);

    this.epiDeliveriesService.downloadTermById(this.entregaId)
      .then(() => {
        clearTimeout(timeoutId);
        this.downloaded = true;
        this.cdr.markForCheck();
      })
      .catch((err: any) => {
        clearTimeout(timeoutId);
        console.error('Erro ao gerar relatório:', err);
        this.error = err?.message || 'Erro ao gerar o termo de entrega. Verifique se a entrega existe.';
        this.cdr.markForCheck();
      })
      .finally(() => {
        clearTimeout(timeoutId);
        this.loading = false;
        this.cdr.markForCheck();
      });
  }

  downloadAgain() {
    if (this.entregaId) {
      this.generateReport();
    }
  }

  retry() {
    this.generateReport();
  }

  goHome() {
    this.router.navigate(['/login']);
  }
}