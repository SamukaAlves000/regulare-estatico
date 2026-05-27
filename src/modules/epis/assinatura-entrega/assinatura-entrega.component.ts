import { Component, ElementRef, OnInit, ViewChild, AfterViewInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EpiDeliveriesRepository } from '../repositories/epi-deliveries.repository';
import { EpiDeliveriesService } from '../services/epi-deliveries.service';
import { EpiDelivery } from '../models/epi-delivery.model';
import { ref, uploadString, getDownloadURL, Storage } from '@angular/fire/storage';

@Component({
  selector: 'app-assinatura-entrega',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './assinatura-entrega.component.html',
  styleUrls: ['./assinatura-entrega.component.scss']
})
export class AssinaturaEntregaComponent implements OnInit {
  private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvas') set canvas(content: ElementRef<HTMLCanvasElement>) {
    if (content && !this.canvasInitialized) {
      this.canvasRef = content;
      // Pequeno delay para garantir que o elemento está no DOM e com dimensões calculadas
      setTimeout(() => this.initCanvas(), 50);
    }
  }
  
  entregaId: string | null = null;
  entrega: EpiDelivery | null = null;
  loading = true;
  saving = false;
  error = false;
  
  private ctx!: CanvasRenderingContext2D;
  private drawing = false;
  private canvasInitialized = false;

  private readonly route = inject(ActivatedRoute);
  private readonly repository = inject(EpiDeliveriesRepository);
  private readonly epiDeliveriesService = inject(EpiDeliveriesService);
  private readonly storage = inject(Storage);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cd = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.entregaId = this.route.snapshot.paramMap.get('entregaId');
    if (this.entregaId) {
      this.loadEntrega();
    } else {
      this.loading = false;
      this.error = true;
      this.cd.detectChanges();
    }
  }

  async loadEntrega() {
    try {
      this.loading = true;
      this.error = false;
      this.cd.detectChanges();

      if (!this.entregaId) return;
      
      this.entrega = await this.repository.get(this.entregaId);
      
      if (!this.entrega) {
        this.error = true;
      }
    } catch (err) {
      console.error('Error loading entrega:', err);
      this.error = true;
    } finally {
      this.loading = false;
      this.cd.detectChanges();
    }
  }

  initCanvas() {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Tentar novamente se ainda não tiver dimensões (pode ocorrer se o modal/container estiver animando)
      setTimeout(() => this.initCanvas(), 100);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#000';
    this.canvasInitialized = true;
  }

  startDrawing(event: MouseEvent | TouchEvent) {
    if (this.entrega?.signed || this.saving || !this.ctx) return;
    
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();

    this.drawing = true;
    const pos = this.getPosition(event);
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
  }

  draw(event: MouseEvent | TouchEvent) {
    if (!this.drawing || this.entrega?.signed || this.saving || !this.ctx) return;

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();

    const pos = this.getPosition(event);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
  }

  stopDrawing(event?: MouseEvent | TouchEvent) {
    if (!this.drawing || !this.ctx) return;
    
    this.drawing = false;
    this.ctx.closePath();

    if (event) {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
    }
  }

  getPosition(event: MouseEvent | TouchEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    if (event instanceof MouseEvent) {
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    } else {
      const touch = event.touches[0] || event.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    }
  }

  clear() {
    if (!this.ctx || !this.canvasRef) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
  }

  async sign() {
    if (!this.entregaId || !this.entrega || this.saving) return;
    
    this.saving = true;
    this.cd.detectChanges();
    try {
      const dataUrl = this.canvasRef.nativeElement.toDataURL('image/png');
      const storagePath = `signatures/${this.entregaId}_${Date.now()}.png`;
      const storageRef = ref(this.storage, storagePath);
      
      await uploadString(storageRef, dataUrl, 'data_url');
      const downloadUrl = await getDownloadURL(storageRef);
      
      await this.repository.update(this.entregaId, {
        signatureUrl: downloadUrl,
        signatureDate: new Date().toISOString(),
        signed: true
      });
      
      this.snackBar.open('Assinatura salva com sucesso!', 'Fechar', { duration: 3000 });
      await this.loadEntrega();

      // Log audit
      try {
        await this.epiDeliveriesService.logSignature(this.entregaId, { method: 'canvas_direct' });
      } catch (logErr) {
        console.error('Audit log error:', logErr);
      }

    } catch (err) {
      console.error(err);
      this.snackBar.open('Erro ao salvar assinatura.', 'Fechar', { duration: 5000 });
    } finally {
      this.saving = false;
      this.cd.detectChanges();
    }
  }
}
