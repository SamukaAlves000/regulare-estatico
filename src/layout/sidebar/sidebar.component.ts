import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SessionService } from '../../core/services/session.service';
import { UserProfile } from '../../core/models/user.model';
import { AlertsService } from '../../core/services/alerts.service';
import { NotificationsPanelComponent } from './notifications-panel.component';

interface MenuItem {
  label: string;
  icon: string;
  path: string;
  roles?: readonly UserProfile[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule, 
    RouterLink, 
    RouterLinkActive, 
    MatListModule, 
    MatIconModule,
    MatBadgeModule,
    MatButtonModule,
    MatDialogModule
  ],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  public readonly alertsService = inject(AlertsService);

  private readonly menu: readonly MenuItem[] = [
    { label: 'Dashboard', icon: 'dashboard', path: '/app/dashboard' },
    { label: 'Obrigação Legal Periódica', icon: 'assignment', path: '/app/licencas' },
    { label: 'Condicionantes', icon: 'rule', path: '/app/condicionantes' },
    { label: 'Entregas EPIs', icon: 'health_and_safety', path: '/app/epis' },
    { label: 'Alertas', icon: 'notifications', path: '/app/alertas' },
    { label: 'Cadastros', icon: 'library_books', path: '/app/cadastros', roles: ['ADMIN', 'CLIENTE'] },
    { label: 'Usuários', icon: 'people', path: '/app/usuarios', roles: ['ADMIN'] },
    { label: 'Termos LGPD', icon: 'policy', path: '/app/lgpd', roles: ['ADMIN'] },
  ] as const;

  readonly visibleMenu = computed(() => {
    const u = this.session.user();
    return this.menu.filter(m => !m.roles || (u && m.roles.includes(u.profile)));
  });

  openNotifications() {
    this.dialog.open(NotificationsPanelComponent, {
      width: '350px',
      position: { right: '0', top: '0' },
      height: '100vh',
      panelClass: 'side-panel-container', // Você pode adicionar CSS no global para remover animação padrão
      hasBackdrop: true,
      exitAnimationDuration: '200ms',
      enterAnimationDuration: '200ms'
    });
  }
}
