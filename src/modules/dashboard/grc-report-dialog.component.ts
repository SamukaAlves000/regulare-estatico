import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { GrcReportService } from './services/grc-report.service';

@Component({
    selector: 'app-grc-report-public',
    standalone: true,
    imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule, MatIconModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="wrapper">
            <div class="card">
                <img src="/assets/logo.png" alt="Regulare" class="logo" onerror="this.style.display='none'">
                <h2>Relatório GRC</h2>

                <ng-container [ngSwitch]="state">
                    <ng-container *ngSwitchCase="'validating'">
                        <mat-spinner diameter="48"></mat-spinner>
                        <p class="msg">Verificando empresa...</p>
                    </ng-container>

                    <ng-container *ngSwitchCase="'loading'">
                        <mat-spinner diameter="48"></mat-spinner>
                        <p class="msg">Gerando relatório, aguarde...</p>
                    </ng-container>

                    <ng-container *ngSwitchCase="'not-found'">
                        <mat-icon class="icon not-found">search_off</mat-icon>
                        <p class="msg">Empresa não encontrada.</p>
                        <p class="sub">O link utilizado não corresponde a nenhuma empresa cadastrada na plataforma.</p>
                    </ng-container>

                    <ng-container *ngSwitchCase="'success'">
                        <mat-icon class="icon success">check_circle</mat-icon>
                        <p class="msg">Relatório gerado com sucesso!</p>
                        <p class="sub">O download deve ter iniciado automaticamente.</p>
                        <button mat-stroked-button (click)="generate()">
                            <mat-icon>download</mat-icon> Baixar novamente
                        </button>
                    </ng-container>

                    <ng-container *ngSwitchCase="'error'">
                        <mat-icon class="icon error">error_outline</mat-icon>
                        <p class="msg">Não foi possível gerar o relatório.</p>
                        <p class="sub error-text">{{ errorMessage }}</p>
                        <button mat-stroked-button color="warn" (click)="generate()">
                            <mat-icon>refresh</mat-icon> Tentar novamente
                        </button>
                    </ng-container>
                </ng-container>
            </div>
        </div>
    `,
    styles: [`
        .wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f7fa;
            font-family: Roboto, sans-serif;
        }
        .card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            background: #fff;
            border-radius: 12px;
            padding: 48px 40px;
            box-shadow: 0 4px 24px rgba(0,0,0,.08);
            max-width: 420px;
            width: 100%;
            text-align: center;
        }
        .logo { height: 48px; margin-bottom: 8px; }
        h2 { margin: 0; color: #1a3c5e; font-size: 1.4rem; }
        .msg { margin: 0; font-size: 1rem; color: #2c3e50; }
        .sub { margin: 0; font-size: .85rem; color: #7f8c8d; }
        .icon { font-size: 52px; width: 52px; height: 52px; }
        .icon.success   { color: #27ae60; }
        .icon.error     { color: #c0392b; }
        .icon.not-found { color: #7f8c8d; }
        .error-text     { color: #c0392b; }
    `],
})
export class GrcReportPublicComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private grcReportService = inject(GrcReportService);
    private cdr = inject(ChangeDetectorRef);

    state: 'validating' | 'loading' | 'not-found' | 'success' | 'error' = 'validating';
    errorMessage = '';

    private companyId = '';
    private unitId: string | undefined;
    private userId: string | undefined;


    ngOnInit(): void {
        this.companyId = this.route.snapshot.paramMap.get('companyId') ?? '';

        this.userId =
            this.route.snapshot.queryParamMap.get('userId') ?? undefined;

        this.unitId =
            this.route.snapshot.queryParamMap.get('unitId') ?? undefined;

        this.generate();
    }

    async generate(): Promise<void> {
        this.state = 'validating';
        this.cdr.markForCheck();
        try {
            const exists = await this.grcReportService.checkCompanyExists(this.companyId);
            if (!exists) {
                this.state = 'not-found';
                this.cdr.markForCheck();
                return;
            }
            this.state = 'loading';
            this.cdr.markForCheck();
            await this.grcReportService.generateReport(this.companyId, this.unitId, this.userId);
            this.state = 'success';
        } catch (err: unknown) {
            this.state = 'error';
            this.errorMessage = err instanceof Error ? err.message : 'Erro desconhecido.';
        }
        this.cdr.markForCheck();
    }
}