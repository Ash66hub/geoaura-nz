import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ToastService } from './toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 502 || error.status === 504) {
        toastService.show('Server down: The GeoAura backend is currently unreachable.');
      } else if (error.status === 503) {
        toastService.show('Server unavailable: The backend service is currently down.');
      } else if (error.status === 0) {
        // Render's 502s often lack CORS headers, which the browser masks as status 0.
        toastService.show('Network error: Cannot reach the backend server.');
      }
      return throwError(() => error);
    })
  );
};
