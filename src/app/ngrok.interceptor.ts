import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Hängt an jede Anfrage den Header, der die ngrok-Warnseite überspringt.
 * Ohne ihn liefert ngrok (free) bei Browser-Anfragen eine HTML-Warnseite
 * statt der API-Antwort.
 */
export const ngrokInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { 'ngrok-skip-browser-warning': 'true' } }));
