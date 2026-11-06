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

export interface LyricSegment {
  id?: string;
  startTime: number;     // in seconds, e.g. 1.2
  endTime: number;       // in seconds, e.g. 4.5
  text: string;          // original lyrics / spoken words
  translation?: string;  // optional translation
}

export interface TrackLyrics {
  trackId: string;
  trackName?: string;
  segments: LyricSegment[];
  updatedAt?: number;
}
