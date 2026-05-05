import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastContainer: HTMLElement | null = null;

  show(message: string, durationMs: number = 5000) {
    if (!this.toastContainer) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.style.position = 'fixed';
      this.toastContainer.style.bottom = '24px';
      this.toastContainer.style.left = '50%';
      this.toastContainer.style.transform = 'translateX(-50%)';
      this.toastContainer.style.zIndex = '9999';
      this.toastContainer.style.display = 'flex';
      this.toastContainer.style.flexDirection = 'column';
      this.toastContainer.style.gap = '8px';
      document.body.appendChild(this.toastContainer);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    
    // Styling
    toast.style.background = '#ef4444'; // Red for errors
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.fontFamily = "'Inter', sans-serif";
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '500';
    toast.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.4)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';

    // Add icon
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'error';
    icon.style.fontSize = '1.2rem';
    toast.prepend(icon);

    this.toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Animate out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => {
        toast.remove();
        if (this.toastContainer?.children.length === 0) {
          this.toastContainer.remove();
          this.toastContainer = null;
        }
      }, 300);
    }, durationMs);
  }
}
