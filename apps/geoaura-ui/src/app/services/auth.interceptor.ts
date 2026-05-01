import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const session = authService.session();

  if (session?.access_token) {
    const authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${session.access_token}`
      }
    });
    return next(authReq);
  }

  return next(req);
};
