import {
    ChangeDetectionStrategy, ChangeDetectorRef,
    Component, inject, OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QRCodeModule } from 'angularx-qrcode';
import { DocumentValidationService } from '../../core/services/document-validation.service';
import { GeneratedReport } from '../../core/models/generated-report.model';

type PageState = 'loading' | 'valid' | 'revoked' | 'not-found' | 'error';

@Component({
    selector: 'app-validate-document',
    standalone: true,
    imports: [CommonModule, MatProgressSpinnerModule, MatIconModule, MatTooltipModule, QRCodeModule, DatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="page">

            <!-- Cabeçalho -->
            <header class="brand-header">
                <div class="brand-inner">
                    <span class="brand-name">REGULARE</span>
                    <span class="brand-sub">Plataforma de Conformidade &amp; Regulação</span>
                </div>
                <span class="brand-badge">Verificação de Autenticidade Documental</span>
            </header>

            <main class="content">

                <!-- LOADING -->
                <ng-container *ngIf="state === 'loading'">
                    <div class="center-block">
                        <mat-spinner diameter="52"></mat-spinner>
                        <p class="state-msg">Consultando base de registros REGULARE...</p>
                    </div>
                </ng-container>

                <!-- VÁLIDO -->
                <ng-container *ngIf="state === 'valid' && report">

                    <!-- Selo principal -->
                    <div class="seal valid">
                        <mat-icon class="seal-icon">verified</mat-icon>
                        <div class="seal-text">
                            <p class="seal-title">DOCUMENTO VÁLIDO</p>
                            <p class="seal-sub">Autenticidade confirmada pela plataforma REGULARE</p>
                        </div>
                        <div class="seal-verified-at">
                            <span>Verificado em</span>
                            <strong>{{ verifiedAt | date:'dd/MM/yyyy HH:mm:ss' }}</strong>
                        </div>
                    </div>

                    <div class="grid">

                        <!-- Identificação -->
                        <section class="card">
                            <h3 class="card-title"><mat-icon>description</mat-icon> Identificação do Documento</h3>
                            <dl>
                                <div class="row"><dt>Código</dt><dd class="mono highlight">{{ report.reportCode }}</dd></div>
                                <div class="row"><dt>Tipo</dt><dd>Relatório Gerencial GRC</dd></div>
                                <div class="row"><dt>Arquivo</dt><dd>{{ report.fileName }}</dd></div>
                                <div class="row"><dt>Plataforma</dt><dd>REGULARE — MVN Consultant</dd></div>
                                <div class="row">
                                    <dt>Status</dt>
                                    <dd><span class="badge valid-badge"><mat-icon inline>check_circle</mat-icon> VÁLIDO</span></dd>
                                </div>
                            </dl>
                        </section>

                        <!-- Empresa -->
                        <section class="card">
                            <h3 class="card-title"><mat-icon>business</mat-icon> Empresa</h3>
                            <dl>
                                <div class="row"><dt>Razão Social</dt><dd>{{ report.companyName }}</dd></div>
                                <div class="row" *ngIf="report.unitName">
                                    <dt>Unidade</dt><dd>{{ report.unitName }}</dd>
                                </div>
                            </dl>
                        </section>

                        <!-- Emissão e Rastreabilidade -->
                        <section class="card">
                            <h3 class="card-title"><mat-icon>history</mat-icon> Emissão &amp; Rastreabilidade</h3>
                            <dl>
                                <div class="row"><dt>Data/Hora (UTC)</dt><dd class="mono">{{ report.generatedAtUtc }}</dd></div>
                                <div class="row"><dt>Data/Hora (BR)</dt><dd>{{ report.generatedAtUtc | date:'dd/MM/yyyy HH:mm:ss' }}</dd></div>
                                <div class="row"><dt>Emissor</dt><dd>{{ report.emittedByUserName }}</dd></div>
                            </dl>
                        </section>

                        <!-- Integridade -->
                        <section class="card">
                            <h3 class="card-title"><mat-icon>security</mat-icon> Integridade Documental</h3>
                            <dl>
                                <div class="row"><dt>Algoritmo</dt><dd>SHA-256</dd></div>
                                <div class="row"><dt>Integridade</dt>
                                    <dd><span class="badge valid-badge"><mat-icon inline>shield</mat-icon> Verificada</span></dd>
                                </div>
                                <div class="row"><dt>Não-repúdio</dt><dd>Garantido por hash imutável</dd></div>
                                <div class="row"><dt>Conformidade</dt><dd>LGPD · GRC · Auditoria Corporativa</dd></div>
                            </dl>
                        </section>

                        <!-- Hash SHA-256 — largura total -->
                        <section class="card full-width">
                            <h3 class="card-title"><mat-icon>fingerprint</mat-icon> Hash SHA-256 — Impressão Digital do Documento</h3>
                            <p class="hash-label">
                                O hash abaixo é a <strong>impressão digital única</strong> deste documento.
                                Qualquer alteração no conteúdo produziria um hash completamente diferente,
                                garantindo a <strong>integridade e não-repúdio</strong> conforme práticas de GRC e LGPD.
                            </p>
                            <div class="hash-box" (click)="copyHash()" [matTooltip]="copied ? 'Copiado!' : 'Clique para copiar'">
                                <mat-icon class="hash-icon">content_copy</mat-icon>
                                <span class="hash-value">{{ report.hash }}</span>
                            </div>
                            <p class="hash-hint">Utilize este hash para auditorias, processos jurídicos e comprovação de autenticidade.</p>
                        </section>

                        <!-- QR Code -->
                        <section class="card qr-card">
                            <h3 class="card-title"><mat-icon>qr_code_2</mat-icon> QR Code de Validação</h3>
                            <p class="qr-desc">Escaneie para acessar esta página de validação a qualquer momento.</p>
                            <div class="qr-wrap">
                                <qrcode [qrdata]="currentUrl" [width]="160" [errorCorrectionLevel]="'M'" [margin]="1"></qrcode>
                            </div>
                            <p class="qr-url">{{ currentUrl }}</p>
                        </section>

                        <!-- Aviso legal -->
                        <section class="card full-width legal-card">
                            <mat-icon class="legal-icon">gavel</mat-icon>
                            <p>
                                Este documento foi gerado e registrado eletronicamente pela plataforma <strong>REGULARE</strong>.
                                O registro na base de dados da plataforma, combinado com o hash SHA-256, garante
                                <strong>autenticidade, integridade e não-repúdio</strong>, em conformidade com as
                                boas práticas de Governança Corporativa, Compliance, Gestão de Riscos e LGPD.
                                A validade deste registro pode ser verificada a qualquer momento por meio desta URL pública.
                            </p>
                        </section>

                    </div>
                </ng-container>

                <!-- REVOGADO -->
                <ng-container *ngIf="state === 'revoked'">
                    <div class="seal revoked">
                        <mat-icon class="seal-icon">cancel</mat-icon>
                        <div class="seal-text">
                            <p class="seal-title">DOCUMENTO REVOGADO</p>
                            <p class="seal-sub">Este documento foi invalidado e não possui mais validade corporativa.</p>
                        </div>
                    </div>
                </ng-container>

                <!-- NÃO ENCONTRADO -->
                <ng-container *ngIf="state === 'not-found'">
                    <div class="seal not-found">
                        <mat-icon class="seal-icon">search_off</mat-icon>
                        <div class="seal-text">
                            <p class="seal-title">DOCUMENTO NÃO ENCONTRADO</p>
                            <p class="seal-sub">O código informado não corresponde a nenhum registro na base da plataforma REGULARE. O documento pode ser inautêntico ou o link estar incorreto.</p>
                        </div>
                    </div>
                </ng-container>

                <!-- ERRO -->
                <ng-container *ngIf="state === 'error'">
                    <div class="seal error-seal">
                        <mat-icon class="seal-icon">error_outline</mat-icon>
                        <div class="seal-text">
                            <p class="seal-title">ERRO NA VERIFICAÇÃO</p>
                            <p class="seal-sub">Não foi possível consultar a base de registros. Tente novamente em instantes.</p>
                        </div>
                    </div>
                </ng-container>

            </main>

            <footer class="page-footer">
                <p>REGULARE — By MVN Consultant &nbsp;|&nbsp; Plataforma de Conformidade &amp; Regulação</p>
                <p>Verificação pública e auditável · Conformidade com LGPD · Governança Corporativa · GRC</p>
            </footer>
        </div>
    `,
    styles: [`
        :host { display: block; }

        .page { min-height: 100vh; background: #f0f4f8; font-family: Roboto, sans-serif; display: flex; flex-direction: column; }

        /* Header */
        .brand-header {
            background: #1a3c5e; color: #fff; padding: 16px 32px;
            display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
        }
        .brand-inner { display: flex; flex-direction: column; gap: 2px; }
        .brand-name  { font-size: 1.25rem; font-weight: 700; letter-spacing: .5px; }
        .brand-sub   { font-size: .75rem; opacity: .75; }
        .brand-badge {
            background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3);
            border-radius: 20px; padding: 4px 14px; font-size: .75rem; font-weight: 500;
        }

        /* Content */
        .content { flex: 1; max-width: 900px; width: 100%; margin: 0 auto; padding: 28px 16px; }

        /* Loading */
        .center-block { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 0; gap: 20px; }
        .state-msg { font-size: 1rem; color: #555; }

        /* Seals */
        .seal {
            display: flex; align-items: center; gap: 16px;
            border-radius: 10px; padding: 20px 24px; border-left: 6px solid; margin-bottom: 24px; flex-wrap: wrap;
        }
        .seal.valid       { background: #f0faf4; border-color: #27ae60; }
        .seal.revoked     { background: #fdf3f2; border-color: #c0392b; }
        .seal.not-found   { background: #f5f5f5; border-color: #7f8c8d; }
        .seal.error-seal  { background: #fdf3f2; border-color: #e67e22; }

        .seal-icon { font-size: 40px; width: 40px; height: 40px; flex-shrink: 0; }
        .seal.valid .seal-icon     { color: #27ae60; }
        .seal.revoked .seal-icon   { color: #c0392b; }
        .seal.not-found .seal-icon { color: #7f8c8d; }
        .seal.error-seal .seal-icon { color: #e67e22; }

        .seal-text { flex: 1; }
        .seal-title { margin: 0; font-size: 1.1rem; font-weight: 700; color: #1a3c5e; }
        .seal-sub   { margin: 4px 0 0; font-size: .875rem; color: #555; }

        .seal-verified-at {
            display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
            font-size: .75rem; color: #7f8c8d; border-left: 1px solid #d0e8d8; padding-left: 16px;
            strong { font-size: .8rem; color: #27ae60; }
        }

        /* Grid */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }

        .card { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
        .full-width { grid-column: 1 / -1; }

        .card-title {
            display: flex; align-items: center; gap: 6px;
            margin: 0 0 14px; font-size: .9rem; color: #1a3c5e; font-weight: 600;
            mat-icon { font-size: 18px; width: 18px; height: 18px; }
        }

        dl { margin: 0; }
        .row {
            display: flex; justify-content: space-between; align-items: flex-start;
            gap: 12px; padding: 7px 0; border-bottom: 1px solid #f0f0f0; font-size: .875rem;
        }
        .row:last-child { border-bottom: none; }
        dt { color: #7f8c8d; font-weight: 500; flex-shrink: 0; min-width: 120px; }
        dd { margin: 0; color: #2c3e50; text-align: right; word-break: break-all; }

        .mono      { font-family: 'Courier New', monospace; font-size: .82rem; }
        .muted     { color: #aaa; }
        .highlight { color: #1a3c5e; font-weight: 700; font-size: .9rem; }

        .badge {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 2px 8px; border-radius: 12px; font-size: .78rem; font-weight: 600;
        }
        .valid-badge { background: #f0faf4; color: #27ae60; }

        /* Hash */
        .hash-label { margin: 0 0 10px; font-size: .85rem; color: #555; line-height: 1.5; }
        .hash-box {
            display: flex; align-items: center; gap: 10px;
            background: #f8f9fb; border: 1px solid #dde3ea; border-radius: 6px;
            padding: 12px 14px; cursor: pointer; transition: background .2s;
            &:hover { background: #eef1f5; }
        }
        .hash-icon { color: #7f8c8d; font-size: 18px; flex-shrink: 0; }
        .hash-value {
            font-family: 'Courier New', monospace; font-size: .78rem; color: #2c3e50;
            word-break: break-all; line-height: 1.6;
        }
        .hash-hint { margin: 8px 0 0; font-size: .75rem; color: #aaa; }

        /* QR */
        .qr-card { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .qr-desc { margin: 0 0 12px; font-size: .85rem; color: #555; }
        .qr-wrap { margin-bottom: 8px; }
        .qr-url  { margin: 0; font-size: .7rem; color: #aaa; word-break: break-all; }

        /* Legal */
        .legal-card { display: flex; align-items: flex-start; gap: 12px; background: #f8f9fb; }
        .legal-icon { color: #1a3c5e; font-size: 22px; margin-top: 2px; flex-shrink: 0; }
        .legal-card p { margin: 0; font-size: .82rem; color: #555; line-height: 1.6; }

        /* Footer */
        .page-footer {
            background: #1a3c5e; color: rgba(255,255,255,.65);
            text-align: center; padding: 14px 32px; font-size: .75rem;
            p { margin: 3px 0; }
        }

        @media (max-width: 600px) {
            .brand-header { padding: 12px 16px; }
            .grid { grid-template-columns: 1fr; }
            .full-width { grid-column: 1; }
            .seal { flex-direction: column; }
            .seal-verified-at { border-left: none; border-top: 1px solid #d0e8d8; padding: 8px 0 0; align-items: flex-start; }
        }
    `],
})
export class ValidateDocumentComponent implements OnInit {
    private readonly route         = inject(ActivatedRoute);
    private readonly validationSvc = inject(DocumentValidationService);
    private readonly cdr           = inject(ChangeDetectorRef);

    state: PageState = 'loading';
    report: GeneratedReport | null = null;
    currentUrl = '';
    verifiedAt = new Date();
    copied = false;

    ngOnInit(): void {
        this.currentUrl = window.location.href;
        const hash = this.route.snapshot.paramMap.get('hash') ?? '';
        this.verify(hash);
    }

    private async verify(hash: string): Promise<void> {
        try {
            const found = await this.validationSvc.findByHash(hash);
            if (!found) {
                this.state = 'not-found';
            } else if (!found.valid) {
                this.state = 'revoked';
            } else {
                this.report      = found;
                this.verifiedAt  = new Date();
                this.state       = 'valid';
            }
        } catch {
            this.state = 'error';
        }
        this.cdr.markForCheck();
    }

    copyHash(): void {
        if (!this.report?.hash) return;
        navigator.clipboard.writeText(this.report.hash).then(() => {
            this.copied = true;
            this.cdr.markForCheck();
            setTimeout(() => { this.copied = false; this.cdr.markForCheck(); }, 2000);
        }).catch(() => {});
    }
}