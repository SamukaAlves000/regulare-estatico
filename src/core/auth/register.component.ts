import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UsersRepository } from '../services/users.repository';
import { AuditLogService } from '../services/audit-log.service';
import { User, UserProfile, UserStatus } from '../models/user.model';
import { AuditAction } from '../models/audit-log.model';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly usersRepo = inject(UsersRepository);
  private readonly auditLog = inject(AuditLogService);
  private readonly router = inject(Router);

  loading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    profile: ['CLIENTE' as UserProfile, [Validators.required]],
    status: ['ATIVO' as UserStatus, [Validators.required]],
    companyId: [''],
  });

  async onSubmit() {
    if (this.form.invalid) return;
    const { name, email, password, profile, status, companyId } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.success.set(false);

    try {
      const cred = await this.auth.register(email!, password!);
      const uid = cred.user?.uid as string;
      const now = new Date().toISOString();
      const user: User = {
        id: uid,
        name: name!,
        email: email!,
        profile: profile!,
        companyId: (companyId ?? '')!,
        status: status!,
        active: status === 'ATIVO',
        createdAt: now,
      };
      await this.usersRepo.set(user);
      
      try {
        await this.auditLog.log({
          action: AuditAction.USER_REGISTERED,
          appVersion: '',
          osVersion: '',
          details: {
            profile: user.profile,
            method: 'register_form'
          },
          user_profile: user.profile,
          userEmail: user.email,
          userId: user.id
        });
      } catch (logErr) {
        console.error('Erro ao logar registro de usuário:', logErr);
      }

      this.success.set(true);
      // Opcional: navegar para login
      await this.router.navigateByUrl('/login');
    } catch (e: any) {
      const message = this.normalizeError(e);
      this.error.set(message);
      this.auditLog.logError(AuditAction.USER_REGISTER_ERROR, e, { email: this.form.value.email, name: this.form.value.name });
    } finally {
      this.loading.set(false);
    }
  }

  private normalizeError(e: any): string {
    const code: string | undefined = e?.code;
    if (!code) return 'Falha ao cadastrar. Tente novamente.';
    switch (code) {
      case 'auth/email-already-in-use': return 'Email já está em uso.';
      case 'auth/invalid-email': return 'Email inválido.';
      case 'auth/weak-password': return 'Senha fraca. Use pelo menos 6 caracteres.';
      default: return 'Falha ao cadastrar. Tente novamente.';
    }
  }
}
