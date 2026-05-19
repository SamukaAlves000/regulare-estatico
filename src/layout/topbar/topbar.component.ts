import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, OnDestroy, OnInit, signal, effect, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { SessionService } from '../../core/services/session.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { AuditAction } from '../../core/models/audit-log.model';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { Subscription, Observable, merge, of } from 'rxjs';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { CompaniesRepository } from '../../modules/cadastros/repositories/companies.repository';
import { CompaniesService } from '../../modules/cadastros/services/companies.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { AlertsService } from '../../core/services/alerts.service';
import { NotificationsPanelComponent } from '../sidebar/notifications-panel.component';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    MatOptionModule,
    MatBadgeModule,
    FormsModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatDialogModule
  ],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush, // Mantido para performance
})
export class TopbarComponent implements OnDestroy, OnInit {
  @Output() toggle = new EventEmitter<void>();
  readonly session = inject(SessionService);
  private readonly auditLog = inject(AuditLogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly companiesRepo = inject(CompaniesRepository);
  private readonly companiesService = inject(CompaniesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog); // Injetar MatDialog
  public readonly alertsService = inject(AlertsService); // Injetar AlertsService

  title$: Observable<string>;
  private sub: Subscription;

  // estado para UI
  companiesLoading = false;

  // Use método para facilitar uso no template (*ngIf="isAdmin()")
  isAdmin(): boolean {
    return this.session.hasRole(['ADMIN'] as any);
  }

  companies: Array<{ id: string; name: string }> = [];
  // ngModel-friendly property for the select
  selectedCompanyIdModel: string = '';
  private selectedCompanyId = signal<string>('');
  private _loadedCompanies = false;

  constructor(private cd: ChangeDetectorRef) {
    // derive title from deepest activated route data.title or fallback to path segment
    const events$ = this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.computeTitleFromRoute())
    );

    // Emit initial title immediately (so F5 / page load shows correct title), and then follow navigation events
    this.title$ = merge(of(this.computeTitleFromRoute()), events$);

    // subscribe once to keep alive
    this.sub = this.title$.subscribe();

    // Recarrega empresas quando uma nova for criada
    this.sub.add(this.companiesService.companyCreated$.subscribe(() => {
      console.log('[Topbar] Nova empresa detectada, recarregando lista...');
      this._loadedCompanies = false; // Permite recarregar
      this.loadCompaniesForAdmin();
    }));

    // Effect DEVE ser criado no constructor (injection context)
    // Carrega empresas APENAS quando o session terminar de carregar e o usuário for ADMIN
    effect(() => {
      const loading = this.session.loading();
      const user = this.session.user();
      const admin = this.isAdmin();

      console.log('[Topbar effect] loading=', loading, 'user=', user?.email, 'admin=', admin, '_loadedCompanies=', this._loadedCompanies);

      if (loading) return;
      if (!admin || !user) return;
      if (this._loadedCompanies || this.companiesLoading) return;

      this.loadCompaniesForAdmin();
    });
  }

  ngOnInit(): void {
    // effect movido para constructor
  }

  private async loadCompaniesForAdmin() {
    this.companiesLoading = true;
    this.cd.markForCheck();

    try {
      const list: any[] = await this.companiesRepo.listAll(500);
      this.companies = (list || []).map((c: any) => ({ id: c.id, name: c.razaoSocial || c.name }));
      const scopedId = this.session.adminScopeCompanyId();
      this.selectedCompanyIdModel = scopedId ?? '';
      this.selectedCompanyId.set(this.selectedCompanyIdModel);
    } catch (e) {
      console.error('[Topbar] Erro ao carregar empresas (ADMIN). Verifique Firestore Rules para /companies.', e);
      this.companies = [];
    } finally {
      this._loadedCompanies = true;
      this.companiesLoading = false;
      this.cd.markForCheck();
    }
  }

  changingCompany = false;

  async onSelectedCompanyChange(id: string) {
    this.selectedCompanyId.set(id || '');

    // Mostrar loading
    this.changingCompany = true;
    this.cd.markForCheck();

    let companyName = 'Todas as empresas';
    if (!id) {
      this.session.setAdminScopeCompany(null, null);
    } else {
      const comp = this.companies.find(c => c.id === id) || null;
      companyName = comp?.name ?? 'Empresa';
      this.session.setAdminScopeCompany(id, comp?.name ?? null);
    }

    // Feedback visual
    this.snackBar.open(`Escopo alterado para: ${companyName}`, 'OK', { duration: 2000 });

    // Pequeno delay para feedback visual
    await new Promise(r => setTimeout(r, 400));

    this.changingCompany = false;
    this.cd.markForCheck();

    // Redirecionar para dashboard ou forçar reload se já estiver lá
    const currentUrl = this.router.url;
    if (currentUrl.includes('/app/dashboard')) {
      // Força reload navegando para outra rota e voltando
      await this.router.navigateByUrl('/app', { skipLocationChange: true });
      await this.router.navigateByUrl('/app/dashboard');
    } else {
      await this.router.navigateByUrl('/app/dashboard');
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async logout() {
    const user = this.session.user();
    if (user) {
      try {
        await this.auditLog.log({
          action: AuditAction.LOGOUT,
          appVersion: '',
          osVersion: '',
          details: {
            userAgent: navigator.userAgent
          },
          user_profile: user.profile,
          userEmail: user.email,
          userId: user.id
        });
      } catch (e) {
        console.error('[Topbar] Erro ao registrar log de logout:', e);
        // Não usamos logError aqui para evitar recursividade/falha se o log geral já falhou
      }
    }
    this.session.logout();
  }

  userName(): string {
    const u = this.session.user();
    return u?.name ?? 'Usuário';
  }

  companyName(): string {
    if (this.isAdmin()) {
      const name = (this.session as any).adminScopeCompanyName?.();
      return name || 'Todas as empresas';
    }
    const u = this.session.user();
    return (u && (u.name ?? u.name)) ?? '';
  }

  private computeTitleFromRoute(): string {
    let child = this.route.firstChild;
    while (child?.firstChild) child = child.firstChild;
    const dataTitle = child?.snapshot?.data?.['title'];
    if (dataTitle) return dataTitle;
    const url = this.router.url || '';
    const seg = url.split('/').filter(Boolean).at(-1) ?? '';
    return this.humanizeSegment(seg) || 'Dashboard';
  }

  private humanizeSegment(seg: string) {
    if (!seg) return '';
    return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  openNotifications() {
    this.dialog.open(NotificationsPanelComponent, {
      width: '350px',
      position: { right: '0', top: '0' },
      height: '100vh',
      panelClass: 'side-panel-container',
      hasBackdrop: true,
      exitAnimationDuration: '200ms',
      enterAnimationDuration: '200ms'
    });
  }
}
