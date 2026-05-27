import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { Company } from '../cadastros/models/company.model';
import { Unit } from '../cadastros/models/unit.model';
import { GrcReportOptions } from './services/grc-report.service';

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
        MatInputModule,
        MatSelectModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        MatIconModule,
        MatCheckboxModule,
        MatDividerModule,
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

        <mat-divider></mat-divider>

        <div class="section-group">
          <p class="section-label">Período de vencimento / prazo (filtro)</p>
          <div class="date-range-row">
            <mat-form-field appearance="outline">
              <mat-label>Data início</mat-label>
              <input matInput type="date" [(ngModel)]="dateStart">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Data fim</mat-label>
              <input matInput type="date" [(ngModel)]="dateEnd">
            </mat-form-field>
          </div>
          <p class="hint-text">Filtra licenças/EPIs pelo vencimento e condicionantes pelo prazo. Deixe em branco para incluir todos.</p>
        </div>

        <div class="section-group">
          <p class="section-label">Seções do relatório</p>
          <div class="checkboxes-row">
            <mat-checkbox [(ngModel)]="sections.licencas">Licenças</mat-checkbox>
            <mat-checkbox [(ngModel)]="sections.condicionantes">Condicionantes</mat-checkbox>
            <mat-checkbox [(ngModel)]="sections.epis" (change)="onEpisChange()">EPIs</mat-checkbox>
          </div>
        </div>

        <div class="section-group">
          <p class="section-label">Opções adicionais</p>
          <mat-checkbox [(ngModel)]="epiHistory" [disabled]="!sections.epis">
            Incluir histórico de ações nas entregas EPIs
          </mat-checkbox>
        </div>

      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onGenerate()"
        [disabled]="!selectedCompanyId || loading || noSectionSelected"
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
      min-width: 380px;
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
    .section-group { display: flex; flex-direction: column; gap: 8px; }
    .section-label { margin: 0; font-size: 12px; font-weight: 600; color: #1a3c5e; text-transform: uppercase; letter-spacing: .5px; }
    .checkboxes-row { display: flex; gap: 16px; flex-wrap: wrap; }
    .date-range-row { display: flex; gap: 12px; }
    .date-range-row mat-form-field { flex: 1; }
    .hint-text { margin: -4px 0 0; font-size: 11px; color: #7f8c8d; }
  `],
})
export class GrcReportDialogComponent implements OnInit {
    readonly data: GrcReportDialogData = inject(MAT_DIALOG_DATA);
    private readonly firestore = inject(Firestore);
    private readonly dialogRef = inject(MatDialogRef<GrcReportDialogComponent>);

    selectedCompanyId: string | undefined;
    selectedUnitId: string | null = null;
    companies: Company[] = [];
    units: Unit[] = [];
    loading = false;

    sections = { licencas: true, condicionantes: true, epis: true };
    epiHistory = true;
    dateStart = '';
    dateEnd   = '';

    get noSectionSelected(): boolean {
        return !this.sections.licencas && !this.sections.condicionantes && !this.sections.epis;
    }

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

    onEpisChange(): void {
        if (!this.sections.epis) {
            this.epiHistory = false;
        }
    }

    onCancel(): void {
        this.dialogRef.close();
    }

    onGenerate(): void {
        if (!this.selectedCompanyId) return;
        const options: GrcReportOptions = {
            sections:   { ...this.sections },
            epiHistory: this.epiHistory,
            dateStart:  this.dateStart || undefined,
            dateEnd:    this.dateEnd   || undefined,
        };
        this.dialogRef.close({
            generate: true,
            companyId: this.selectedCompanyId,
            unitId: this.selectedUnitId ?? undefined,
            options,
        });
    }
}
