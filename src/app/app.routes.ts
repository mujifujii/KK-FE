import { Routes } from '@angular/router';
import { MapComponent } from './map/map';
import { ClientView } from './client/client';

export const routes: Routes = [
  { path: '', component: MapComponent },
  { path: 'client/:id', component: ClientView },
];
