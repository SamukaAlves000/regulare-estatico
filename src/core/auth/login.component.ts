import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AuditLogService } from '../services/audit-log.service';
import { UsersRepository } from '../services/users.repository';
import { AuditAction } from '../models/audit-log.model';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly auditLog = inject(AuditLogService);
  private readonly usersRepo = inject(UsersRepository);

  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  onSubmit() {
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(email!, password!)
      .subscribe({
        next: async (cred) => {
          try {
            const user = await this.usersRepo.getById(cred.user.uid);
            await this.auditLog.log({
              action: AuditAction.LOGIN_SUCCESS,
              appVersion: '',
              osVersion: '',
              details: {
                method: 'email_password',
                userAgent: navigator.userAgent
              },
              user_profile: user?.profile || 'UNKNOWN',
              userEmail: cred.user.email || email!,
              userId: cred.user.uid
            });
          } catch (logError) {
            console.error('Erro ao registrar log de auditoria:', logError);
          }
          this.router.navigateByUrl('/app');
        },
        error: (err) => {
          this.error.set('Falha no login. Verifique suas credenciais.');
          this.loading.set(false);
          this.auditLog.logError(AuditAction.LOGIN_ERROR, err, { email: this.form.value.email });
        }
      });
  }
}
