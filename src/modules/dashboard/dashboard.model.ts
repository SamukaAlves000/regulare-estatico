export interface AgendaItem {
  id?: string;
  date: string;
  type: 'Licença' | 'EPI' | 'Condicionante';
  document: string;
  companyName: string;
  status: 'Em dia' | 'A vencer' | 'Vencida' | 'Pendente' | 'Cumprida';
  daysRemaining?: number;
}

// dashboard.model.ts
// dashboard.model.ts
export interface DashboardStats {
    licenses: {
        total: number;
        emDia: number;
        aVencer: number;
        vencidas: number;
    };
    conditions: {
        total: number;
        cumpridas: number;
        aVencer: number;
        vencidas: number;
        pendentes: number;
    };
    epis: {
        total: number;
        ok: number;
        aVencer: number;
        vencidas: number;
    };
    agenda: AgendaItem[];
    upcoming: AgendaItem[];
}