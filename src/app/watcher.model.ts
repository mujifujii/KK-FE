export type WatcherStatus = 'OK' | 'HELP' | 'HELP_IN_PROGRESS' | 'EMERGENCY';

export type DirectiveType = 'GATHER' | 'FOLLOW_PATH' | 'AVOID' | 'BLOCK';

export type ChaperoneMode = 'AUTO' | 'AREA' | 'OFF';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface Watcher {
  id: string;
  location: Location;
  status: WatcherStatus;
}

export interface Chaperone {
  id: string;
  location: Location;
  targetWatcherId: string | null;
  mode: ChaperoneMode;
  area: Location[];
  rescues: number;
  ignoreBlockers: boolean;
  ignoreZones: boolean;
}

export interface Directive {
  id: string;
  type: DirectiveType;
  points: Location[];
  watcherIds: string[];
}

export interface HelpEvent {
  chaperoneId: string;
  watcherId: string;
  timestamp: number;
}

export interface AssignDirectiveRequest {
  type: DirectiveType;
  points: Location[];
  watcherIds: string[];
}

export interface ChaperoneSettingsRequest {
  chaperoneIds: string[];
  ignoreBlockers?: boolean;
  ignoreZones?: boolean;
}
