import { Routes } from '@angular/router';
import { UsuariosComponent } from './usuarios.component';

export const routes: Routes = [
  { path: '', component: UsuariosComponent, data: { title: 'Gestão de Usuários' } }
];
