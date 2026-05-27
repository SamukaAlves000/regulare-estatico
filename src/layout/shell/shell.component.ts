import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { TopbarComponent } from '../topbar/topbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { LgpdEnforcerService } from '../../modules/lgpd/services/lgpd-enforcer.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, MatSidenavModule, MatIconModule, RouterOutlet, TopbarComponent, SidebarComponent],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  // Injecting the enforcer activates its effect, which checks LGPD acceptance
  // for CLIENTE users as soon as the session resolves.
  readonly _lgpdEnforcer = inject(LgpdEnforcerService);
}
