export interface GeneratedReport {
    id?: string;
    reportCode: string;
    hash: string;
    companyId: string;
    companyName: string;
    unitId?: string;
    unitName?: string;
    generatedAtUtc: string;
    documentType: 'GRC_REPORT';
    fileName: string;
    pdfUrl?: string;
    valid: boolean;
    createdAt: string;
    emittedByUserId: string;
    emittedByUserName: string;
    emittedByUserEmail: string;
    emittedByUserProfile: string;
    validationUrl: string;
}