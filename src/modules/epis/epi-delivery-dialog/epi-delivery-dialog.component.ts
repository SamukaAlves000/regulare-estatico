import { ChangeDetectionStrategy, Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormControl } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { QRCodeModule } from 'angularx-qrcode';
import { Subscription, Observable, of, from } from 'rxjs';
import * as pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import * as QRCode from 'qrcode';

(pdfMake as any).vfs = (pdfFonts as any).pdfMake ? (pdfFonts as any).pdfMake.vfs : (pdfFonts as any).vfs;
import { CompaniesService } from '../../cadastros/services/companies.service';
import { UnitsRepository } from '../../cadastros/repositories/units.repository';
import { SectorsFiltersRepository } from '../../cadastros/repositories/sectors-filters.repository';
import { EmployeesRepository } from '../../cadastros/repositories/employees.repository';
import { CompanyRisksService } from '../../cadastros/services/company-risks.service';
import { CompanyEquipmentsService } from '../../cadastros/services/company-equipments.service';
import { CompanyCargosService } from '../../cadastros/services/company-cargos.service';
import { EquipmentsRepository } from '../../cadastros/repositories/equipments.repository';
import { SessionService } from '../../../core/services/session.service';
import { EquipmentDialogComponent } from '../../cadastros/equipments/equipment-dialog.component';
import { RiskDialogComponent } from '../../cadastros/risks/risk-dialog.component';
import { StorageService } from '../../../core/services/storage.service';
import { AuditHistoryDialogComponent, AuditHistoryData } from '../../../core/components/audit-history-dialog.component';
import { ref, getBytes, Storage } from '@angular/fire/storage';
import { EpiDeliveriesService } from '../services/epi-deliveries.service';
import { Unsubscribe } from 'firebase/firestore';

@Component({
    selector: 'app-epi-delivery-dialog',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatDialogModule,
        MatSelectModule,
        MatIconModule,
        MatTooltipModule,
        MatCheckboxModule,
        MatTableModule,
        MatSnackBarModule,
        MatProgressBarModule,
        MatDividerModule,
        QRCodeModule,
    ],
    templateUrl: './epi-delivery-dialog.component.html',
    styleUrls: ['./epi-delivery-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpiDeliveryDialogComponent implements OnInit, OnDestroy {
    form!: FormGroup;
    isEdit = false;
    submitted = false;

    companies: any[] = [];
    units: any[] = [];
    sectors: any[] = [];
    employees: any[] = [];

    selectedEmployee: any = null;
    companyRisks: any[] = [];
    allCompanyRisks: any[] = [];
    suggestedEquipments: any[] = [];

    selectedRisksIds: string[] = [];
    deliveryItems: any[] = [];

    loading = false;
    companiesLoading = false;
    unitsLoading = false;
    sectorsLoading = false;
    employeesLoading = false;
    loadingInitial = false;

    private readonly fb = inject(FormBuilder);
    private readonly dialogRef = inject(MatDialogRef<EpiDeliveryDialogComponent>);
    public readonly data = inject(MAT_DIALOG_DATA, { optional: true });
    private readonly companiesService = inject(CompaniesService);
    private readonly unitsRepo = inject(UnitsRepository);
    private readonly sectorsRepo = inject(SectorsFiltersRepository);
    private readonly employeesRepo = inject(EmployeesRepository);
    private readonly companyRisksService = inject(CompanyRisksService);
    private readonly companyEquipmentsService = inject(CompanyEquipmentsService);
    private readonly companyCargosService = inject(CompanyCargosService);
    private readonly equipmentsRepo = inject(EquipmentsRepository);
    private readonly session = inject(SessionService);
    private readonly cd = inject(ChangeDetectorRef);
    private readonly snack = inject(MatSnackBar);
    private readonly dialog = inject(MatDialog);
    private readonly storage = inject(StorageService);
    private readonly fireStorage = inject(Storage);
    private readonly epiDeliveriesService = inject(EpiDeliveriesService);

    isCliente = this.session.hasRole(['CLIENTE'] as any);
    displayedColumns: string[] = ['name', 'ca', 'validUntil', 'quantity', 'signature', 'actions'];

    // Estado para arquivo do termo assinado
    selectedFile: File | null = null;
    selectedFileName: string = '';
    currentFileUrl: string = '';
    uploadingFile = false;

    isExpired(dateStr?: string): boolean {
        if (!dateStr) return false;
        try {
            const [d, m, y] = dateStr.split('/').map(Number);
            const date = new Date(y, m - 1, d);
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            return date.getTime() < hoje.getTime();
        } catch {
            return false;
        }
    }

    constructor() {
        this.form = this.fb.group({
            companyId: ['', [Validators.required]],
            unitId: ['', [Validators.required]],
            sectorId: ['', [Validators.required]],
            employeeId: ['', [Validators.required]],
            deliveryDate: [new Date().toISOString().substring(0, 10), [Validators.required]],
            notes: [''],
            signed: [false],
            signatureUrl: [''],
            signatureDate: [''],
        });

        if (this.data) {
            this.isEdit = !!this.data.id;
            this.form.patchValue(this.data, { emitEvent: false });
            if (this.data.items) this.deliveryItems = [...this.data.items];
            if (this.data.riskIds) this.selectedRisksIds = [...this.data.riskIds];
            if (this.data.receiptUrl) this.currentFileUrl = this.data.receiptUrl;
            
            // Novos campos de assinatura
            if (this.data.signed) this.form.get('signed')?.setValue(true);
            if (this.data.signatureUrl) this.form.get('signatureUrl')?.setValue(this.data.signatureUrl);
            if (this.data.signatureDate) this.form.get('signatureDate')?.setValue(this.data.signatureDate);
        }
    }

    async ngOnInit() {
        await this.loadCompanies();

        // Listeners para carregar dependências
        this.form.get('companyId')?.valueChanges.subscribe(cid => {
            this.loadUnits(cid);
            this.loadCompanyRisks(cid);
            this.loadSuggestedEquipments(cid);
            if (!this.loadingInitial) {
                this.resetDownstream('company');
            }
        });

        this.form.get('unitId')?.valueChanges.subscribe(uid => {
            this.loadSectors(this.form.get('companyId')?.value, uid);
            if (!this.loadingInitial) {
                this.resetDownstream('unit');
            }
        });

        this.form.get('sectorId')?.valueChanges.subscribe(sid => {
            this.loadEmployees(this.form.get('companyId')?.value, this.form.get('unitId')?.value, sid);
            if (!this.loadingInitial) {
                this.resetDownstream('sector');
            }
        });

        this.form.get('employeeId')?.valueChanges.subscribe(eid => {
            this.onEmployeeSelected(eid);
        });

        // Se estiver em edição ou se for CLIENTE, carregar dados iniciais
        const initialCid = this.form.get('companyId')?.value;
        if (initialCid) {
            this.loadingInitial = true;
            try {
                await Promise.all([
                    this.loadUnits(initialCid),
                    this.loadCompanyRisks(initialCid),
                    this.loadSuggestedEquipments(initialCid)
                ]);

                const initialUid = this.form.get('unitId')?.value;
                if (initialUid) {
                    await this.loadSectors(initialCid, initialUid);

                    const initialSid = this.form.get('sectorId')?.value;
                    if (initialSid) {
                        await this.loadEmployees(initialCid, initialUid, initialSid);

                        const initialEid = this.form.get('employeeId')?.value;
                        if (initialEid) {
                            await this.onEmployeeSelected(initialEid);
                        }
                    }
                }
            } finally {
                this.loadingInitial = false;
                this.cd.markForCheck();
            }
        }

        if (this.isEdit && this.data?.id) {
            this.signatureSub = this.epiDeliveriesService.listenToDelivery(this.data.id, (updated) => {
                if (updated && updated.signed && !this.form.get('signed')?.value) {
                    this.form.patchValue({
                        signed: true,
                        signatureUrl: updated.signatureUrl,
                        signatureDate: updated.signatureDate
                    });
                    // Também atualizar os dados do objeto local 'data' para o downloadTerm
                    this.data.signed = true;
                    this.data.signatureUrl = updated.signatureUrl;
                    this.data.signatureDate = updated.signatureDate;
                    
                    this.cd.markForCheck();
                    this.snack.open('Assinatura digital detectada!', 'OK', { duration: 3000 });
                }
            });
        }
    }

    ngOnDestroy() {
        if (this.signatureSub) {
            this.signatureSub();
        }
    }

    private async loadCompanies() {
        this.companiesLoading = true;
        this.cd.markForCheck();
        try {
            this.companies = await this.companiesService.listCompanies();
        } finally {
            this.companiesLoading = false;
            this.cd.markForCheck();
        }
    }

    private async loadUnits(companyId: string) {
        if (!companyId) return;
        this.unitsLoading = true;
        this.cd.markForCheck();
        try {
            this.units = await this.unitsRepo.listBy('companyId' as any, companyId, 500);
        } finally {
            this.unitsLoading = false;
            this.cd.markForCheck();
        }
    }

    private async loadSectors(companyId: string, unitId: string) {
        if (!companyId || !unitId) return;
        this.sectorsLoading = true;
        this.cd.markForCheck();
        try {
            this.sectors = await this.sectorsRepo.listByCompanyAndUnit(companyId, unitId, 500);
        } finally {
            this.sectorsLoading = false;
            this.cd.markForCheck();
        }
    }

    private async loadEmployees(companyId: string, unitId: string, sectorId: string) {
        if (!companyId || !unitId || !sectorId) return;
        this.employeesLoading = true;
        this.cd.markForCheck();
        try {
            // Usar o repositório diretamente para filtrar por setor se necessário,
            // ou filtrar em memória se o serviço não der suporte.
            const all = await this.employeesRepo.listByFilters({ companyId, unitId }, 1000);
            this.employees = all.filter(e => e.sectorId === sectorId);
        } finally {
            this.employeesLoading = false;
            this.cd.markForCheck();
        }
    }

    private async loadCompanyRisks(companyId: string) {
        if (!companyId) return;
        try {
            this.allCompanyRisks = await this.companyRisksService.listByCompany(companyId);
            this.filterRisksByCargo();
        } catch (e) {
            console.error('Erro ao carregar riscos da empresa', e);
        }
    }

    private async loadSuggestedEquipments(companyId: string) {
        if (!companyId) return;
        try {
            // Listar apenas EPIs da empresa
            const companyEpis = await this.companyEquipmentsService.listByCompany(companyId).then(list => list.filter(e => e.type === 'EPI'));

            // Se houver cargo selecionado com EPIs, mostrar APENAS os EPIs vinculados ao cargo
            if (this.currentCargoEpiIds && this.currentCargoEpiIds.length > 0) {
                // Filtrar os EPIs da empresa que estão no cargo
                this.suggestedEquipments = companyEpis.filter(e =>
                    this.currentCargoEpiIds.includes(e.id) || this.currentCargoEpiIds.includes(e.sourceEquipmentId)
                );

                // Adicionar os EPIs do cargo que faltam na empresa (para mostrar bloqueados)
                await this.mergeCargoEpiIdsIntoSuggested();
            } else {
                // Se o cargo não tem EPIs, a lista de sugestões fica vazia (UI ocultará a seção)
                this.suggestedEquipments = [];
            }
            this.cd.markForCheck();
        } catch (e) {
            console.error('Erro ao carregar equipamentos da empresa', e);
        }
    }

    private filterRisksByCargo() {
        if (!this.selectedEmployee || !this.currentCargoRiskIds) {
            this.companyRisks = [];
        } else {
            this.companyRisks = this.allCompanyRisks.filter(r =>
                this.currentCargoRiskIds.includes(r.id) || this.currentCargoRiskIds.includes(r.sourceRiskId)
            );
        }
        this.cd.markForCheck();
    }

    private currentCargoEpiIds: string[] = [];
    private currentCargoRiskIds: string[] = [];
    private signatureSub?: Unsubscribe;

    async onEmployeeSelected(employeeId: string) {
        this.selectedEmployee = this.employees.find(e => e.id === employeeId);
        this.currentCargoRiskIds = [];
        this.currentCargoEpiIds = [];

        if (this.selectedEmployee) {
            // Ao selecionar funcionário, busca o cargo dele para saber os riscos e EPIs vinculados
            try {
                const cargo = await this.companyCargosService.listByCompany(this.form.get('companyId')?.value)
                    .then(list => list.find(c => c.id === this.selectedEmployee.cargoId));

                if (cargo) {
                    if (Array.isArray(cargo.riskIds)) {
                        this.currentCargoRiskIds = cargo.riskIds;

                        // Pré-seleciona automaticamente os riscos do cargo se for uma nova entrega
                        if (!this.isEdit) {
                            const newRiskIds = [...new Set([...this.selectedRisksIds, ...cargo.riskIds])];
                            this.selectedRisksIds = newRiskIds;
                        }
                    }

                    if (Array.isArray(cargo.epiIds)) {
                        this.currentCargoEpiIds = cargo.epiIds;
                    }
                }
            } catch (e) {
                console.error('Erro ao carregar dados do cargo', e);
            }
        }

        this.filterRisksByCargo();
        await this.loadSuggestedEquipments(this.form.get('companyId')?.value);
        this.cd.markForCheck();
    }

    toggleRisk(riskId: string) {
        const idx = this.selectedRisksIds.indexOf(riskId);
        if (idx > -1) {
            this.selectedRisksIds.splice(idx, 1);
        } else {
            this.selectedRisksIds.push(riskId);
        }
    }

    isRiskSelected(riskId: string): boolean {
        return this.selectedRisksIds.includes(riskId);
    }

    toggleEquipment(equip: any) {
        const existingIdx = this.deliveryItems.findIndex(item => item.equipmentId === equip.id);
        if (existingIdx > -1) {
            this.deliveryItems.splice(existingIdx, 1);
        } else {
            // Clona o equipamento completo e adiciona campos da entrega
            const { id, createdAt, updatedAt, createdBy, updatedBy, ...cleanEquip } = equip;
            this.deliveryItems.push({
                ...cleanEquip,
                equipmentId: equip.id,
                quantity: 1,
                nextExchangeDate: '',
            });
        }
        this.deliveryItems = [...this.deliveryItems]; // Trigger table update
        this.cd.markForCheck();
    }

    private async mergeCargoEpiIdsIntoSuggested() {
        if (!this.currentCargoEpiIds || this.currentCargoEpiIds.length === 0) return;

        for (const id of this.currentCargoEpiIds) {
            // Verifica se o EPI já está na lista sugerida (pelo ID ou sourceId)
            const exists = this.suggestedEquipments.some(e => e.id === id || e.sourceEquipmentId === id);
            if (!exists) {
                try {
                    // Busca os dados do EPI para exibir (pode ser da empresa ou global)
                    let epi: any = await this.companyEquipmentsService.listByCompany(this.form.get('companyId')?.value)
                        .then(list => list.find(e => e.id === id || e.sourceEquipmentId === id));

                    if (!epi) {
                        epi = await this.equipmentsRepo.getById(id);
                    }

                    if (epi) {
                        this.suggestedEquipments.push(epi);
                    }
                } catch (e) {
                    console.error('Erro ao buscar EPI do cargo para sugestão', e);
                }
            }
        }
        this.suggestedEquipments = [...this.suggestedEquipments];
    }

    isEquipmentBlocked(equip: any): boolean {
        // Se o funcionário não foi selecionado, não bloqueia nada (UI oculta a seção)
        if (!this.selectedEmployee) return false;

        // Verifica se o equipamento é da empresa (cequip_...)
        const isCompanyEquip = equip.id.startsWith('cequip_');

        // Se o equipamento não é da empresa (é genérico equip_...), está bloqueado 
        // porque precisa ser vinculado à empresa primeiro.
        if (!isCompanyEquip) return true;

        // Se é da empresa, verifica se ele (ou seu original) está na lista do cargo
        const allowed = this.currentCargoEpiIds.includes(equip.id) || this.currentCargoEpiIds.includes(equip.sourceEquipmentId);
        return !allowed;
    }

    getEquipmentTooltip(equip: any): string {
        if (!this.isEquipmentBlocked(equip)) return '';

        const isCompanyEquip = equip.id.startsWith('cequip_');
        if (!isCompanyEquip) {
            return 'Este EPI não está vinculado à empresa. Vincule o EPI no cadastro da empresa para permitir a seleção.';
        }

        return 'Vincular o EPI ao cargo do funcionário no empreendimento';
    }

    isEquipmentSelected(equipId: string): boolean {
        return this.deliveryItems.some(item => item.equipmentId === equipId);
    }

    editItem(item: any) {
        // Abre o diálogo com os dados atuais do item (que já contém todos os campos de Equipment)
        const ref = this.dialog.open(EquipmentDialogComponent, {
            width: '700px',
            data: { ...item, id: item.equipmentId, _deliveryContext: true },
            disableClose: true
        });

        ref.afterClosed().subscribe(res => {
            if (res) {
                // Atualiza todos os campos retornados, preservando os campos específicos da entrega
                const { quantity, equipmentId } = item;
                Object.assign(item, res);
                item.equipmentId = equipmentId; // garante que o ID de referência não mude
                item.quantity = quantity;

                this.deliveryItems = [...this.deliveryItems];
                this.cd.markForCheck();
            }
        });
    }

    removeItem(equipId: string) {
        this.deliveryItems = this.deliveryItems.filter(i => i.equipmentId !== equipId);
        this.cd.markForCheck();
    }

    private resetDownstream(level: 'company' | 'unit' | 'sector') {
        if (level === 'company') {
            this.form.patchValue({ unitId: '', sectorId: '', employeeId: '' }, { emitEvent: false });
            this.units = [];
            this.sectors = [];
            this.employees = [];
            this.selectedEmployee = null;
            this.companyRisks = [];
            this.suggestedEquipments = [];
            this.deliveryItems = [];
            this.selectedRisksIds = [];
            this.currentCargoRiskIds = [];
            this.currentCargoEpiIds = [];
            this.allCompanyRisks = [];
        } else if (level === 'unit') {
            this.form.patchValue({ sectorId: '', employeeId: '' }, { emitEvent: false });
            this.sectors = [];
            this.employees = [];
            this.selectedEmployee = null;
        } else if (level === 'sector') {
            this.form.patchValue({ employeeId: '' }, { emitEvent: false });
            this.employees = [];
            this.selectedEmployee = null;
        }
        this.cd.markForCheck();
    }

    save() {
        this.submitted = true;
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }

        if (this.deliveryItems.length === 0) {
            this.snack.open('Selecione ao menos um EPI para entrega.', 'OK', { duration: 3000 });
            return;
        }

        const val = this.form.getRawValue();
        const company = this.companies.find(c => c.id === val.companyId);
        const unit = this.units.find(u => u.id === val.unitId);
        const sector = this.sectors.find(s => s.id === val.sectorId);

        // Capturar dados completos do funcionário se não estiverem no objeto selecionado (caso de edição)
        let employeeData = this.selectedEmployee;
        if (this.isEdit && !this.selectedEmployee && this.data.employeeId) {
            employeeData = this.employees.find(e => e.id === this.data.employeeId) || this.data;
        }

        const payload = {
            ...val,
            employeeName: employeeData?.name,
            employeeCpf: employeeData?.cpf,
            employeeAdmissionDate: employeeData?.admissionDate,
            employeeEsocialRegistration: employeeData?.esocialRegistration,
            cargoId: employeeData?.cargoId,
            cargoName: employeeData?.cargoName,
            cargoCbo: employeeData?.cargoCbo,
            companyName: company?.razaoSocial || company?.name || this.data?.companyName,
            companyCnpj: company?.document || company?.cnpj || this.data?.companyCnpj,
            unitName: unit?.name || this.data?.unitName,
            sectorName: sector?.name || this.data?.sectorName,
            riskIds: this.selectedRisksIds,
            items: this.deliveryItems,
            receiptUrl: this.currentFileUrl,
            receiptName: this.data?.receiptName,
            _fileToUpload: this.selectedFile
        };

        this.dialogRef.close(payload);
    }

    onFileSelected(event: any) {
        const file = event.target.files[0];
        if (file) {
            this.selectedFile = file;
            this.selectedFileName = file.name;
            this.cd.markForCheck();
        }
    }

    cancel() {
        this.dialogRef.close(null);
    }

    openAuditHistory() {
        const auditData: AuditHistoryData = {
            title: `Histórico de Entrega - ${this.data.employeeName}`,
            createdAt: this.data.createdAt,
            createdBy: this.data.createdBy,
            updatedAt: this.data.updatedAt,
            updatedBy: this.data.updatedBy
        };

        this.dialog.open(AuditHistoryDialogComponent, {
            width: '400px',
            data: auditData
        });
    }

    async downloadTerm() {
        if (!this.selectedEmployee && !this.data) {
            this.snack.open('Selecione um funcionário antes de gerar o termo.', 'OK', { duration: 3000 });
            return;
        }

        const val = this.form.getRawValue();
        const company = this.companies.find(c => c.id === val.companyId);
        const unit = this.units.find(u => u.id === val.unitId);
        const sector = this.sectors.find(s => s.id === val.sectorId);
        
        // Em caso de edição onde o funcionário não foi re-selecionado, usar os dados do objeto original (data)
        const emp = this.selectedEmployee || this.data || {};
        const cpf = emp.cpf || emp.employeeCpf || 'N/A';
        const esocial = emp.esocialRegistration || emp.employeeEsocialRegistration || 'N/A';
        const admission = emp.admissionDate || emp.employeeAdmissionDate;
        const cnpj = company?.document || company?.cnpj || this.data?.companyCnpj || 'N/A';

        // Garantir que vfs esteja configurado no momento do uso, caso a inicialização estática falhe
        if (!(pdfMake as any).vfs) {
            (pdfMake as any).vfs = (pdfFonts as any).pdfMake ? (pdfFonts as any).pdfMake.vfs : (pdfFonts as any).vfs;
        }

        let signatureBase64 = null;
        if (this.data?.signed && this.data?.signatureUrl) {
            try {
        this.snack.open('Processando assinatura para o PDF...', 'OK', { duration: 2000 });
        signatureBase64 = await this.getBase64ImageFromURL(this.data.signatureUrl);
        await this.epiDeliveriesService.logDownloadTerm(this.data.id);
      } catch (error) {
                console.error('Erro ao converter assinatura para Base64:', error);
                this.snack.open('Aviso: Erro de segurança (CORS) ao carregar assinatura do Firebase.', 'OK', { duration: 6000 });
                console.warn('DICA: O bucket do Firebase Storage precisa estar configurado para permitir CORS da origem atual.');
            }
        }

        // Geração de QR Code
        let qrCodeBase64 = null;
        const signatureLink = this.getSignatureLink();
        if (signatureLink) {
            try {
                qrCodeBase64 = await QRCode.toDataURL(signatureLink, {
                    width: 150,
                    margin: 1,
                    color: {
                        dark: '#000000',
                        light: '#ffffff'
                    }
                });
            } catch (err) {
                console.error('Erro ao gerar QR Code para o PDF:', err);
            }
        }

        const docDefinition: any = {
            pageSize: 'A4',
            pageMargins: [40, 60, 40, 60],
            content: [
                {
                    text: 'TERMO DE ENTREGA, ORIENTAÇÃO E RESPONSABILIDADE PELO USO DE EPI',
                    style: 'header',
                    alignment: 'center'
                },
                {
                    text: 'Art. 166 e Art. 158 da CLT – NR-06 – NR-01 / GRO / PGR',
                    style: 'subheader',
                    alignment: 'center',
                    margin: [0, 0, 0, 20]
                },

                {
                    stack: [
                        { text: `Nome do empregado: ${emp.name || emp.employeeName}` },
                        { text: `CPF: ${cpf}` },
                        { text: `Matrícula eSocial: ${esocial}` },
                        { text: `Data de Admissão: ${this.formatDate(admission)}` },
                        { text: `Cargo: ${emp.cargoName || 'N/A'}` },
                        { text: `CBO: ${emp.cargoCbo || 'N/A'}` },
                        { text: `Empresa: ${company?.razaoSocial || company?.name || val.companyId}` },
                        { text: `CNPJ: ${cnpj}` },
                        { text: `Unidade: ${unit?.name || val.unitId}` },
                        { text: `Setor: ${sector?.name || val.sectorId}` },
                        { text: `Data da entrega: ${this.formatDate(val.deliveryDate)}` },
                    ],
                    margin: [0, 0, 0, 20]
                },

                {
                    text: 'DECLARAÇÃO DE ENTREGA E ORIENTAÇÃO',
                    style: 'sectionTitle',
                    margin: [0, 10, 0, 5]
                },
                {
                    text: 'Declaro que recebi gratuitamente da empresa os Equipamentos de Proteção Individual (EPIs) abaixo relacionados, adequados aos riscos das atividades por mim desempenhadas, conforme avaliação realizada no Programa de Gerenciamento de Riscos (PGR), em conformidade com o disposto no Art. 166 da Consolidação das Leis do Trabalho (CLT) e na Norma Regulamentadora nº 06 (NR-06).',
                    alignment: 'justify',
                    margin: [0, 0, 0, 10]
                },
                {
                    text: 'Declaro também que recebi orientação quanto ao uso correto, limitações de proteção, guarda, conservação, higienização e obrigatoriedade de utilização dos EPIs durante a jornada de trabalho.',
                    alignment: 'justify',
                    margin: [0, 0, 0, 20]
                },

                {
                    text: 'REGISTRO DE ENTREGA DE EPIs',
                    style: 'sectionTitle',
                    margin: [0, 0, 0, 5]
                },
                {
                    table: {
                        headerRows: 1,
                        widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [
                                { text: 'Data Entrega', style: 'tableHeader' },
                                { text: 'Qtd', style: 'tableHeader' },
                                { text: 'Descrição do EPI', style: 'tableHeader' },
                                { text: 'Fabricante', style: 'tableHeader' },
                                { text: 'Nº CA', style: 'tableHeader' },
                                { text: 'Validade CA', style: 'tableHeader' },
                                { text: 'Tamanho', style: 'tableHeader' },
                                { text: 'Nota Fiscal/Ano', style: 'tableHeader' },
                            ],
                            ...this.deliveryItems.map(item => [
                                this.formatDate(val.deliveryDate),
                                item.quantity.toString(),
                                item.name,
                                item.manufacturer || 'N/A',
                                item.certificationNumber || 'N/A',
                                item.validUntil ? item.validUntil : 'N/A',
                                item.epiSize || 'N/A',
                                item.invoiceNumber || 'N/A',
                            ])
                        ]
                    },
                    margin: [0, 0, 0, 20]
                },

                {
                    text: 'RESPONSABILIDADES DO TRABALHADOR',
                    style: 'sectionTitle',
                    margin: [0, 0, 0, 5]
                },
                {
                    text: 'Nos termos da NR-06 e do Art. 158 da CLT, comprometo-me a:',
                    margin: [0, 0, 0, 5]
                },
                {
                    ul: [
                        'Utilizar os EPIs apenas para a finalidade a que se destinam.',
                        'Utilizar corretamente os equipamentos fornecidos.',
                        'Zelar pela guarda e conservação dos equipamentos.',
                        'Comunicar imediatamente qualquer dano ou perda.',
                        'Devolver os equipamentos substituídos ou quando solicitado.'
                    ],
                    margin: [0, 0, 0, 10]
                },
                {
                    text: 'Estou ciente de que a recusa injustificada ao uso de Equipamento de Proteção Individual poderá caracterizar ato de indisciplina nos termos do Art. 482 da CLT.',
                    alignment: 'justify',
                    margin: [0, 0, 0, 20]
                },

                {
                    text: 'DECLARAÇÃO FINAL',
                    style: 'sectionTitle',
                    margin: [0, 0, 0, 5]
                },
                {
                    text: 'Declaro que recebi os Equipamentos de Proteção Individual acima descritos, que fui devidamente orientado quanto ao seu uso correto e que estou ciente das minhas responsabilidades quanto à sua utilização, conservação e comunicação de eventuais irregularidades.',
                    alignment: 'justify',
                    margin: [0, 0, 0, 20]
                },

                // --- Seção: Assinatura do Empregado ---
                {
                    table: {
                        widths: ['*'],
                        body: [
                            [
                                {
                                    stack: [
                                        { text: 'IDENTIFICAÇÃO E ASSINATURA DO EMPREGADO', bold: true, fontSize: 10, margin: [0, 0, 0, 10] },
                                        {
                                            columns: [
                                                { 
                                                    text: `Data: ${this.data?.signed ? this.formatDateTime(this.data.signatureDate) : '____ / ____ / ______'}`, 
                                                    margin: [0, 0, 0, 10] 
                                                }
                                            ]
                                        },
                                        // Se estiver assinado e o base64 estiver disponível, mostra a imagem da assinatura, caso contrário mostra a linha para assinatura manual
                                        this.data?.signed && signatureBase64 ? 
                                        {
                                            image: 'signatureImage',
                                            width: 200,
                                            alignment: 'center',
                                            margin: [0, 10, 0, 5]
                                        } :
                                        { text: '________________________________________________________________________', alignment: 'center', margin: [0, 20, 0, 0] },
                                        
                                        { text: `Assinatura do Empregado: ${emp.name || emp.employeeName}`, alignment: 'center', fontSize: 9 }
                                    ],
                                    margin: [5, 5, 5, 5]
                                }
                            ]
                        ]
                    },
                    margin: [0, 0, 0, 15]
                },

                // --- Seção: Autenticidade Digital (QR Code e Texto Legal) ---
                this.data?.signed && qrCodeBase64 ? {
                    columns: [
                        {
                            image: 'qrCodeImage',
                            width: 60,
                            alignment: 'left'
                        },
                        {
                            stack: [
                                {
                                    text: `Documento assinado eletronicamente por ${emp.name || emp.employeeName} em ${this.formatDateTime(this.data.signatureDate)}.`,
                                    fontSize: 8,
                                    bold: true,
                                    margin: [0, 5, 0, 2]
                                },
                                {
                                    text: 'A Lei nº 14.063/2020, de 23 de setembro de 2020.',
                                    fontSize: 8,
                                    margin: [0, 0, 0, 2]
                                },
                                {
                                    text: [
                                        { text: 'Verifique a autenticidade deste documento em: ', fontSize: 8 },
                                        { text: signatureLink, fontSize: 8, color: '#1565c0', decoration: 'underline' }
                                    ]
                                }
                            ],
                            margin: [10, 0, 0, 0]
                        }
                    ],
                    margin: [0, 0, 0, 20]
                } : {},

            ],
            footer: (currentPage: number, pageCount: number) => {
                const creator = this.data?.createdBy?.name || 'Sistema';
                const deliveryDateStr = this.formatDate(val.deliveryDate);
                return {
                    stack: [
                        {
                            text: `Entregue por: ${creator} |  Data de entrega: ${deliveryDateStr} | Gerado automaticamente pelo sistema de gestão de EPIs.`,
                            alignment: 'center',
                            fontSize: 8,
                            color: '#666'
                        },
                        {
                            text: `Data de geração: ${new Date().toLocaleString()} - Página ${currentPage} de ${pageCount}`,
                            alignment: 'center',
                            fontSize: 8,
                            color: '#666'
                        }
                    ],
                    margin: [0, 20, 0, 0]
                };
            },
            images: {
                ...(signatureBase64 ? { signatureImage: signatureBase64 } : {}),
                ...(qrCodeBase64 ? { qrCodeImage: qrCodeBase64 } : {})
            },
            styles: {
                header: {
                    fontSize: 14,
                    bold: true,
                    margin: [0, 0, 0, 5]
                },
                subheader: {
                    fontSize: 10,
                    bold: false
                },
                sectionTitle: {
                    fontSize: 11,
                    bold: true,
                    decoration: 'underline'
                },
                tableHeader: {
                    bold: true,
                    fontSize: 9,
                    color: 'black',
                    fillColor: '#eeeeee'
                }
            },
            defaultStyle: {
                fontSize: 10
            }
        };

        const fileName = `termo_epi_${(emp.name || emp.employeeName || 'entrega').replace(/\s+/g, '_')}.pdf`;
        pdfMake.createPdf(docDefinition).download(fileName);
    }

    private async getBase64ImageFromURL(url: string | undefined): Promise<string> {
        if (!url) return Promise.reject('URL não fornecida');

        // Camada 1: Se for um link do Firebase Storage, tentamos buscar via SDK para evitar CORS
        if (url.includes('firebasestorage.googleapis.com')) {
            try {
                // Extrair o caminho do arquivo do URL (entre /o/ e ?)
                const match = url.match(/\/o\/(.+?)\?/);
                if (match && match[1]) {
                    const storagePath = decodeURIComponent(match[1]);
                    const storageRef = ref(this.fireStorage, storagePath);
                    const bytes = await getBytes(storageRef);
                    
                    // Converter bytes para base64 usando chunking para evitar estouro de pilha
                    const bytesArr = new Uint8Array(bytes);
                    const CHUNK_SIZE = 0x8000;
                    let binary = '';
                    for (let i = 0; i < bytesArr.length; i += CHUNK_SIZE) {
                        binary += String.fromCharCode.apply(null, Array.from(bytesArr.subarray(i, i + CHUNK_SIZE)));
                    }
                    return 'data:image/png;base64,' + btoa(binary);
                }
            } catch (err) {
                console.warn('[DEBUG_LOG] SDK getBytes failed, falling back to Canvas:', err);
            }
        }

        // Camada 2: Técnica sugerida pelo usuário (CORS + Canvas -> Base64)
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            // 1. Solicita a imagem com permissão CORS
            img.setAttribute('crossOrigin', 'anonymous');
            
            // Adicionar timestamp para evitar cache que possa ter sido carregado sem CORS anteriormente
            const corsUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
            
            img.onload = () => {
                try {
                    // 2. Desenha a imagem em um elemento <canvas>
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject('Não foi possível obter o contexto do canvas');
                        return;
                    }
                    // @ts-ignore
                    ctx.drawImage(img, 0, 0);
                    
                    // 3. Converte o conteúdo do canvas para uma string Base64
                    const dataURL = canvas.toDataURL('image/png');
                    
                    // 4. Utiliza essa string Base64 (resolve para ser usada no pdfMake)
                    resolve(dataURL);
                } catch (e) {
                    reject(e);
                }
            };
            
            img.onerror = (error) => {
                console.error('[DEBUG_LOG] Error loading image with CORS:', error);
                reject('Error loading image.');
            };
            
            img.src = corsUrl;
        });
    }

    private formatDate(dateStr: string): string {
        if (!dateStr) return 'N/A';
        try {
            const date = new Date(dateStr);
            // Ajusta timezone para evitar problemas de data retroceder um dia
            date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
            return date.toLocaleDateString('pt-BR');
        } catch (e) {
            return dateStr;
        }
    }

    private formatDateTime(dateStr: string | undefined): string {
        if (!dateStr) return '____ / ____ / ______';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString('pt-BR');
        } catch (e) {
            return dateStr;
        }
    }

    getSignatureLink(): string {
        if (!this.data?.id) return '';
        const baseUrl = window.location.origin;
        return `${baseUrl}/assinatura/${this.data.id}`;
    }

    copyLink(link: string) {
        navigator.clipboard.writeText(link).then(() => {
            this.snack.open('Link copiado!', 'Fechar', { duration: 2000 });
        });
    }

    openSignatureLink() {
        const link = this.getSignatureLink();
        if (link) window.open(link, '_blank');
    }
}
