export interface AudioTrack {
  id: string;
  name: string;
  cleanName: string;
  audioUrl?: string; // direct audio stream or object URL
  size?: number;
  duration?: number; // in seconds
  mimeType?: string;
}

export type RepeatMode = 'normal' | 'repeat-one' | 'repeat-all' | 'shuffle';

export interface ABRepeat {
  enabled: boolean;
  pointA: number | null;
  pointB: number | null;
}
