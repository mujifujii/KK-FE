import { Routes } from '@angular/router';
import { MapComponent } from './map/map';
import { ClientView } from './client/client';
import { ChaperoneView } from './chaperone-view/chaperone';

export const routes: Routes = [
  { path: '', component: MapComponent },
  { path: 'client/:id', component: ClientView },
  { path: 'chaperone/:id', component: ChaperoneView },
];
