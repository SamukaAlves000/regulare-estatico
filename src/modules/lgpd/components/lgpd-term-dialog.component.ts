
import {
  ChangeDetectionStrategy, Component, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { LgpdTermsService } from '../services/lgpd-terms.service';
import { LgpdTerm } from '../../../core/models/lgpd-term.model';

export interface LgpdTermDialogData {
  term?: LgpdTerm;
  nextVersion?: string;
}

@Component({
  selector: 'app-lgpd-term-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Editar Rascunho' : 'Novo Termo LGPD' }}</h2>

    <mat-dialog-content [formGroup]="form" class="term-dialog">

      <mat-form-field appearance="fill" class="field-full">
        <mat-label>Versão</mat-label>
        <input matInput formControlName="version" placeholder="v1.0"/>
        <mat-hint>Formato: v1.0, v1.1, v2.0</mat-hint>
        <mat-error *ngIf="form.get('version')?.hasError('required')">Obrigatório</mat-error>
        <mat-error *ngIf="form.get('version')?.hasError('pattern')">Use o formato v1.0</mat-error>
      </mat-form-field>

      <mat-form-field appearance="fill" class="field-full">
        <mat-label>Título</mat-label>
        <input matInput formControlName="title" placeholder="Termos de Uso e Privacidade — LGPD"/>
        <mat-error *ngIf="form.get('title')?.hasError('required')">Obrigatório</mat-error>
      </mat-form-field>

      <mat-form-field appearance="fill" class="field-full">
        <mat-label>Conteúdo (HTML)</mat-label>
        <textarea
          matInput
          formControlName="content"
          rows="16"
          placeholder="<h2>1. Introdução</h2>&#10;<p>Este termo...</p>"
          class="content-textarea"
        ></textarea>
        <mat-hint>O conteúdo será renderizado como HTML na tela de aceite</mat-hint>
        <mat-error *ngIf="form.get('content')?.hasError('required')">Obrigatório</mat-error>
      </mat-form-field>

      <p *ngIf="error()" class="save-error">{{ error() }}</p>

    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="saving()">Cancelar</button>
      <button
        mat-flat-button
        color="primary"
        [disabled]="form.invalid || saving()"
        (click)="onSubmit()"
      >
        <mat-spinner *ngIf="saving()" diameter="18"></mat-spinner>
        <span *ngIf="!saving()">{{ isEdit ? 'Salvar' : 'Criar Rascunho' }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .term-dialog {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 520px;
    }

    .field-full { width: 100%; }

    .content-textarea {
      font-family: 'Courier New', monospace;
      font-size: .82rem;
      resize: vertical;
    }

    .save-error {
      margin: 4px 0 0;
      color: #b91c1c;
      font-size: .82rem;
    }
  `],
})
export class LgpdTermDialogComponent {
  private readonly data      = inject<LgpdTermDialogData>(MAT_DIALOG_DATA);
  private readonly lgpd      = inject(LgpdTermsService);
  private readonly dialogRef = inject(MatDialogRef<LgpdTermDialogComponent>);

  saving = signal(false);
  error  = signal<string | null>(null);
  isEdit = false;
  termId: string | null = null;

  form = inject(FormBuilder).group({
    version: ['v1.0', [Validators.required, Validators.pattern(/^v\d+\.\d+$/)]],
    title:   ['', [Validators.required, Validators.minLength(3)]],
    content: ['', [Validators.required]],
  });

  constructor() {
    const data = this.data;
    if (data?.term) {
      this.isEdit = true;
      this.termId = data.term.id;
      this.form.patchValue({
        version: data.term.version,
        title:   data.term.title,
        content: data.term.content,
      });
    } else if (data?.nextVersion) {
      this.form.patchValue({ version: data.nextVersion });
    }
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.saving()) return;
    const v = this.form.getRawValue() as { version: string; title: string; content: string };
    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.isEdit && this.termId) {
        await this.lgpd.updateDraft(this.termId, v);
      } else {
        await this.lgpd.createTerm(v);
      }
      this.dialogRef.close(true);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erro ao salvar o termo');
      this.saving.set(false);
    }
  }
}