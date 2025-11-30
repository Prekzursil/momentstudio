import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { NotFoundComponent } from './pages/not-found/not-found.component';
import { ErrorComponent } from './pages/error/error.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'AdrianaArt' },
  { path: 'error', component: ErrorComponent, title: 'Something went wrong' },
  { path: '**', component: NotFoundComponent, title: 'Not Found' }
];
