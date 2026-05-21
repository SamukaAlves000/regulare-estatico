import { Injectable, inject } from '@angular/core';
import {
    Firestore, collection, query, where,
    getDocs, addDoc, limit,
} from '@angular/fire/firestore';
import { GeneratedReport } from '../models/generated-report.model';

@Injectable({ providedIn: 'root' })
export class DocumentValidationService {
    private readonly firestore = inject(Firestore);
    private readonly COLLECTION = 'generated_reports';

    async generateSequentialCode(): Promise<string> {
        const now = new Date();
        const year  = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day   = String(now.getDate()).padStart(2, '0');
        const prefix = `REL-GRC-${year}-${month}${day}`;

        try {
            const q = query(
                collection(this.firestore, this.COLLECTION),
                where('reportCode', '>=', prefix),
                where('reportCode', '<', prefix + '￿')
            );
            const snap = await getDocs(q);
            const sequence = String(snap.size + 1).padStart(3, '0');
            return `${prefix}-${sequence}`;
        } catch {
            // Fallback se Firestore negar leitura (rules ainda não configuradas)
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            return `${prefix}-${hh}${mm}${ss}`;
        }
    }

    async saveReport(report: Omit<GeneratedReport, 'id'>): Promise<string> {
        const payload = Object.fromEntries(
            Object.entries(report).filter(([, v]) => v !== undefined)
        );
        const docRef = await addDoc(collection(this.firestore, this.COLLECTION), payload);
        return docRef.id;
    }

    async findByHash(hash: string): Promise<GeneratedReport | null> {
        if (!hash) return null;
        const q = query(
            collection(this.firestore, this.COLLECTION),
            where('hash', '==', hash),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0];
        return { ...d.data(), id: d.id } as GeneratedReport;
    }
}