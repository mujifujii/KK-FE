import {
  Component,
  ElementRef,
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

  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';

    this.map = L.map(this.mapEl.nativeElement).setView([53.5511, 9.9937], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende',
      maxZoom: 19,
    }).addTo(this.map);
    this.vizLayer = L.layerGroup().addTo(this.map);
    this.areaLayer = L.layerGroup().addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 0);

    this.connectSocket();
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
      this.chat.set(state.chat ?? []);
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
      const latlng: [number, number] = [w.location.latitude, w.location.longitude];
      let marker = this.markers.get(w.id);
      if (marker) {
        marker.setLatLng(latlng);
        marker.setStyle({ fillColor: color, color });
      } else {
        marker = L.circleMarker(latlng, { radius: 5, color, fillColor: color, fillOpacity: 0.55, weight: 1 }).addTo(this.map);
        this.markers.set(w.id, marker);
      }
    }

    // Helfer (🦺)
    for (const c of chaperones) {
      const latlng: [number, number] = [c.location.latitude, c.location.longitude];
      let marker = this.chaperoneMarkers.get(c.id);
      if (marker) {
        marker.setLatLng(latlng);
      } else {
        marker = L.marker(latlng, {
          icon: L.divIcon({ html: '🦺', className: 'chaperone-icon', iconSize: [20, 20], iconAnchor: [10, 10] }),
        }).addTo(this.map);
        this.chaperoneMarkers.set(c.id, marker);
      }
    }

    // Goldener Ring um MICH
    const meLatLng: [number, number] = [me.location.latitude, me.location.longitude];
    if (this.meRing) {
      this.meRing.setLatLng(meLatLng);
    } else {
      this.meRing = L.circleMarker(meLatLng, { radius: 15, color: '#f1c40f', fillOpacity: 0, weight: 4 }).addTo(this.map);
    }

    // Mein Einsatzbereich
    this.areaLayer.clearLayers();
    if (me.mode === 'AREA' && me.area.length >= 3) {
      L.polygon(me.area.map((p) => [p.latitude, p.longitude]), {
        color: '#8e44ad', fillColor: '#8e44ad', fillOpacity: 0.08, weight: 2, dashArray: '4,6',
      }).addTo(this.areaLayer);
    }

    // Befehle der Leitstelle (Kontext)
    this.drawDirectives(directives);

    if (!this.centeredOnce) {
      this.map.setView(meLatLng, 15, { animate: false });
      this.centeredOnce = true;
    }
  }

  private drawDirectives(directives: Directive[]): void {
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.map?.remove();
  }
}
