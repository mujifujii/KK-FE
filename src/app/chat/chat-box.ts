import { Component, computed, inject, input, signal } from '@angular/core';
import { WatcherApi } from '../watcher.api';
import { ChatMessage } from '../watcher.model';

/**
 * Wiederverwendbare Chat-Box für eine 1:1-Konversation.
 * Bekommt die eigene id (me), den Gesprächspartner und ALLE Nachrichten,
 * filtert daraus die gemeinsame Konversation und sendet über die API.
 */
@Component({
  selector: 'app-chat-box',
  standalone: true,
  templateUrl: './chat-box.html',
  styleUrl: './chat-box.scss',
})
export class ChatBox {
  readonly me = input.required<string>();
  readonly partner = input<string | null>(null);
  readonly partnerLabel = input<string>('');
  readonly messages = input<ChatMessage[]>([]);

  private readonly api = inject(WatcherApi);
  readonly draft = signal('');

  readonly conversation = computed(() => {
    const me = this.me();
    const partner = this.partner();
    if (!partner) {
      return [] as ChatMessage[];
    }
    return this.messages()
      .filter((m) => (m.from === me && m.to === partner) || (m.from === partner && m.to === me))
      .sort((a, b) => a.timestamp - b.timestamp);
  });

  mine(m: ChatMessage): boolean {
    return m.from === this.me();
  }

  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  send(): void {
    const partner = this.partner();
    const text = this.draft().trim();
    if (!partner || !text) {
      return;
    }
    this.api.sendChatMessage(this.me(), partner, text).subscribe();
    this.draft.set('');
  }
}
