import { ChangeDetectionStrategy, Component, inject, OnInit, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { UsuariosService } from './services/usuarios.service';
import { User } from '../../core/models/user.model';
import { Company } from '../cadastros/models/company.model';
import { CompaniesRepository } from '../cadastros/repositories/companies.repository';
import { UserDialogComponent } from './components/user-dialog.component';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    ReactiveFormsModule
  ],
  templateUrl: './usuarios.component.html',
  styleUrls: ['./usuarios.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosComponent implements OnInit {
  private readonly usuariosService = inject(UsuariosService);
  private readonly companiesRepo = inject(CompaniesRepository);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly cd = inject(ChangeDetectorRef);

  users = signal<User[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);

  // Filtros
  searchControl = new FormControl('');
  companyFilter = new FormControl('');

  displayedColumns = ['name', 'email', 'company', 'status', 'actions'];

  async ngOnInit() {
    this.loading.set(true);
    try {
      this.companies.set(await this.companiesRepo.listAll(500));
      await this.loadUsers();
    } finally {
      this.loading.set(false);
    }

    this.searchControl.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => this.loadUsers());

    this.companyFilter.valueChanges.subscribe(() => this.loadUsers());
  }

  async loadUsers() {
    this.loading.set(true);
    try {
      const filters = {
        name: this.searchControl.value || undefined,
        companyId: this.companyFilter.value || undefined
      };
      const result = await this.usuariosService.listUsers(filters);
      this.users.set(result.users);
    } catch (error) {
      this.snack.open('Erro ao carregar usuários', 'OK', { duration: 3000 });
    } finally {
      this.loading.set(false);
      this.cd.markForCheck();
    }
  }

  getCompanyName(id: string) {
    const company = this.companies().find(c => c.id === id);
    return company ? (company.razaoSocial || company.nomeFantasia || company.name) : 'N/A';
  }

  async openUserDialog(user?: User) {
    const dialogRef = this.dialog.open(UserDialogComponent, {
      width: '500px',
      data: user
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) return;

      this.loading.set(true);
      try {
        if (user) {
          await this.usuariosService.updateUser(user.id, result);
          this.snack.open('Usuário atualizado com sucesso', 'OK', { duration: 3000 });
        } else {
          await this.usuariosService.createUser(result);
          this.snack.open('Usuário criado e convite enviado', 'OK', { duration: 3000 });
        }
        await this.loadUsers();
      } catch (error: any) {
        this.snack.open(error?.message || 'Erro ao salvar usuário', 'OK', { duration: 3000 });
      } finally {
        this.loading.set(false);
        this.cd.markForCheck();
      }
    });
  }

  async toggleStatus(user: User) {
    try {
      await this.usuariosService.toggleStatus(user);
      this.snack.open(`Usuário ${user.active ? 'desativado' : 'ativado'} com sucesso`, 'OK', { duration: 3000 });
      await this.loadUsers();
    } catch (error) {
      this.snack.open('Erro ao alterar status', 'OK', { duration: 3000 });
    }
  }

  async resendInvite(user: User) {
    try {
      await this.usuariosService.sendPasswordReset(user.email, user.id);
      this.snack.open('E-mail de redefinição enviado', 'OK', { duration: 3000 });
    } catch (error) {
      this.snack.open('Erro ao enviar e-mail', 'OK', { duration: 3000 });
    }
  }
}
