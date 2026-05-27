import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { Company } from '../../cadastros/models/company.model';
import { User } from '../../../core/models/user.model';
import { CompaniesRepository } from '../../cadastros/repositories/companies.repository';

@Component({
  selector: 'app-user-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Editar Usuário' : 'Novo Usuário' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Nome Completo</mat-label>
          <input matInput formControlName="name" placeholder="Ex: João Silva">
          <mat-error *ngIf="form.get('name')?.hasError('required')">Nome é obrigatório</mat-error>
          <mat-error *ngIf="form.get('name')?.hasError('minlength')">Nome muito curto</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>E-mail</mat-label>
          <input matInput formControlName="email" type="email" placeholder="Ex: joao@email.com" [readonly]="isEdit">
          <mat-error *ngIf="form.get('email')?.hasError('required')">E-mail é obrigatório</mat-error>
          <mat-error *ngIf="form.get('email')?.hasError('email')">E-mail inválido</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Empresa</mat-label>
          <mat-select formControlName="companyId">
            <mat-option *ngFor="let c of companies" [value]="c.id">
              {{ c.razaoSocial || c.nomeFantasia || c.name }}
            </mat-option>
          </mat-select>
          <mat-error *ngIf="form.get('companyId')?.hasError('required')">Empresa é obrigatória</mat-error>
        </mat-form-field>
      </form>
      <div *ngIf="!isEdit" class="info-note">
        <mat-icon>info</mat-icon>
        <p>Um e-mail de convite será enviado para que o usuário defina sua senha.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button mat-raised-button color="primary" [disabled]="form.invalid" (click)="onSave()">
        {{ isEdit ? 'Atualizar' : 'Criar Usuário' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .full-width { width: 100%; }
    .info-note { 
      display: flex; 
      align-items: center; 
      gap: 12px; 
      margin-top: 16px; 
      padding: 12px; 
      background: rgba(255,255,255,0.05); 
      border-radius: 8px;
      font-size: 0.85rem;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .info-note mat-icon { color: var(--accent); }
    .info-note p { margin: 0; color: var(--muted); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<UserDialogComponent>);
  private readonly data = inject(MAT_DIALOG_DATA);
  private readonly companiesRepo = inject(CompaniesRepository);

  isEdit = false;
  companies: Company[] = [];

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    companyId: ['', [Validators.required]],
    profile: ['CLIENTE' as const]
  });

  async ngOnInit() {
    this.companies = await this.companiesRepo.listAll(500);
    if (this.data) {
      this.isEdit = true;
      this.form.patchValue(this.data);
    }
  }

  onCancel() {
    this.dialogRef.close();
  }

  onSave() {
    if (this.form.valid) {
      this.dialogRef.close(this.form.getRawValue());
    }
  }
}
