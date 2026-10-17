import { trimCanvas } from '../image';

type Point = { x: number; y: number };

/** Freehand drawing surface (mouse, pen or finger) that exports a trimmed PNG. */
export class SignaturePad {
  color = '#111827';
  private ctx: CanvasRenderingContext2D;
  private strokes: { color: string; points: Point[] }[] = [];
  private current: Point[] | null = null;
  private onChange: () => void;

  constructor(private canvas: HTMLCanvasElement, onChange: () => void = () => {}) {
    this.ctx = canvas.getContext('2d')!;
    this.onChange = onChange;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
  }

  /** Match the backing store to the displayed size; call when the canvas becomes visible. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.redraw();
  }

  isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  clear(): void {
    this.strokes = [];
    this.redraw();
    this.onChange();
  }

  toDataUrl(): string {
    return trimCanvas(this.canvas, 6).toDataURL('image/png');
  }

  private toPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.current = [this.toPoint(e)];
    this.strokes.push({ color: this.color, points: this.current });
    this.redraw();
  };

  private move = (e: PointerEvent) => {
    if (!this.current) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) this.current.push(this.toPoint(ev));
    this.redraw();
  };

  private up = () => {
    if (!this.current) return;
    this.current = null;
    this.onChange();
  };

  private redraw(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = canvas.width / 180;
    for (const { color, points } of this.strokes) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Quadratic curves through segment midpoints give a smooth line.
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }
}
