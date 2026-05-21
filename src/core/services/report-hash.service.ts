import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ReportHashService {
    async sha256(data: string): Promise<string> {
        const msgBuffer = new TextEncoder().encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    buildHashInput(reportCode: string, companyId: string, unitId: string | undefined, generatedAtUtc: string): string {
        return `${reportCode}|${companyId}|${unitId ?? ''}|${generatedAtUtc}`;
    }
}