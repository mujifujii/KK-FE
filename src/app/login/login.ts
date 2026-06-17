import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Einfacher Frontend-Login: Passwort -> Ziel-View.
 * (Reine Demo-„Authentifizierung", kein echter Schutz.)
 */
const CREDENTIALS: Record<string, string> = {
  orchestrator1: '/leitstelle',
  client1: '/client/w1',
  client2: '/client/w2',
  client3: '/client/w3',
  chaperone1: '/chaperone/c1',
  chaperone2: '/chaperone/c2',
};

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly router = inject(Router);
  readonly password = signal('');
  readonly error = signal(false);

  submit(): void {
    const route = CREDENTIALS[this.password().trim()];
    if (route) {
      this.error.set(false);
      this.router.navigateByUrl(route);
    } else {
      this.error.set(true);
    }
  }
}
