import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { WatcherApi } from '../watcher.api';
import { WS_URL } from '../api-config';
import { ChatBox } from '../chat/chat-box';
import {
  Chaperone,
  ChaperoneMode,
  ChatMessage,
  Directive,
  DirectiveType,
  HelpEvent,
  Location,
  Watcher,
  WatcherStatus,
} from '../watcher.model';

// Leaflet (+ heat-Plugin) werden per CDN in index.html geladen -> global verfügbar.
declare const L: any;

type Tool = 'none' | 'select' | 'gather' | 'path' | 'zone' | 'block' | 'charea';

const STATUS_COLORS: Record<WatcherStatus, string> = {
  OK: '#2ecc71',
  HELP: '#f39c12',
  HELP_IN_PROGRESS: '#3498db',
  EMERGENCY: '#e74c3c',
};

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [ChatBox],
  templateUrl: './map.html',
  styleUrl: './map.scss',
})
export class MapComponent implements OnInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private mapContainer!: ElementRef<HTMLDivElement>;

  private readonly api = inject(WatcherApi);
  private readonly router = inject(Router);
  private map: any;
  private readonly markers = new Map<string, any>();
  private readonly chaperoneMarkers = new Map<string, any>();
  private latestWatchers: Watcher[] = [];

  // WebSocket
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  readonly connected = signal(false);

  // UI-Status
  readonly watcherCount = signal(0);
  readonly selectedCount = signal(0);
  readonly tool = signal<Tool>('none');
  readonly target = signal<'all' | 'selection'>('all');
  readonly heatOn = signal(false);
  readonly counts = signal({ OK: 0, HELP: 0, HELP_IN_PROGRESS: 0, EMERGENCY: 0 });
  readonly directives = signal<Directive[]>([]);
  readonly chaperones = signal<Chaperone[]>([]);
  readonly log = signal<HelpEvent[]>([]);
  readonly areaTarget = signal<string | null>(null); // welcher Helfer bekommt gerade einen Bereich
  readonly controlledId = signal<string | null>(null);     // welche Person gerade selbst gesteuert wird
  readonly controlledStatus = signal<WatcherStatus | null>(null);
  readonly watcherIdList = signal<string[]>([]);           // für das Spieler-Sicht-Dropdown
  readonly selectedViewId = signal<string>('');
  readonly selectedChaperoneViewId = signal<string>('');
  readonly chat = signal<ChatMessage[]>([]);
  readonly chatPartner = signal<string>('');
  readonly dashboardOpen = signal(true);

  // Auswahl & Zeichnen
  private selectedIds = new Set<string>();
  private dragStart: any = null;
  private freehand: any[] = [];
  private draftLayer: any;
  private vizLayer: any;
  private areaLayer: any;
  private heatLayer: any;

  ngOnInit(): void {
    this.map = L.map(this.mapContainer.nativeElement).setView([53.5511, 9.9937], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende',
      maxZoom: 19,
    }).addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 0);

    this.vizLayer = L.layerGroup().addTo(this.map);
    this.areaLayer = L.layerGroup().addTo(this.map);

    this.map.on('mousedown', (e: any) => this.onDown(e));
    this.map.on('mousemove', (e: any) => this.onMove(e));
    this.map.on('mouseup', (e: any) => this.onUp(e));
    this.map.on('click', (e: any) => this.onClick(e));

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
        log: HelpEvent[];
        chat: ChatMessage[];
      };
      this.renderWatchers(state.watchers ?? []);
      this.renderChaperones(state.chaperones ?? []);
      this.renderDirectives(state.directives ?? []);
      this.log.set(state.log ?? []);
      this.chat.set(state.chat ?? []);
    };
    this.socket.onclose = () => {
      this.connected.set(false);
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connectSocket(), 1500);
      }
    };
  }

  // --- Werkzeuge & Ziel ---

  setTool(tool: Tool): void {
    this.tool.set(this.tool() === tool ? 'none' : tool);
    if (this.tool() !== 'charea') {
      this.areaTarget.set(null);
    }
    if (this.tool() === 'none') {
      this.map.dragging.enable();
    } else {
      this.map.dragging.disable();
    }
    this.clearDraft();
  }

  setTarget(target: 'all' | 'selection'): void {
    this.target.set(target);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.selectedCount.set(0);
  }

  clearAll(): void {
    this.api.clearDirectives().subscribe();
    this.clearSelection();
  }

  toggleHeat(): void {
    this.heatOn.set(!this.heatOn());
    if (this.heatOn()) {
      this.updateHeat();
    } else {
      this.heatLayer?.remove();
      this.heatLayer = undefined;
    }
  }

  removeDirective(id: string): void {
    this.api.removeDirective(id).subscribe();
  }

  /** Wechselt zur Spieler-Sicht der im Dropdown gewählten Person. */
  openPlayerView(): void {
    const id = this.selectedViewId();
    if (id) {
      this.router.navigate(['/client', id]);
    }
  }

  /** Wechselt zur Helfer-Sicht des im Dropdown gewählten Chaperones. */
  openChaperoneView(): void {
    const id = this.selectedChaperoneViewId();
    if (id) {
      this.router.navigate(['/chaperone', id]);
    }
  }

  private idNum(id: string): number {
    const n = parseInt(id.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  // --- Eine Person selbst steuern (innerhalb der Leitstellen-Ansicht) ---

  readonly step = 0.0009;

  /** Klick auf eine Person (ohne aktives Werkzeug) = übernehmen. */
  private onWatcherClick(id: string): void {
    if (this.tool() !== 'none') {
      return; // beim Zeichnen/Auswählen nicht stören
    }
    this.takeControl(id);
  }

  private takeControl(id: string): void {
    if (this.controlledId() === id) {
      return;
    }
    const previous = this.controlledId();
    if (previous) {
      this.api.setWatcherControl(previous, false).subscribe();
    }
    this.controlledId.set(id);
    this.api.setWatcherControl(id, true).subscribe();
  }

  releaseControl(): void {
    const id = this.controlledId();
    if (id) {
      this.api.setWatcherControl(id, false).subscribe();
    }
    this.controlledId.set(null);
    this.controlledStatus.set(null);
  }

  controlStatus(status: WatcherStatus): void {
    const id = this.controlledId();
    if (id) {
      this.api.updateWatcherStatus(id, status).subscribe();
    }
  }

  nudgeControlled(dLat: number, dLng: number): void {
    const id = this.controlledId();
    if (!id) {
      return;
    }
    const me = this.latestWatchers.find((w) => w.id === id);
    if (!me) {
      return;
    }
    this.api
      .updateWatcherLocation(id, me.location.latitude + dLat, me.location.longitude + dLng)
      .subscribe();
  }

  // --- Chaperone-Steuerung ---

  toggleChaperone(c: Chaperone, field: 'blockers' | 'zones', value: boolean): void {
    this.api
      .updateChaperoneSettings({
        chaperoneIds: [c.id],
        ignoreBlockers: field === 'blockers' ? value : undefined,
        ignoreZones: field === 'zones' ? value : undefined,
      })
      .subscribe();
  }

  setAllChaperones(field: 'blockers' | 'zones', value: boolean): void {
    this.api
      .updateChaperoneSettings({
        chaperoneIds: [],
        ignoreBlockers: field === 'blockers' ? value : undefined,
        ignoreZones: field === 'zones' ? value : undefined,
      })
      .subscribe();
  }

  setMode(c: Chaperone, mode: ChaperoneMode): void {
    this.api.setChaperoneMode(c.id, mode).subscribe();
  }

  /** Startet das Zeichnen eines Einsatzbereichs für diesen Helfer. */
  startAreaAssign(c: Chaperone): void {
    this.areaTarget.set(c.id);
    this.tool.set('charea');
    this.map.dragging.disable();
    this.clearDraft();
  }

  // --- Leaflet-Maus-Events ---

  private onDown(e: any): void {
    const tool = this.tool();
    if (tool === 'path' || tool === 'block') {
      this.freehand = [e.latlng];
      this.dragStart = e.latlng;
    } else if (tool === 'select' || tool === 'zone' || tool === 'charea') {
      this.dragStart = e.latlng;
    }
  }

  private onMove(e: any): void {
    if (!this.dragStart) {
      return;
    }
    const tool = this.tool();
    if (tool === 'path') {
      this.freehand.push(e.latlng);
      this.drawDraftLine(this.freehand, '#3498db');
    } else if (tool === 'block') {
      this.freehand.push(e.latlng);
      this.drawDraftLine(this.freehand, '#2c3e50');
    } else if (tool === 'select') {
      this.drawDraftRect(this.dragStart, e.latlng, '#9b59b6');
    } else if (tool === 'zone') {
      this.drawDraftRect(this.dragStart, e.latlng, '#e67e22');
    } else if (tool === 'charea') {
      this.drawDraftRect(this.dragStart, e.latlng, '#8e44ad');
    }
  }

  private onUp(e: any): void {
    if (!this.dragStart) {
      return;
    }
    const tool = this.tool();
    if (tool === 'path' || tool === 'block') {
      if (this.freehand.length >= 2) {
        const pts = this.freehand.map((ll) => this.toLocation(ll));
        this.assign(tool === 'path' ? 'FOLLOW_PATH' : 'BLOCK', pts);
      }
      this.freehand = [];
    } else if (tool === 'select') {
      this.selectWithin(this.dragStart, e.latlng);
    } else if (tool === 'zone') {
      this.assign('AVOID', this.rectPolygon(this.dragStart, e.latlng));
    } else if (tool === 'charea') {
      const id = this.areaTarget();
      if (id) {
        this.api.setChaperoneArea(id, this.rectPolygon(this.dragStart, e.latlng)).subscribe();
      }
      this.areaTarget.set(null);
      this.tool.set('none');
      this.map.dragging.enable();
    }
    this.dragStart = null;
    this.clearDraft();
  }

  private onClick(e: any): void {
    if (this.tool() !== 'gather') {
      return;
    }
    this.assign('GATHER', [this.toLocation(e.latlng)]);
  }

  // --- Auswahl & Zuweisung ---

  private selectWithin(a: any, b: any): void {
    const bounds = L.latLngBounds(a, b);
    this.selectedIds = new Set(
      this.latestWatchers
        .filter((w) => bounds.contains([w.location.latitude, w.location.longitude]))
        .map((w) => w.id),
    );
    this.selectedCount.set(this.selectedIds.size);
  }

  private assign(type: DirectiveType, points: Location[]): void {
    const global = type === 'AVOID' || type === 'BLOCK';
    const watcherIds =
      !global && this.target() === 'selection' ? Array.from(this.selectedIds) : [];
    this.api.assignDirective({ type, points, watcherIds }).subscribe();
  }

  // --- Rendern ---

  private renderWatchers(watchers: Watcher[]): void {
    this.latestWatchers = watchers;
    this.watcherCount.set(watchers.length);
    const counts = { OK: 0, HELP: 0, HELP_IN_PROGRESS: 0, EMERGENCY: 0 };

    const controlled = this.controlledId();
    for (const w of watchers) {
      counts[w.status]++;
      if (w.id === controlled) {
        this.controlledStatus.set(w.status);
      }
      const isControlled = w.id === controlled;
      const selected = this.selectedIds.has(w.id);
      const color = STATUS_COLORS[w.status] ?? '#888888';
      const ring = isControlled ? '#f1c40f' : selected ? '#ffffff' : color;
      const radius = isControlled ? 10 : selected ? 9 : 6;
      const weight = isControlled ? 4 : selected ? 3 : 1;
      const latlng: [number, number] = [w.location.latitude, w.location.longitude];
      let marker = this.markers.get(w.id);

      if (marker) {
        marker.setLatLng(latlng);
        marker.setRadius(radius);
        marker.setStyle({ color: ring, fillColor: color, weight });
      } else {
        marker = L.circleMarker(latlng, {
          radius,
          color: ring,
          fillColor: color,
          fillOpacity: 0.9,
          weight,
        }).addTo(this.map);
        marker.on('click', () => this.onWatcherClick(w.id));
        this.markers.set(w.id, marker);
      }
      marker.bindPopup(`<b>${w.id}</b><br>Status: ${w.status}`);
    }

    this.counts.set(counts);

    // Dropdown-Liste nur bei Änderung der Anzahl neu setzen (kein Flackern pro Frame).
    if (this.watcherIdList().length !== watchers.length) {
      this.watcherIdList.set(watchers.map((w) => w.id).sort((a, b) => this.idNum(a) - this.idNum(b)));
    }

    if (this.heatOn()) {
      this.updateHeat();
    }
  }

  private renderChaperones(chaperones: Chaperone[]): void {
    this.chaperones.set(chaperones);

    // Marker
    for (const c of chaperones) {
      const latlng: [number, number] = [c.location.latitude, c.location.longitude];
      let marker = this.chaperoneMarkers.get(c.id);
      if (marker) {
        marker.setLatLng(latlng);
      } else {
        marker = L.marker(latlng, {
          icon: L.divIcon({
            html: '🦺',
            className: 'chaperone-icon',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(this.map);
        this.chaperoneMarkers.set(c.id, marker);
      }
      const info = c.mode === 'OFF' ? 'Pause' : c.targetWatcherId ? `hilft ${c.targetWatcherId}` : 'bereit';
      marker.bindPopup(`<b>Helfer ${c.id}</b><br>${info}<br>Einsätze: ${c.rescues}`);
    }

    // Einsatzbereiche
    this.areaLayer.clearLayers();
    for (const c of chaperones) {
      if (c.mode === 'AREA' && c.area.length >= 3) {
        L.polygon(
          c.area.map((p) => [p.latitude, p.longitude]),
          { color: '#8e44ad', fillColor: '#8e44ad', fillOpacity: 0.08, weight: 2, dashArray: '4,6' },
        )
          .bindTooltip(`Bereich ${c.id}`, { permanent: false })
          .addTo(this.areaLayer);
      }
    }
  }

  private renderDirectives(directives: Directive[]): void {
    this.directives.set(directives);
    this.vizLayer.clearLayers();
    for (const d of directives) {
      const latlngs = d.points.map((p) => [p.latitude, p.longitude]);
      if (d.type === 'GATHER' && latlngs.length) {
        L.circleMarker(latlngs[0], {
          radius: 12,
          color: '#e74c3c',
          fillColor: '#e74c3c',
          fillOpacity: 0.3,
          weight: 2,
        }).addTo(this.vizLayer);
      } else if (d.type === 'FOLLOW_PATH') {
        L.polyline(latlngs, { color: '#e74c3c', weight: 4, opacity: 0.85 }).addTo(this.vizLayer);
      } else if (d.type === 'AVOID') {
        L.polygon(latlngs, {
          color: '#e67e22',
          fillColor: '#e67e22',
          fillOpacity: 0.2,
          weight: 2,
          dashArray: '6,6',
        }).addTo(this.vizLayer);
      } else if (d.type === 'BLOCK') {
        L.polyline(latlngs, { color: '#2c3e50', weight: 7, opacity: 0.9 }).addTo(this.vizLayer);
      }
    }
  }

  private updateHeat(): void {
    const points = this.latestWatchers.map((w) => [w.location.latitude, w.location.longitude, 0.6]);
    if (this.heatLayer) {
      this.heatLayer.setLatLngs(points);
    } else {
      this.heatLayer = (L as any).heatLayer(points, { radius: 28, blur: 18, maxZoom: 14 }).addTo(this.map);
    }
  }

  // --- Anzeige-Helfer ---

  allPass(field: 'blockers' | 'zones'): boolean {
    const list = this.chaperones();
    if (list.length === 0) {
      return false;
    }
    return list.every((c) => (field === 'blockers' ? c.ignoreBlockers : c.ignoreZones));
  }

  directiveLabel(d: Directive): string {
    const names: Record<DirectiveType, string> = {
      GATHER: '📍 Sammelpunkt',
      FOLLOW_PATH: '✏️ Weg',
      AVOID: '⛔ Sperrzone',
      BLOCK: '🧱 Blocklinie',
    };
    const scope = d.watcherIds.length > 0 ? `Auswahl (${d.watcherIds.length})` : 'alle';
    return `${names[d.type]} · ${scope}`;
  }

  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  // --- Zeichen-Helfer ---

  private drawDraftLine(latlngs: any[], color: string): void {
    this.draftLayer?.remove();
    this.draftLayer = L.polyline(latlngs, { color, weight: 3, dashArray: '6,8' }).addTo(this.map);
  }

  private drawDraftRect(a: any, b: any, color: string): void {
    this.draftLayer?.remove();
    this.draftLayer = L.rectangle(L.latLngBounds(a, b), {
      color,
      weight: 2,
      dashArray: '4,6',
      fillOpacity: 0.1,
    }).addTo(this.map);
  }

  private clearDraft(): void {
    this.draftLayer?.remove();
    this.draftLayer = undefined;
  }

  private toLocation(latlng: any): Location {
    return { latitude: latlng.lat, longitude: latlng.lng };
  }

  private rectPolygon(a: any, b: any): Location[] {
    const south = Math.min(a.lat, b.lat);
    const north = Math.max(a.lat, b.lat);
    const west = Math.min(a.lng, b.lng);
    const east = Math.max(a.lng, b.lng);
    return [
      { latitude: south, longitude: west },
      { latitude: south, longitude: east },
      { latitude: north, longitude: east },
      { latitude: north, longitude: west },
    ];
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const controlled = this.controlledId();
    if (controlled) {
      this.api.setWatcherControl(controlled, false).subscribe();
    }
    this.socket?.close();
    this.map?.remove();
  }
}
