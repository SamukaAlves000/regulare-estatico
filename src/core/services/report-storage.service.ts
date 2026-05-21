import { Injectable, inject } from '@angular/core';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';

@Injectable({ providedIn: 'root' })
export class ReportStorageService {
    private readonly storage = inject(Storage);

    async uploadPdf(blob: Blob, companyId: string, reportCode: string): Promise<string> {
        const path = `generated-reports/${companyId}/${reportCode}.pdf`;
        const storageRef = ref(this.storage, path);
        await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
        return getDownloadURL(storageRef);
    }
}