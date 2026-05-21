import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MatDialogModule, MatDialogRef, MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { LgpdTermsService } from '../services/lgpd-terms.service';
import { LgpdTerm } from '../../../core/models/lgpd-term.model';
import { User } from '../../../core/models/user.model';

export interface LgpdAcceptDialogData {
  term: LgpdTerm;
  user: User | null;
  viewOnly?: boolean;
}

@Component({
  selector: 'app-lgpd-accept-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lgpd-accept-wrap">

      <!-- Header -->
      <div class="lad-header">
        <mat-icon class="lad-shield">shield</mat-icon>
        <div class="lad-header-text">
          <h2 class="lad-title">{{ data.term.title }}</h2>
          <div class="lad-meta">
            <span class="lad-version">{{ data.term.version }}</span>
            <span class="lad-sep">·</span>
            <span>Publicado em {{ fmtDate(data.term.publishedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Content -->
      <mat-dialog-content class="lad-content">
        <div class="lad-body" [innerHTML]="data.term.content"></div>
      </mat-dialog-content>

      <!-- Actions — accept mode -->
      <mat-dialog-actions *ngIf="!data.viewOnly" class="lad-actions">
        <mat-checkbox [(ngModel)]="agreed" color="primary" class="lad-check">
          Li e concordo com os Termos LGPD
        </mat-checkbox>
        <button
          mat-flat-button
          color="primary"
          class="lad-btn"
          [disabled]="!agreed || saving()"
          (click)="accept()"
        >
          <mat-spinner *ngIf="saving()" diameter="18"></mat-spinner>
          <span *ngIf="!saving()">Aceitar Termos</span>
        </button>
        <p *ngIf="error()" class="lad-err">{{ error() }}</p>
      </mat-dialog-actions>

      <!-- Actions — view only (admin) -->
      <mat-dialog-actions *ngIf="data.viewOnly" class="lad-actions lad-actions--end">
        <button mat-stroked-button mat-dialog-close>Fechar</button>
      </mat-dialog-actions>

    </div>
  `,
  styles: [`
    .lgpd-accept-wrap { display: flex; flex-direction: column; }

    .lad-header {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 24px 24px 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    .lad-shield { font-size: 32px; width: 32px; height: 32px; color: #1a3c5e; flex-shrink: 0; margin-top: 2px; }
    .lad-header-text { flex: 1; }
    .lad-title { margin: 0 0 6px; font-size: 1.05rem; font-weight: 700; color: #1a3c5e; }
    .lad-meta { display: flex; align-items: center; gap: 8px; font-size: .8rem; color: #7f8c8d; }
    .lad-version {
      background: #eaf0f6; color: #1a3c5e;
      border-radius: 10px; padding: 2px 8px; font-weight: 600; font-size: .75rem;
    }
    .lad-sep { color: #ccc; }

    .lad-content {
      overflow-y: auto !important;
      max-height: 52vh;
      padding: 16px 24px !important;
    }

    .lad-body {
      font-size: .88rem;
      line-height: 1.75;
      color: #2c3e50;
    }
    :host ::ng-deep .lad-body h1,
    :host ::ng-deep .lad-body h2,
    :host ::ng-deep .lad-body h3 { color: #1a3c5e; margin-top: 1.2em; }
    :host ::ng-deep .lad-body p { margin: .5em 0; }
    :host ::ng-deep .lad-body ul,
    :host ::ng-deep .lad-body ol { padding-left: 1.5em; }
    :host ::ng-deep .lad-body strong { color: #1a3c5e; }

    .lad-actions {
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 10px;
      padding: 16px 24px !important;
      border-top: 1px solid #e0e0e0;
    }
    .lad-actions--end {
      flex-direction: row !important;
      justify-content: flex-end !important;
    }

    .lad-check { font-size: .9rem; }

    .lad-btn { height: 44px; font-weight: 600; }

    .lad-err { margin: 0; color: #c0392b; font-size: .82rem; text-align: center; }
  `],
})
export class LgpdAcceptDialogComponent {
  readonly data      = inject<LgpdAcceptDialogData>(MAT_DIALOG_DATA);
  private readonly lgpd      = inject(LgpdTermsService);
  private readonly dialogRef = inject(MatDialogRef<LgpdAcceptDialogComponent>);
  private readonly cdr       = inject(ChangeDetectorRef);

  agreed = false;
  saving = signal(false);
  error  = signal<string | null>(null);

  fmtDate(iso?: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  async accept(): Promise<void> {
    if (!this.agreed || this.saving() || !this.data.user) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.lgpd.saveAcceptance(this.data.term, this.data.user);
      this.dialogRef.close(true);
    } catch {
      this.error.set('Erro ao registrar aceite. Tente novamente.');
      this.saving.set(false);
      this.cdr.markForCheck();
    }
  }
}