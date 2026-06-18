import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

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

  private resolve(pw: string): string | null {
    const p = pw.trim().toLowerCase();
    if (p === 'orchestrator1' || p === 'orchestrator') {
      return '/leitstelle';
    }
    const client = p.match(/^client(\d+)$/);
    if (client) {
      return `/client/w${client[1]}`;
    }
    const chaperone = p.match(/^chaperone(\d+)$/);
    if (chaperone) {
      return `/chaperone/c${chaperone[1]}`;
    }
    return null;
  }

  submit(): void {
    const route = this.resolve(this.password());
    if (route) {
      this.error.set(false);
      this.router.navigateByUrl(route);
    } else {
      this.error.set(true);
    }
  }
}
