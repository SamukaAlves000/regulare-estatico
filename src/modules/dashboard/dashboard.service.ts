import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { DashboardStats, AgendaItem } from './dashboard.model';
import { License, LicenseCondition } from '../licencas/models/license.model';
import { EpiDelivery } from '../epis/models/epi-delivery.model';

@Injectable({ providedIn: 'root' })
export class DashboardService {
    private readonly firestore = inject(Firestore);

    // ===========================================================================
    // MESMOS HELPERS DO GrcReportService
    // ===========================================================================
    private startOfDay(d: Date): Date {
        const r = new Date(d);
        r.setHours(0, 0, 0, 0);
        return r;
    }

    private addDays(d: Date, n: number): Date {
        const r = new Date(d);
        r.setDate(r.getDate() + n);
        return r;
    }

    private parseDate(dateStr: string | undefined): Date {
        if (!dateStr) return new Date();

        if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
            return new Date(year, month - 1, day);
        }

        if (dateStr.includes('/')) {
            const [d, m, y] = dateStr.split('/').map(Number);
            return new Date(y, m - 1, d);
        }

        const parsedDate = new Date(dateStr);
        const currentYear = new Date().getFullYear();
        if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() > currentYear + 10) {
            return new Date();
        }
        return parsedDate;
    }

    private daysDiff(dateStr: string | undefined): number {
        if (!dateStr) return 0;
        const d = this.startOfDay(this.parseDate(dateStr));
        const today = this.startOfDay(new Date());
        return Math.round((d.getTime() - today.getTime()) / 86_400_000);
    }

    // ===========================================================================
    // CÁLCULO DE STATUS (MESMA LÓGICA DO GRC)
    // ===========================================================================
    private getLicenseStatus(expirationDate: string | undefined): 'em_dia' | 'a_vencer' | 'vencida' {
        if (!expirationDate) return 'em_dia';

        const today = this.startOfDay(new Date());
        const limit30 = this.addDays(today, 30);
        const expDate = this.parseDate(expirationDate);

        if (expDate < today) return 'vencida';
        if (expDate <= limit30) return 'a_vencer';
        return 'em_dia';
    }

    private getConditionStatus(dueDate: string | undefined, firestoreStatus: string): string {
        if (firestoreStatus === 'cumprida') return 'cumprida';
        if (!dueDate) return 'pendente';

        const today = this.startOfDay(new Date());
        const limit30 = this.addDays(today, 30);
        const dueDateObj = this.parseDate(dueDate);

        if (dueDateObj < today) return 'vencida';
        if (dueDateObj <= limit30) return 'a_vencer';
        return 'pendente';
    }

    private getDeliveryStatus(delivery: EpiDelivery): 'ok' | 'a_vencer' | 'vencido' {
        const today = this.startOfDay(new Date());
        const limit30 = this.addDays(today, 30);

        let temVencido = false;
        let temAVencer = false;

        delivery.items?.forEach(item => {
            const expDate = this.parseDate(item.epiExpirationDate);
            if (expDate < today) {
                temVencido = true;
            } else if (expDate <= limit30) {
                temAVencer = true;
            }
        });

        if (temVencido) return 'vencido';
        if (temAVencer) return 'a_vencer';
        return 'ok';
    }

    // ===========================================================================
    // BUSCA DE DADOS
    // ===========================================================================
    private async fetchData<T>(collectionPath: string, companyId?: string): Promise<T[]> {
        const col = collection(this.firestore, collectionPath);
        const constraints: any[] = [];

        if (companyId) {
            constraints.push(where('companyId', '==', companyId));
        }

        const q = query(col, ...constraints);
        const sn = await getDocs(q);

        // Retorna TODOS os documentos, filtra deleted APÓS a busca
        return sn.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(doc => doc.deleted !== true) as T[];
    }

    // ===========================================================================
    // MÉTODO PRINCIPAL
    // ===========================================================================
    async getStats(companyId?: string): Promise<DashboardStats> {
        const id = (companyId === 'admin' || !companyId) ? undefined : companyId;

        const [licenses, conditions, epiDeliveries] = await Promise.all([
            this.fetchData<License>('licenses', id),
            this.fetchData<LicenseCondition>('licenseConditions', id),
            this.fetchData<EpiDelivery>('epi_deliveries', id)
        ]);

        console.log('[DashboardService] 📊 Licenças encontradas:', licenses.length);
        console.log('[DashboardService] 📋 Condicionantes encontradas:', conditions.length);
        console.log('[DashboardService] 🥾 EPIs encontrados:', epiDeliveries.length);

        // ========================================================================
        // 1. ESTATÍSTICAS DE LICENÇAS
        // ========================================================================
        let licEmDia = 0;
        let licAVencer = 0;
        let licVencidas = 0;

        licenses.forEach(lic => {
            const status = this.getLicenseStatus(lic.expirationDate);
            if (status === 'em_dia') licEmDia++;
            else if (status === 'a_vencer') licAVencer++;
            else licVencidas++;
        });

        console.log('[DashboardService] Licenças: Em Dia=', licEmDia, 'A Vencer=', licAVencer, 'Vencidas=', licVencidas);

        // ========================================================================
        // 2. ESTATÍSTICAS DE CONDICIONANTES
        // ========================================================================
        let condCumpridas = 0;
        let condAVencer = 0;
        let condVencidas = 0;
        let condPendentes = 0;

        conditions.forEach(cond => {
            const status = this.getConditionStatus(cond.dueDate, cond.status);
            if (status === 'cumprida') condCumpridas++;
            else if (status === 'a_vencer') condAVencer++;
            else if (status === 'vencida') condVencidas++;
            else condPendentes++;
        });

        // ========================================================================
        // 3. ESTATÍSTICAS DE EPIs
        // ========================================================================
        let epiOk = 0;
        let epiAVencer = 0;
        let epiVencidos = 0;

        epiDeliveries.forEach(delivery => {
            const status = this.getDeliveryStatus(delivery);
            if (status === 'ok') epiOk++;
            else if (status === 'a_vencer') epiAVencer++;
            else epiVencidos++;
        });

        console.log('[DashboardService] EPIs: OK=', epiOk, 'A Vencer=', epiAVencer, 'Vencidos=', epiVencidos);

        // ========================================================================
        // 4. ITENS PARA AGENDA
        // ========================================================================
        const agendaItems: AgendaItem[] = [];

        // Licenças
        licenses.forEach(lic => {
            const status = this.getLicenseStatus(lic.expirationDate);
            const displayStatus = this.mapStatusToDisplay(status);
            const days = this.daysDiff(lic.expirationDate);

            agendaItems.push({
                id: lic.id,
                date: lic.expirationDate || '',
                type: 'Licença',
                document: lic.documentType || 'Licença',
                // @ts-ignore
                companyName: lic.companyName || 'N/A',
                // @ts-ignore
                status: displayStatus,
                daysRemaining: days
            });
        });

        // Condicionantes
        conditions.forEach(cond => {
            const status = this.getConditionStatus(cond.dueDate, cond.status);
            const displayStatus = this.mapStatusToDisplay(status);
            const days = this.daysDiff(cond.dueDate);

            agendaItems.push({
                id: cond.id,
                date: cond.dueDate || '',
                type: 'Condicionante',
                document: cond.description || 'Condicionante',
                // @ts-ignore
                companyName: cond.companyName || 'N/A',
                // @ts-ignore
                status: displayStatus,
                daysRemaining: days
            });
        });

        // EPIs
        epiDeliveries.forEach(delivery => {
            const status = this.getDeliveryStatus(delivery);
            const displayStatus = this.mapStatusToDisplay(status);

            let piorData: string | undefined;
            let piorDays: number = Infinity;

            delivery.items?.forEach(item => {
                const days = this.daysDiff(item.epiExpirationDate);
                if (days < piorDays) {
                    piorDays = days;
                    piorData = item.epiExpirationDate;
                }
            });

            agendaItems.push({
                id: delivery.id,
                date: piorData || '',
                type: 'EPI',
                document: `EPI - ${delivery.employeeName || 'Entrega'}`,
                companyName: delivery.companyName || 'N/A',
                // @ts-ignore
                status: displayStatus,
                daysRemaining: piorDays !== Infinity ? piorDays : undefined
            });
        });

        // Ordena por data
        const sortedItems = agendaItems
            .filter(i => !!i.date)
            .sort((a, b) => {
                const dateA = this.parseDate(a.date);
                const dateB = this.parseDate(b.date);
                return dateA.getTime() - dateB.getTime();
            });

        const upcoming = sortedItems.filter(i => i.status === 'A vencer' || i.status === 'Vencida').slice(0, 10);
        const fullAgenda = sortedItems.slice(0, 5);

        // ========================================================================
        // 5. RETORNO - GARANTINDO QUE TODOS OS CAMPOS EXISTEM
        // ========================================================================
        const result: DashboardStats = {
            licenses: {
                total: licenses.length,
                emDia: licEmDia,
                aVencer: licAVencer,
                vencidas: licVencidas
            },
            conditions: {
                total: conditions.length,
                cumpridas: condCumpridas,
                aVencer: condAVencer,
                vencidas: condVencidas,
                pendentes: condPendentes
            },
            epis: {
                total: epiDeliveries.length,
                ok: epiOk,
                aVencer: epiAVencer,
                vencidas: epiVencidos
            },
            agenda: fullAgenda,
            upcoming: upcoming
        };

        console.log('[DashboardService] Resultado final:', result);
        console.log('[DashboardService] Total Geral:', result.licenses.total + result.conditions.total + result.epis.total);

        return result;
    }

    // ===========================================================================
    // HELPERS
    // ===========================================================================
    private mapStatusToDisplay(status: string): string {
        switch (status) {
            case 'em_dia': return 'Em dia';
            case 'a_vencer': return 'A vencer';
            case 'vencida': return 'Vencida';
            case 'vencido': return 'Vencido';
            case 'cumprida': return 'Cumprida';
            case 'pendente': return 'Pendente';
            case 'ok': return 'Em dia';
            default: return status;
        }
    }
}