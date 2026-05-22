import {Routes} from '@angular/router';
import {AuthGuard} from './core/guards/auth.guard';
import {RoleGuard} from './core/guards/role.guard';

export const routes: Routes = [
    {path: '', pathMatch: 'full', redirectTo: '/login'},
    {
        path: 'login',
        loadComponent: () => import('./core/auth/login.component').then(m => m.LoginComponent)
    },
    {
        path: 'register',
        loadComponent: () => import('./core/auth/register.component').then(m => m.RegisterComponent)
    },
    {
        path: 'recuperar-senha',
        loadComponent: () => import('./core/auth/forgot-password.component').then(m => m.ForgotPasswordComponent)
    },
    {
        path: 'assinatura/:entregaId',
        loadComponent: () => import('./modules/epis/assinatura-entrega/assinatura-entrega.component').then(m => m.AssinaturaEntregaComponent)
    },
    {
        path: 'relatorio-entrega-epi/:entregaId',
        loadComponent: () => import('./modules/epis/relatorio-entrega-epi/relatorio-entrega-epi.component').then(m => m.RelatorioEntregaEpiComponent)
    },
    {
        path: 'relatorio-grc/:companyId',
        loadComponent: () => import('./modules/dashboard/grc-report-public.component').then(m => m.GrcReportPublicComponent)
    },
    {
        path: 'validate/:hash',
        loadComponent: () => import('./modules/validate/validate-document.component').then(m => m.ValidateDocumentComponent)
    },
    {
        path: 'app',
        canActivate: [AuthGuard],
        loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
        children: [
            {path: '', pathMatch: 'full', redirectTo: 'dashboard'},
            {
                path: 'dashboard',
                loadChildren: () => import('./modules/dashboard/dashboard.routes').then(m => m.routes)
            },
            {
                path: 'licencas',
                loadChildren: () => import('./modules/licencas/licencas.routes').then(m => m.routes)
            },
            {
                path: 'condicionantes',
                loadChildren: () => import('./modules/condicionantes/condicionantes.routes').then(m => m.routes)
            },
            {
                path: 'epis',
                loadChildren: () => import('./modules/epis/epis.routes').then(m => m.routes)
            },
            {
                path: 'alertas',
                loadChildren: () => import('./modules/alertas/alertas.routes').then(m => m.routes)
            },
            {
                path: 'cadastros',
                canActivate: [RoleGuard],
                data: {roles: ['ADMIN', 'CLIENTE'] as const},
                loadChildren: () => import('./modules/cadastros/cadastros.routes').then(m => m.routes)
            },
            {
                path: 'usuarios',
                canActivate: [RoleGuard],
                data: {roles: ['ADMIN'] as const},
                loadChildren: () => import('./modules/usuarios/usuarios.routes').then(m => m.routes)
            },
            {
                path: 'lgpd',
                canActivate: [RoleGuard],
                data: {roles: ['ADMIN'] as const},
                loadChildren: () => import('./modules/lgpd/lgpd.routes').then(m => m.routes)
            },
        ]
    },
    {path: '**', redirectTo: '/login'},
];
