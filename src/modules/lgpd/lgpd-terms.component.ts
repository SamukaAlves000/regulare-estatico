import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component, inject, OnInit, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { LgpdTermsService } from './services/lgpd-terms.service';
import { LgpdTermDialogComponent } from './components/lgpd-term-dialog.component';
import { LgpdAcceptDialogComponent } from './components/lgpd-accept-dialog.component';
import { LgpdTerm } from '../../core/models/lgpd-term.model';

@Component({
  selector: 'app-lgpd-terms',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatChipsModule,
  ],
  templateUrl: './lgpd-terms.component.html',
  styleUrls: ['./lgpd-terms.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LgpdTermsComponent implements OnInit {
  private readonly lgpd   = inject(LgpdTermsService);
  private readonly dialog = inject(MatDialog);
  private readonly snack  = inject(MatSnackBar);
  private readonly cdr    = inject(ChangeDetectorRef);

  terms            = signal<LgpdTerm[]>([]);
  acceptanceCounts = signal<Record<string, number>>({});
  loading          = signal(false);

  readonly displayedColumns = ['version', 'title', 'status', 'active', 'createdAt', 'acceptances', 'actions'];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const all = await this.lgpd.listAll();
      this.terms.set(all);
      this.loadCounts(all);
    } catch {
      this.snack.open('Erro ao carregar os termos LGPD', 'OK', { duration: 3000 });
    } finally {
      this.loading.set(false);
      this.cdr.markForCheck();
    }
  }

  private async loadCounts(terms: LgpdTerm[]): Promise<void> {
    const counts: Record<string, number> = {};
    await Promise.allSettled(terms.map(async t => {
      counts[t.id] = await this.lgpd.countAcceptances(t.id);
    }));
    this.acceptanceCounts.set(counts);
    this.cdr.markForCheck();
  }

  openCreate(): void {
    const ref = this.dialog.open(LgpdTermDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { nextVersion: this.computeNextVersion() },
    });
    ref.afterClosed().subscribe(ok => { if (ok) this.load(); });
  }

  openEdit(term: LgpdTerm): void {
    const ref = this.dialog.open(LgpdTermDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { term },
    });
    ref.afterClosed().subscribe(ok => { if (ok) this.load(); });
  }

  openView(term: LgpdTerm): void {
    this.dialog.open(LgpdAcceptDialogComponent, {
      data: { term, user: null, viewOnly: true },
      width: '720px',
      maxWidth: '95vw',
      maxHeight: '92vh',
    });
  }

  async publish(term: LgpdTerm): Promise<void> {
    try {
      await this.lgpd.publishTerm(term.id);
      this.snack.open('Termo publicado com sucesso', 'OK', { duration: 3000 });
      await this.load();
    } catch (e: any) {
      this.snack.open(e?.message ?? 'Erro ao publicar', 'OK', { duration: 4000 });
    }
  }

  async activate(term: LgpdTerm): Promise<void> {
    try {
      await this.lgpd.activateTerm(term.id);
      this.snack.open('Termo ativado como versão vigente', 'OK', { duration: 3000 });
      await this.load();
    } catch (e: any) {
      this.snack.open(e?.message ?? 'Erro ao ativar', 'OK', { duration: 4000 });
    }
  }

  async archive(term: LgpdTerm): Promise<void> {
    try {
      await this.lgpd.archiveTerm(term.id);
      this.snack.open('Termo arquivado', 'OK', { duration: 3000 });
      await this.load();
    } catch (e: any) {
      this.snack.open(e?.message ?? 'Erro ao arquivar', 'OK', { duration: 4000 });
    }
  }

  async version(term: LgpdTerm): Promise<void> {
    try {
      await this.lgpd.versionTerm(term.id);
      this.snack.open(`Nova versão ${this.lgpd.nextPatchVersion(term.version)} criada como rascunho`, 'OK', { duration: 3500 });
      await this.load();
    } catch (e: any) {
      this.snack.open(e?.message ?? 'Erro ao versionar', 'OK', { duration: 4000 });
    }
  }

  fmtDate(iso: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  statusLabel(s: string): string {
    return ({ draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' } as any)[s] ?? s;
  }

  statusColor(s: string): string {
    return ({ draft: 'default', published: 'primary', archived: 'warn' } as any)[s] ?? 'default';
  }

  private computeNextVersion(): string {
    const terms = this.terms();
    if (!terms.length) return 'v1.0';
    const versions = terms
      .map(t => t.version)
      .filter(v => /^v\d+\.\d+$/.test(v))
      .sort((a, b) => this.cmpVer(a, b));
    if (!versions.length) return 'v1.0';
    return this.lgpd.nextPatchVersion(versions[versions.length - 1]);
  }

  private cmpVer(a: string, b: string): number {
    const pa = a.match(/^v?(\d+)\.(\d+)$/) ?? ['', '0', '0'];
    const pb = b.match(/^v?(\d+)\.(\d+)$/) ?? ['', '0', '0'];
    const diff = parseInt(pa[1]) - parseInt(pb[1]);
    return diff !== 0 ? diff : parseInt(pa[2]) - parseInt(pb[2]);
  }
}