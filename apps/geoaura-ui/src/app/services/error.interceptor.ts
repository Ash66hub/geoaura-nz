import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ToastService } from './toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 502) {
        toastService.show('Server down: The GeoAura backend is currently unreachable.');
      } else if (error.status === 503) {
        toastService.show('Server unavailable: The backend service is currently down.');
      }
      return throwError(() => error);
    })
  );
};
