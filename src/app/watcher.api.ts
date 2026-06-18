import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from './api-config';
import {
  AssignDirectiveRequest,
  Chaperone,
  ChaperoneMode,
  ChaperoneSettingsRequest,
  ChatMessage,
  Directive,
  Location,
  Watcher,
  WatcherStatus,
} from './watcher.model';

@Injectable({ providedIn: 'root' })
export class WatcherApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = API_BASE;

  getWatchers(): Observable<Watcher[]> {
    return this.http.get<Watcher[]>(`${this.baseUrl}/watchers`);
  }

  setWatcherControl(id: string, controlled: boolean): Observable<Watcher> {
    return this.http.post<Watcher>(`${this.baseUrl}/watchers/${id}/control`, { controlled });
  }

  updateWatcherLocation(id: string, latitude: number, longitude: number): Observable<Watcher> {
    return this.http.patch<Watcher>(`${this.baseUrl}/watchers/${id}/location`, { latitude, longitude });
  }

  updateWatcherStatus(id: string, status: WatcherStatus): Observable<Watcher> {
    return this.http.patch<Watcher>(`${this.baseUrl}/watchers/${id}/status`, { status });
  }

  getChaperones(): Observable<Chaperone[]> {
    return this.http.get<Chaperone[]>(`${this.baseUrl}/chaperones`);
  }

  getDirectives(): Observable<Directive[]> {
    return this.http.get<Directive[]>(`${this.baseUrl}/orchestrator/directives`);
  }

  assignDirective(request: AssignDirectiveRequest): Observable<Directive> {
    return this.http.post<Directive>(`${this.baseUrl}/orchestrator/directive`, request);
  }

  removeDirective(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/orchestrator/directive/${id}`);
  }

  clearDirectives(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/orchestrator/directive`);
  }

  updateChaperoneSettings(request: ChaperoneSettingsRequest): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/chaperones/settings`, request);
  }

  setChaperoneMode(id: string, mode: ChaperoneMode): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/chaperones/${id}/mode`, { mode });
  }

  setChaperoneArea(id: string, points: Location[]): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/chaperones/${id}/area`, { points });
  }

  sendChatMessage(from: string, to: string, text: string): Observable<ChatMessage> {
    return this.http.post<ChatMessage>(`${this.baseUrl}/chat`, { from, to, text });
  }
}
