import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { Auth, sendPasswordResetEmail } from '@angular/fire/auth';
import { AuditLogService } from '../services/audit-log.service';
import { AuditAction } from '../models/audit-log.model';

type PageState = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    RouterModule,
  ],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordComponent {
  private readonly fb       = inject(FormBuilder);
  private readonly auth     = inject(Auth);
  private readonly auditLog = inject(AuditLogService);

  state = signal<PageState>('idle');

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  get loading() { return this.state() === 'loading'; }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading) return;

    const email = this.form.getRawValue().email!.trim();
    this.state.set('loading');

    try {
      await sendPasswordResetEmail(this.auth, email, {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      });
    } catch {
      // Silencia erros — nunca revelamos se o e-mail existe ou não
    }

    // Log independente do resultado (e-mail pode não existir — é normal)
    this.auditLog.log({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      appVersion: '',
      osVersion: '',
      user_profile: 'UNKNOWN',
      userEmail: email,
      userId: '',
      details: { email, userAgent: navigator.userAgent },
    }).catch(() => {});

    this.state.set('success');
  }
}