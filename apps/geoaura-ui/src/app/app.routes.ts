import { Routes } from '@angular/router';
import { MainLayout } from './components/layout/main-layout/main-layout';
import { PrivacyPolicyComponent } from './components/feature/privacy-policy/privacy-policy';
import { TermsOfServiceComponent } from './components/feature/terms-of-service/terms-of-service';
import { AboutComponent } from './components/feature/about/about';

export const routes: Routes = [
  { path: '', component: MainLayout },
  { path: 'privacy-policy', component: PrivacyPolicyComponent },
  { path: 'terms-of-service', component: TermsOfServiceComponent },
  { path: 'about', component: AboutComponent },
  { path: '**', redirectTo: '' }
];
