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
import { Chaperone, Directive, Watcher, WatcherStatus } from '../watcher.model';

declare const L: any;

const STATUS_COLORS: Record<WatcherStatus, string> = {
  OK: '#2ecc71',
  HELP: '#f39c12',
  HELP_IN_PROGRESS: '#3498db',
  EMERGENCY: '#e74c3c',
};

const STATUS_TEXT: Record<WatcherStatus, string> = {
  OK: 'Alles ok',
  HELP: 'Hilfe angefordert',
  HELP_IN_PROGRESS: 'Hilfe ist unterwegs',
  EMERGENCY: 'Notfall gemeldet',
};

const STEP = 0.0009; // Schrittweite der Pfeil-Steuerung

@Component({
  selector: 'app-client',
  standalone: true,
  templateUrl: './client.html',
  styleUrl: './client.scss',
})
export class ClientView implements OnInit, OnDestroy {
  @ViewChild('miniMap', { static: true })
  private mapEl!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(WatcherApi);

  id = '';
  readonly connected = signal(false);
  readonly found = signal(true);
  readonly status = signal<WatcherStatus>('OK');
  readonly instruction = signal('Verbinde …');

  private map: any;
  private vizLayer: any;
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
    setTimeout(() => this.map.invalidateSize(), 0);

    this.map.on('click', (e: any) => this.moveTo(e.latlng.lat, e.latlng.lng));

    this.api.setWatcherControl(this.id, true).subscribe();
    this.connectSocket();
  }

  private connectSocket(): void {
    this.socket = new WebSocket('ws://localhost:8080/ws/state');
    this.socket.onopen = () => this.connected.set(true);
    this.socket.onmessage = (event) => {
      const state = JSON.parse(event.data) as {
        watchers: Watcher[];
        chaperones: Chaperone[];
        directives: Directive[];
      };
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
    const me = watchers.find((w) => w.id === this.id);
    if (!me) {
      this.found.set(false);
      return;
    }
    this.found.set(true);
    this.myLoc = me.location;
    this.status.set(me.status);

    // ALLE Personen zeichnen – ich selbst hervorgehoben (goldener Ring, größer).
    for (const w of watchers) {
      const isMe = w.id === this.id;
      const color = STATUS_COLORS[w.status] ?? '#888888';
      const latlng: [number, number] = [w.location.latitude, w.location.longitude];
      let marker = this.markers.get(w.id);
      if (marker) {
        marker.setLatLng(latlng);
        marker.setRadius(isMe ? 11 : 5);
        marker.setStyle({ color: isMe ? '#f1c40f' : color, fillColor: color, weight: isMe ? 4 : 1, fillOpacity: isMe ? 1 : 0.55 });
      } else {
        marker = L.circleMarker(latlng, {
          radius: isMe ? 11 : 5,
          color: isMe ? '#f1c40f' : color,
          fillColor: color,
          fillOpacity: isMe ? 1 : 0.55,
          weight: isMe ? 4 : 1,
        }).addTo(this.map);
        this.markers.set(w.id, marker);
      }
    }

    // Helfer einblenden
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

    // Karte einmal auf mich zentrieren (danach frei beweglich).
    if (!this.centeredOnce) {
      this.map.setView([me.location.latitude, me.location.longitude], 15, { animate: false });
      this.centeredOnce = true;
    }

    const applicable = directives.filter(
      (d) => d.watcherIds.length === 0 || d.watcherIds.includes(this.id),
    );
    this.drawDirectives(applicable);
    this.instruction.set(this.computeInstruction(applicable, me.status));
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

  private computeInstruction(directives: Directive[], status: WatcherStatus): string {
    if (status === 'EMERGENCY') {
      return '🛑 Bleib wo du bist – Hilfe kommt zu dir.';
    }
    if (directives.some((d) => d.type === 'GATHER')) {
      return '➡️ Begib dich zum markierten Sammelpunkt.';
    }
    if (directives.some((d) => d.type === 'FOLLOW_PATH')) {
      return '➡️ Folge dem markierten Weg.';
    }
    if (directives.some((d) => d.type === 'AVOID')) {
      return '⚠️ Meide den markierten Bereich.';
    }
    if (directives.some((d) => d.type === 'BLOCK')) {
      return '🧱 Achtung: gesperrte Linie in der Nähe.';
    }
    return '✅ Keine Anweisung – du kannst dich frei bewegen.';
  }

  // --- Steuerung (Testversion) ---

  statusColor(): string {
    return STATUS_COLORS[this.status()];
  }

  statusText(): string {
    return STATUS_TEXT[this.status()];
  }

  setStatus(status: WatcherStatus): void {
    this.api.updateWatcherStatus(this.id, status).subscribe();
  }

  nudge(dLat: number, dLng: number): void {
    if (!this.myLoc) {
      return;
    }
    this.api.updateWatcherLocation(this.id, this.myLoc.latitude + dLat, this.myLoc.longitude + dLng).subscribe();
  }

  /** Zentriert die Karte wieder auf mich. */
  recenter(): void {
    if (this.myLoc) {
      this.map.setView([this.myLoc.latitude, this.myLoc.longitude], this.map.getZoom(), { animate: true });
    }
  }

  private moveTo(lat: number, lng: number): void {
    this.api.updateWatcherLocation(this.id, lat, lng).subscribe();
  }

  readonly step = STEP;

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.api.setWatcherControl(this.id, false).subscribe();
    this.socket?.close();
    this.map?.remove();
  }
}
