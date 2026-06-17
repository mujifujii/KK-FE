import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { WatcherApi } from '../watcher.api';
import { WS_URL } from '../api-config';
import { ChatBox } from '../chat/chat-box';
import { setMarkerTarget, tweenMarker } from '../marker-anim';
import { Chaperone, ChaperoneMode, ChatMessage, Directive, Watcher, WatcherStatus } from '../watcher.model';

declare const L: any;

const STATUS_COLORS: Record<WatcherStatus, string> = {
  OK: '#2ecc71',
  HELP: '#f39c12',
  HELP_IN_PROGRESS: '#3498db',
  EMERGENCY: '#e74c3c',
};

@Component({
  selector: 'app-chaperone-view',
  standalone: true,
  imports: [ChatBox],
  templateUrl: './chaperone.html',
  styleUrl: './chaperone.scss',
})
export class ChaperoneView implements OnInit, OnDestroy {
  @ViewChild('miniMap', { static: true })
  private mapEl!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(WatcherApi);
  private readonly zone = inject(NgZone);

  id = '';
  readonly connected = signal(false);
  readonly found = signal(true);
  readonly mode = signal<ChaperoneMode>('AUTO');
  readonly targetWatcher = signal<string | null>(null);
  readonly rescues = signal(0);
  readonly chat = signal<ChatMessage[]>([]);
  readonly watcherIds = signal<string[]>([]);
  readonly chatWatcher = signal<string>('');

  private map: any;
  private vizLayer: any;
  private areaLayer: any;
  private meRing: any;
  private readonly markers = new Map<string, any>();
  private readonly chaperoneMarkers = new Map<string, any>();
  private myLoc?: { latitude: number; longitude: number };
  private centeredOnce = false;
  private animId = 0;
  private dirSig = '';
  private chatSig = '';
  private areaSig = '';

  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';

    this.map = L.map(this.mapEl.nativeElement, { preferCanvas: true }).setView([53.5511, 9.9937], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende',
      maxZoom: 19,
    }).addTo(this.map);
    this.vizLayer = L.layerGroup().addTo(this.map);
    this.areaLayer = L.layerGroup().addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 0);

    this.connectSocket();
    this.startMarkerAnimation();
  }

  /** Bewegt die Marker per rAF flüssig zur letzten bekannten Position (~60 fps). */
  private startMarkerAnimation(): void {
    this.zone.runOutsideAngular(() => {
      const loop = (now: number) => {
        this.markers.forEach((m) => tweenMarker(m, now));
        this.chaperoneMarkers.forEach((m) => tweenMarker(m, now));
        if (this.meRing) {
          tweenMarker(this.meRing, now);
        }
        this.animId = requestAnimationFrame(loop);
      };
      this.animId = requestAnimationFrame(loop);
    });
  }

  private connectSocket(): void {
    this.socket = new WebSocket(WS_URL);
    this.socket.onopen = () => this.connected.set(true);
    this.socket.onmessage = (event) => {
      const state = JSON.parse(event.data) as {
        watchers: Watcher[];
        chaperones: Chaperone[];
        directives: Directive[];
        chat: ChatMessage[];
      };
      this.updateChat(state.chat ?? []);
      this.render(state.watchers ?? [], state.chaperones ?? [], state.directives ?? []);
    };
    this.socket.onclose = () => {
      this.connected.set(false);
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connectSocket(), 1500);
      }
    };
  }

  private render(watchers: Watcher[], chaperones: Chaperone[], directives: Directive[]): void {
    const me = chaperones.find((c) => c.id === this.id);
    if (!me) {
      this.found.set(false);
      return;
    }
    this.found.set(true);
    this.myLoc = me.location;
    this.mode.set(me.mode);
    this.targetWatcher.set(me.targetWatcherId);
    this.rescues.set(me.rescues);
    if (this.watcherIds().length !== watchers.length) {
      this.watcherIds.set(
        watchers.map((w) => w.id).sort((a, b) => this.idNum(a) - this.idNum(b)),
      );
    }

    // Personen (kleine Punkte)
    for (const w of watchers) {
      const color = STATUS_COLORS[w.status] ?? '#888888';
      let marker = this.markers.get(w.id);
      if (marker) {
        setMarkerTarget(marker, w.location.latitude, w.location.longitude);
        if (marker.__sig !== w.status) {
          marker.__sig = w.status;
          marker.setStyle({ fillColor: color, color });
        }
      } else {
        marker = L.circleMarker([w.location.latitude, w.location.longitude], { radius: 5, color, fillColor: color, fillOpacity: 0.55, weight: 1 }).addTo(this.map);
        marker.__sig = w.status;
        setMarkerTarget(marker, w.location.latitude, w.location.longitude);
        this.markers.set(w.id, marker);
      }
    }

    // Helfer (🦺)
    for (const c of chaperones) {
      let marker = this.chaperoneMarkers.get(c.id);
      if (marker) {
        setMarkerTarget(marker, c.location.latitude, c.location.longitude);
      } else {
        marker = L.marker([c.location.latitude, c.location.longitude], {
          icon: L.divIcon({ html: '🦺', className: 'chaperone-icon', iconSize: [20, 20], iconAnchor: [10, 10] }),
        }).addTo(this.map);
        setMarkerTarget(marker, c.location.latitude, c.location.longitude);
        this.chaperoneMarkers.set(c.id, marker);
      }
    }

    // Goldener Ring um MICH
    const meLatLng: [number, number] = [me.location.latitude, me.location.longitude];
    if (this.meRing) {
      setMarkerTarget(this.meRing, me.location.latitude, me.location.longitude);
    } else {
      this.meRing = L.circleMarker(meLatLng, { radius: 15, color: '#f1c40f', fillOpacity: 0, weight: 4 }).addTo(this.map);
      setMarkerTarget(this.meRing, me.location.latitude, me.location.longitude);
    }

    // Mein Einsatzbereich nur bei Änderung neu zeichnen
    const areaSig = me.mode === 'AREA' ? JSON.stringify(me.area) : '';
    if (areaSig !== this.areaSig) {
      this.areaSig = areaSig;
      this.areaLayer.clearLayers();
      if (me.mode === 'AREA' && me.area.length >= 3) {
        L.polygon(me.area.map((p) => [p.latitude, p.longitude]), {
          color: '#8e44ad', fillColor: '#8e44ad', fillOpacity: 0.08, weight: 2, dashArray: '4,6',
        }).addTo(this.areaLayer);
      }
    }

    // Befehle der Leitstelle (Kontext)
    this.drawDirectives(directives);

    if (!this.centeredOnce) {
      this.map.setView(meLatLng, 15, { animate: false });
      this.centeredOnce = true;
    }
  }

  private drawDirectives(directives: Directive[]): void {
    const sig = JSON.stringify(directives.map((d) => [d.id, d.type, d.points]));
    if (sig === this.dirSig) {
      return;
    }
    this.dirSig = sig;
    this.vizLayer.clearLayers();
    for (const d of directives) {
      const latlngs = d.points.map((p) => [p.latitude, p.longitude]);
      if (d.type === 'GATHER' && latlngs.length) {
        L.circleMarker(latlngs[0], { radius: 12, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 0.3, weight: 2 }).addTo(this.vizLayer);
      } else if (d.type === 'FOLLOW_PATH') {
        L.polyline(latlngs, { color: '#e74c3c', weight: 4, opacity: 0.85 }).addTo(this.vizLayer);
      } else if (d.type === 'AVOID') {
        L.polygon(latlngs, { color: '#e67e22', fillColor: '#e67e22', fillOpacity: 0.2, weight: 2, dashArray: '6,6' }).addTo(this.vizLayer);
      } else if (d.type === 'BLOCK') {
        L.polyline(latlngs, { color: '#2c3e50', weight: 7, opacity: 0.9 }).addTo(this.vizLayer);
      }
    }
  }

  /** Chat-Signal nur bei echter Änderung setzen (sonst Re-Render pro Frame). */
  private updateChat(chat: ChatMessage[]): void {
    const sig = chat.length + ':' + (chat[chat.length - 1]?.id ?? '');
    if (sig !== this.chatSig) {
      this.chatSig = sig;
      this.chat.set(chat);
    }
  }

  // --- Steuerung ---

  modeText(): string {
    return { AUTO: 'Automatisch (überall)', AREA: 'Nur im Bereich', OFF: 'Pause' }[this.mode()];
  }

  setMode(mode: ChaperoneMode): void {
    this.api.setChaperoneMode(this.id, mode).subscribe();
  }

  private idNum(id: string): number {
    const n = parseInt(id.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  recenter(): void {
    if (this.myLoc) {
      this.map.setView([this.myLoc.latitude, this.myLoc.longitude], this.map.getZoom(), { animate: true });
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animId);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.map?.remove();
  }
}
