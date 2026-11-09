export interface AudioTrack {
  id: string;
  name: string;
  cleanName: string;
  audioUrl?: string;
  size?: number;
  duration?: number;
  mimeType?: string;
}

export interface ABRepeat {
  enabled: boolean;
  pointA: number | null;
  pointB: number | null;
}