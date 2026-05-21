import { ChangeDetectionStrategy, Component, inject, OnInit, ChangeDetectorRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatPaginator, PageEvent, MatPaginatorModule } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { Unsubscribe } from 'firebase/firestore';
import { EpiDeliveriesService } from '../services/epi-deliveries.service';
import { EpiDelivery } from '../models/epi-delivery.model';
import { EpiDeliveryDialogComponent } from '../epi-delivery-dialog/epi-delivery-dialog.component';
import { SessionService } from '../../../core/services/session.service';
import { StorageService } from '../../../core/services/storage.service';
import { ConfirmDeleteDialogComponent } from '../../../core/components/confirm-delete-dialog.component';

@Component({
  selector: 'app-epi-deliveries-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    FormsModule,
    ReactiveFormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatPaginatorModule,
    MatSnackBarModule,
  ],
  templateUrl: './epi-deliveries-list.component.html',
  styleUrls: ['./epi-deliveries-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpiDeliveriesListComponent implements OnInit, OnDestroy {
  private readonly service = inject(EpiDeliveriesService);
  private readonly dialog = inject(MatDialog);
  private readonly cd = inject(ChangeDetectorRef);
  private readonly snack = inject(MatSnackBar);
  private readonly session = inject(SessionService);
  private readonly storage = inject(StorageService);

  displayedColumns: string[] = ['employee', 'cargo', 'date', 'itemsCount', 'actions'];
  dataSource = new MatTableDataSource<EpiDelivery>([]);
  
  loading = false;
  total = 0;
  pageSize = 30;
  pageIndex = 0;
  cursors: any[] = [];
  hasMore = true;
  
  searchControl = new FormControl('');
  private subs = new Subscription();
  private listSub?: Unsubscribe;
  private _reqId = 0;

  @ViewChild(MatPaginator) paginator?: MatPaginator;

  ngOnInit(): void {
    this.subs.add(
      this.searchControl.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
        this.loadPage(0, true);
      })
    );
    this.loadPage(0, true);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.listSub) this.listSub();
  }

  async loadPage(index = 0, reset = false) {
    if (reset) {
      this.pageIndex = index;
      this.cursors = [];
      this.hasMore = true;
    }

    this.loading = true;
    const reqId = ++this._reqId;
    this.cd.markForCheck();

    try {
      if (this.listSub) this.listSub();

      // Se for a primeira página (index 0), podemos usar o listener para tempo real
      if (index === 0 && !this.searchControl.value) {
        this.listSub = this.service.listenToDeliveriesPaged(null, this.pageSize, (res) => {
          if (reqId !== this._reqId) return;
          this.dataSource.data = res.docs;
          this.cursors[0] = res.lastDoc;
          this.hasMore = res.docs.length === this.pageSize;
          this.total = (this.pageIndex + (this.hasMore ? 2 : 1)) * this.pageSize;
          if (this.paginator) {
            this.paginator.length = this.total;
          }
          this.loading = false;
          this.cd.markForCheck();
        });
        return;
      }

      const startAfterDoc = index > 0 ? this.cursors[index - 1] : undefined;
      // Por enquanto a busca por termo não está implementada no repo de entregas, 
      // mas deixamos a estrutura pronta.
      const res: any = await this.service.listDeliveriesPaged(null, this.pageSize, startAfterDoc);
      
      if (reqId !== this._reqId) return;

      this.dataSource.data = res.docs;
      this.cursors[index] = res.lastDoc;
      this.pageIndex = index;
      this.hasMore = res.docs.length === this.pageSize;
      this.total = (this.pageIndex + (this.hasMore ? 2 : 1)) * this.pageSize;

      if (this.paginator) {
        this.paginator.pageIndex = this.pageIndex;
        this.paginator.length = this.total;
      }
    } finally {
      if (reqId === this._reqId) {
        this.loading = false;
        this.cd.markForCheck();
      }
    }
  }

  async onPage(event: PageEvent) {
    this.pageSize = event.pageSize;
    if (event.pageIndex === this.pageIndex) return;
    await this.loadPage(event.pageIndex);
  }

  newDelivery() {
    const ref = this.dialog.open(EpiDeliveryDialogComponent, { width: '900px', disableClose: true });
    ref.afterClosed().subscribe(async (res) => {
      if (!res) return;
      try {
        const file = res._fileToUpload;
        delete res._fileToUpload;

        const id = await this.service.createDelivery(res);

        if (file) {
          const path = `epis/deliveries/${res.companyId}/${id}/receipt`;
          const url = await this.storage.upload(path, await file.arrayBuffer(), file.type);
          await this.service.updateDelivery(id, { receiptUrl: url, receiptName: file.name });
          await this.service.logDocumentUpload(id, file.name);
        }

        this.snack.open('Entrega registrada com sucesso!', 'OK', { duration: 3000 });
        this.loadPage(0, true);
      } catch (e) {
        this.snack.open('Erro ao registrar entrega.', 'OK', { duration: 3000 });
      }
    });
  }

  editDelivery(delivery: EpiDelivery) {
    const ref = this.dialog.open(EpiDeliveryDialogComponent, { width: '900px', data: delivery, disableClose: true });
    ref.afterClosed().subscribe(async (res) => {
      if (!res) return;
      try {
        const file = res._fileToUpload;
        delete res._fileToUpload;

        if (file) {
          const path = `epis/deliveries/${res.companyId}/${delivery.id}/receipt`;
          const url = await this.storage.upload(path, await file.arrayBuffer(), file.type);
          res.receiptUrl = url;
          res.receiptName = file.name;
          await this.service.logDocumentUpload(delivery.id, file.name);
        }

        await this.service.updateDelivery(delivery.id, res);
        this.snack.open('Entrega atualizada com sucesso!', 'OK', { duration: 3000 });
        this.loadPage(0, true);
      } catch (e) {
        this.snack.open('Erro ao atualizar entrega.', 'OK', { duration: 3000 });
      }
    });
  }

  async deleteDelivery(delivery: EpiDelivery) {
    const ref = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: {
        title: 'Excluir Entrega',
        message: `Deseja realmente excluir o registro de entrega para ${delivery.employeeName}?`,
        itemName: delivery.employeeName
      }
    });

    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) return;

      try {
        const user = this.session.user();
        await this.service.updateDelivery(delivery.id, {
          deleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: {
            uid: user?.id || '',
            name: user?.name || 'Sistema',
            email: user?.email || ''
          }
        });

        this.snack.open('Entrega excluída com sucesso!', 'OK', { duration: 2000 });
        this.loadPage(0, true);
      } catch (e) {
        this.snack.open('Erro ao excluir entrega.', 'OK', { duration: 3000 });
      }
    });
  }

    formatDate(dateStr: string): string {
        if (!dateStr) return '-';
        try {
            // CORREÇÃO: Para datas no formato ISO (YYYY-MM-DD), extrair ano, mês e dia manualmente
            // evitando a conversão de timezone que o Date() faz automaticamente

            // Verifica se é formato ISO (YYYY-MM-DD)
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
                return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
            }

            // Para datas no formato DD/MM/YYYY já formatadas
            if (dateStr.match(/^\d{2}\/\d{2}\/\d{4}/)) {
                return dateStr;
            }

            // Fallback: tenta converter normalmente
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('pt-BR');
        } catch {
            return dateStr;
        }
    }
}
