import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { Company } from '../cadastros/models/company.model';
import { Unit } from '../cadastros/models/unit.model';

export interface GrcReportDialogData {
    companyId: string | undefined;
    isAdmin: boolean;
}

@Component({
    selector: 'app-grc-report-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatSelectModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        MatIconModule,
    ],
    template: `
    <h2 mat-dialog-title>
      <mat-icon style="vertical-align: middle; margin-right: 8px; color: #1a3c5e;">picture_as_pdf</mat-icon>
      Gerar Relatório GRC
    </h2>

    <mat-dialog-content>
      <div class="dialog-content">

        <mat-form-field *ngIf="data.isAdmin" appearance="outline">
          <mat-label>Empresa</mat-label>
          <mat-select [(ngModel)]="selectedCompanyId" (selectionChange)="onCompanyChange()">
            <mat-option *ngFor="let company of companies" [value]="company.id">
              {{ company.razaoSocial }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Unidade (opcional)</mat-label>
          <mat-select [(ngModel)]="selectedUnitId" [disabled]="!selectedCompanyId || units.length === 0">
            <mat-option [value]="null">Todas as unidades</mat-option>
            <mat-option *ngFor="let unit of units" [value]="unit.id">
              {{ unit.name }}
            </mat-option>
          </mat-select>
          <mat-hint *ngIf="selectedCompanyId && units.length === 0">
            Nenhuma unidade cadastrada para esta empresa
          </mat-hint>
        </mat-form-field>

        <div *ngIf="loading" class="loading-container">
          <mat-spinner diameter="36"></mat-spinner>
          <span>Carregando...</span>
        </div>

      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onGenerate()"
        [disabled]="!selectedCompanyId || loading"
      >
        <mat-icon>download</mat-icon>
        Gerar PDF
      </button>
    </mat-dialog-actions>
  `,
    styles: [`
    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 360px;
      padding-top: 8px;
    }
    mat-form-field { width: 100%; }
    .loading-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 8px 0;
      color: #7f8c8d;
      font-size: 14px;
    }
  `],
})
export class GrcReportDialogComponent implements OnInit {
    // ✅ Injeção correta via inject() — compatível com standalone + Angular 15+
    readonly data: GrcReportDialogData = inject(MAT_DIALOG_DATA);
    private readonly firestore = inject(Firestore);
    private readonly dialogRef = inject(MatDialogRef<GrcReportDialogComponent>);

    selectedCompanyId: string | undefined;
    selectedUnitId: string | null = null;
    companies: Company[] = [];
    units: Unit[] = [];
    loading = false;

    ngOnInit(): void {
        this.initializeData();
    }

    private async initializeData(): Promise<void> {
        this.selectedCompanyId = this.data.companyId;

        if (this.data.isAdmin) {
            await this.loadCompanies();
        }

        if (this.selectedCompanyId) {
            await this.loadUnits(this.selectedCompanyId);
        }
    }

    private async loadCompanies(): Promise<void> {
        try {
            this.loading = true;
            const snap = await getDocs(collection(this.firestore, 'companies'));
            // @ts-ignore
            this.companies = snap.docs
                .map(d => ({ ...d.data(), id: d.id } as Company))
                // @ts-ignore
                .filter(c => !c['deleted'])
                .sort((a, b) => (a.razaoSocial ?? '').localeCompare(b.razaoSocial ?? ''));
        } catch (error) {
            console.error('[GrcReportDialog] Erro ao carregar empresas:', error);
        } finally {
            this.loading = false;
        }
    }

    private async loadUnits(companyId: string): Promise<void> {
        try {
            this.loading = true;
            const snap = await getDocs(
                query(collection(this.firestore, 'units'), where('companyId', '==', companyId))
            );
            this.units = snap.docs
                .map(d => ({ ...d.data(), id: d.id } as Unit))
                .filter(u => u.status !== 'inactive')
                .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
        } catch (error) {
            console.error('[GrcReportDialog] Erro ao carregar unidades:', error);
        } finally {
            this.loading = false;
        }
    }

    async onCompanyChange(): Promise<void> {
        this.selectedUnitId = null;
        this.units = [];
        if (this.selectedCompanyId) {
            await this.loadUnits(this.selectedCompanyId);
        }
    }

    onCancel(): void {
        this.dialogRef.close();
    }

    onGenerate(): void {
        if (!this.selectedCompanyId) return;
        this.dialogRef.close({
            generate: true,
            companyId: this.selectedCompanyId,
            unitId: this.selectedUnitId ?? undefined,
        });
    }
}