import { Component, inject, OnInit, signal, effect, ChangeDetectorRef, untracked, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Firestore } from '@angular/fire/firestore';
import { FilterByStatusPipe } from './filter-by-status.pipe';
import { SessionService } from '../../core/services/session.service';
import { DashboardService } from './dashboard.service';
import { DashboardStats, AgendaItem } from './dashboard.model';
import { LicenseDialogComponent } from '../licencas/components/license-dialog.component';
import { EpiDeliveryDialogComponent } from '../epis/epi-delivery-dialog/epi-delivery-dialog.component';
import { ConditionDialogComponent } from '../licencas/components/condition-dialog.component';
import { CompaniesService } from '../cadastros/services/companies.service';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType, Chart, registerables } from 'chart.js';
import { GrcReportService } from './services/grc-report.service';
import { GrcReportDialogComponent } from './grc-report-dialog.component';
import { doc, getDoc } from '@angular/fire/firestore';

Chart.register(...registerables);

export interface Obligation {
    id: string;
    nome: string;
    tipo: 'Licenças' | 'Condicionantes' | 'EPI';
    status: 'em_dia' | 'a_vencer' | 'vencido';
    dataVencimento: Date;
}

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatIconModule,
        MatTableModule,
        MatButtonModule,
        MatDialogModule,
        MatProgressBarModule,
        BaseChartDirective
    ],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
    private readonly session = inject(SessionService);
    private readonly dashboardService = inject(DashboardService);
    private readonly cd = inject(ChangeDetectorRef);
    private readonly dialog = inject(MatDialog);
    private readonly firestore = inject(Firestore);
    private readonly companiesService = inject(CompaniesService);
    private readonly grcReportService = inject(GrcReportService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    stats = signal<DashboardStats | null>(null);
    public rawData = signal<Obligation[]>([]);
    loading = signal(false);

    // --- CÁLCULOS DE CONFORMIDADE (USANDO DIRETAMENTE O stats) ---
    // @ts-ignore
    public totalLicencas = computed(() => this.stats()?.licenses?.total ?? 0);
    // @ts-ignore
    public totalCondicionantes = computed(() => this.stats()?.conditions?.total ?? 0);
    // @ts-ignore
    public totalEpis = computed(() => this.stats()?.epis?.total ?? 0);

    public totalGeral = computed(() =>
        // @ts-ignore
        (this.stats()?.licenses?.total ?? 0) +
        // @ts-ignore
        (this.stats()?.conditions?.total ?? 0) +
        // @ts-ignore
        (this.stats()?.epis?.total ?? 0)
    );

    public licencasEmDia = computed(() => this.stats()?.licenses?.emDia ?? 0);
    public licencasAVencer = computed(() => this.stats()?.licenses?.aVencer ?? 0);
    public licencasVencidas = computed(() => this.stats()?.licenses?.vencidas ?? 0);

    public episOk = computed(() => this.stats()?.epis?.ok ?? 0);
    public episAVencer = computed(() => this.stats()?.epis?.aVencer ?? 0);
    public episVencidos = computed(() => this.stats()?.epis?.vencidas ?? 0);

    public condCumpridas = computed(() => this.stats()?.conditions?.cumpridas ?? 0);
    public condAVencer = computed(() => this.stats()?.conditions?.aVencer ?? 0);
    public condVencidas = computed(() => this.stats()?.conditions?.vencidas ?? 0);

    // Total de itens vencidos
    public totalVencidos = computed(() =>
        this.licencasVencidas() + this.condVencidas() + this.episVencidos()
    );

    // Pendências Info
    public pendenciesInfo = computed(() => {
        const count = this.totalVencidos() + this.licencasAVencer() + this.condAVencer() + this.episAVencer();
        return {
            label: count.toString(),
            class: count > 0 ? 'pendencies-high' : 'pendencies-low'
        };
    });

    // Índice de conformidade baseado nos dados do service
    public complianceIndex = computed(() => {
        if (this.totalGeral() === 0) return 0;
        const totalEmDia = this.licencasEmDia() + this.licencasAVencer() +
            this.condCumpridas() + this.condAVencer() +
            this.episOk() + this.episAVencer();
        return Math.round((totalEmDia / this.totalGeral()) * 100);
    });

    public riskInfo = computed(() => {
        const index = this.complianceIndex();
        if (index >= 80) {
            return { label: 'Baixo Risco', color: '#2ecc71', class: 'risk-low' };
        }
        if (index >= 60) {
            return { label: 'Médio Risco', color: '#f1c40f', class: 'risk-medium' };
        }
        return { label: 'Alto Risco', color: '#e74c3c', class: 'risk-high' };
    });

    public summaryByType = computed(() => {
        return [
            {
                tipo: 'Licenças',
                total: this.totalLicencas(),
                inDay: this.licencasEmDia(),
                upcoming: this.licencasAVencer(),
                irregular: this.licencasVencidas(),
                percentage: this.totalLicencas() > 0
                    ? Math.round(((this.licencasEmDia() + this.licencasAVencer()) / this.totalLicencas()) * 100)
                    : 0
            },
            {
                tipo: 'Condicionantes',
                total: this.totalCondicionantes(),
                inDay: this.condCumpridas(),
                upcoming: this.condAVencer(),
                irregular: this.condVencidas(),
                percentage: this.totalCondicionantes() > 0
                    ? Math.round(((this.condCumpridas() + this.condAVencer()) / this.totalCondicionantes()) * 100)
                    : 0
            },
            {
                tipo: 'EPI',
                total: this.totalEpis(),
                inDay: this.episOk(),
                upcoming: this.episAVencer(),
                irregular: this.episVencidos(),
                percentage: this.totalEpis() > 0
                    ? Math.round(((this.episOk() + this.episAVencer()) / this.totalEpis()) * 100)
                    : 0
            }
        ];
    });

    public upcoming30Days = computed(() => {
        const now = new Date();
        const limit = new Date();
        limit.setDate(now.getDate() + 30);

        const allAgendaItems = [
            ...(this.stats()?.agenda || [])
        ];

        return allAgendaItems
            .filter(item => {
                const date = this.parseDateString(item.date);
                return date > now && date <= limit;
            })
            .sort((a, b) => {
                const dateA = this.parseDateString(a.date);
                const dateB = this.parseDateString(b.date);
                return dateA.getTime() - dateB.getTime();
            });
    });

    // Pega todos os itens vencidos da agenda
    public getItensVencidos(): AgendaItem[] {
        return (this.stats()?.agenda || [])
            // @ts-ignore
            .filter(item => item.status === 'Vencida' || item.status === 'Vencido')
            .slice(0, 5);
    }

    // Calcula dias vencidos a partir da data em string
    public getAbsoluteDaysFromDate(dateStr: string | undefined): string {
        if (!dateStr) return 'data inválida';
        const date = this.parseDateString(dateStr);
        return this.getAbsoluteDays(date);
    }

    // --- CONFIGURAÇÃO DO GRÁFICO ---
    public pieChartOptions: ChartConfiguration['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
    };

    public pieChartData = computed<ChartData<'pie'>>(() => ({
        labels: ['Em Dia', 'A Vencer', 'Vencidos'],
        datasets: [{
            data: [
                this.licencasEmDia() + this.condCumpridas() + this.episOk(),
                this.licencasAVencer() + this.condAVencer() + this.episAVencer(),
                this.licencasVencidas() + this.condVencidas() + this.episVencidos()
            ],
            backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c']
        }]
    }));

    public pieChartType: ChartType = 'pie';

    agendaColumns = ['date', 'type', 'document', 'company', 'status'];
    upcomingColumns = ['type', 'document', 'company', 'date'];
    fullUpcomingColumns = ['type', 'document', 'company', 'date', 'daysRemaining', 'actions'];

    constructor() {
        effect(() => {
            if (this.session.loading()) {
                console.log('Dashboard: Aguardando carregamento da sessão...');
                return;
            }

            const effectiveCompanyId = this.session.adminScopeCompanyId() ||
                this.session.user()?.companyId ||
                undefined;

            console.log('Dashboard: Carregando dados para empresa:', effectiveCompanyId);

            untracked(() => {
                this.loadDashboardData(effectiveCompanyId);
            });
        }, { allowSignalWrites: true });
    }

    ngOnInit() {
        console.log('Dashboard: Inicializado');
        setTimeout(() => { if (!this.stats()) this.loadDashboardData(); }, 2000);
    }

    async loadDashboardData(companyId?: string) {
        this.loading.set(true);
        try {
            const stats = await this.dashboardService.getStats(companyId);
            this.stats.set(stats);

            console.log('Dashboard: Dados carregados do service:', stats);
            console.log('Dashboard: Licenças Em Dia:', stats.licenses.emDia);
            console.log('Dashboard: Licenças A Vencer:', stats.licenses.aVencer);
            console.log('Dashboard: Licenças Vencidas:', stats.licenses.vencidas);
            console.log('Dashboard: EPIs OK:', stats.epis.ok);
            console.log('Dashboard: EPIs Vencidos:', stats.epis.vencidas);
            console.log('Dashboard: Conformidade Geral:', this.complianceIndex());
        } catch (err) {
            console.error('Dashboard: Erro ao carregar estatísticas:', err);
        } finally {
            this.loading.set(false);
            this.cd.markForCheck();
        }
    }

    private parseDateString(dateStr: string | Date): Date {
        if (!dateStr) return new Date('Invalid Date');
        if (dateStr instanceof Date) return dateStr;

        try {
            let date: Date;
            if (dateStr.includes('/')) {
                const [d, m, y] = dateStr.split('/').map(Number);
                date = new Date(y, m - 1, d);
            } else {
                date = new Date(dateStr);
            }
            if (!isNaN(date.getTime())) {
                date.setHours(0, 0, 0, 0);
            }
            return isNaN(date.getTime()) ? new Date('Invalid Date') : date;
        } catch {
            return new Date('Invalid Date');
        }
    }

    userName() { return this.session.user()?.name ?? 'Usuário'; }
    companyName() { return this.session.adminScopeCompanyName() || 'Todas as Empresas'; }

    getDaysDiff(date: Date): number {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);
        const diffTime = target.getTime() - today.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    getAbsoluteDays(date: Date): string {
        const days = this.getDaysDiff(date);
        if (isNaN(days)) return 'data inválida';
        return Math.abs(days).toString();
    }

    formatDateBR(dateStr: string) {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
            return date.toLocaleDateString('pt-BR');
        } catch {
            return dateStr;
        }
    }

    navigateTo(type: string, status?: string) {
        let path: string;
        let finalStatus = status;

        switch (type) {
            case 'Licenças':
                path = 'licencas';
                if (status === 'vencido') finalStatus = 'vencida';
                else if (status === 'a_vencer') finalStatus = 'a_vencer';
                break;
            case 'Condicionantes':
                path = 'condicionantes';
                if (status === 'em_dia') finalStatus = 'cumprida';
                else if (status === 'vencido') finalStatus = 'vencida';
                else if (status === 'a_vencer') finalStatus = 'a_vencer';
                break;
            case 'EPI':
                path = 'epis';
                break;
            default:
                path = type;
        }
        this.router.navigate(['/app', path], { state: { status: finalStatus } });
    }

    async openReportDialog() {
        const ref = this.dialog.open(GrcReportDialogComponent, {
            width: '450px',
            data: {
                companyId: this.session.adminScopeCompanyId() || this.session.user()?.companyId,
                isAdmin: this.session.user()?.profile === 'ADMIN'
            }
        });

        ref.afterClosed().subscribe(async result => {
            if (result?.generate) {
                await this.generateReport(result.companyId, result.unitId);
            }
        });
    }

    private async generateReport(companyId: string, unitId?: string) {
        try {
            this.loading.set(true);
            await this.grcReportService.generateReport(companyId, unitId);
        } catch (error) {
            console.error('Erro ao gerar relatório:', error);
            alert('Erro ao gerar relatório. Verifique o console.');
        } finally {
            this.loading.set(false);
            this.cd.markForCheck();
        }
    }

    async openItem(item: AgendaItem) {
        if (!item.id) return;

        this.loading.set(true);
        try {
            let dialogComponent: any;
            let dialogData: any = {};
            let config = { width: '900px', maxWidth: '95vw', disableClose: true };

            const isEpi = item.type === 'EPI';
            const isLicense = item.type === 'Licença';
            const isCondition = item.type === 'Condicionante';

            if (isEpi) {
                const docRef = doc(this.firestore, 'epi_deliveries', item.id);
                const sn = await getDoc(docRef);
                if (!sn.exists()) throw new Error('Entrega não encontrada');
                dialogComponent = EpiDeliveryDialogComponent;
                dialogData = { ...sn.data(), id: sn.id };
            } else if (isLicense) {
                const docRef = doc(this.firestore, 'licenses', item.id);
                const sn = await getDoc(docRef);
                if (!sn.exists()) throw new Error('Licença não encontrada');
                const companies = await this.companiesService.listCompanies();
                dialogComponent = LicenseDialogComponent;
                dialogData = { ...sn.data(), id: sn.id, isEdit: true, companies };
            } else if (isCondition) {
                const docRef = doc(this.firestore, 'licenseConditions', item.id);
                const sn = await getDoc(docRef);
                if (!sn.exists()) throw new Error('Condicionante não encontrada');
                dialogComponent = ConditionDialogComponent;
                dialogData = { ...sn.data(), id: sn.id, isEdit: true };
                config.width = '600px';
            }

            if (dialogComponent) {
                const ref = this.dialog.open(dialogComponent, { ...config, data: dialogData });
                ref.afterClosed().subscribe(result => {
                    if (result) {
                        const effectiveCompanyId = this.session.adminScopeCompanyId() ||
                            this.session.user()?.companyId || undefined;
                        this.loadDashboardData(effectiveCompanyId);
                    }
                });
            }
        } catch (err) {
            console.error('Erro ao abrir item:', err);
        } finally {
            this.loading.set(false);
            this.cd.markForCheck();
        }
    }

    // Adicione no DashboardComponent

// Total de itens Em Dia (Geral)
    public totalEmDiaGeral = computed(() =>
        this.licencasEmDia() + this.condCumpridas() + this.episOk()
    );

// Total de itens A Vencer (Geral)
    public totalAVencerGeral = computed(() =>
        this.licencasAVencer() + this.condAVencer() + this.episAVencer()
    );

// Total de itens Irregulares (Geral) - vencidos
    public totalIrregularesGeral = computed(() =>
        this.licencasVencidas() + this.condVencidas() + this.episVencidos()
    );
}