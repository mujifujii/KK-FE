import { HttpInterceptorFn } from '@angular/common/http';

// ohne diesen Header liefert ngrok (free) eine HTML-Warnseite statt der API-Antwort
export const ngrokInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { 'ngrok-skip-browser-warning': 'true' } }));
