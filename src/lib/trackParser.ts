import { AudioTrack } from '../types/track';

/**
 * Retains complete original audio filename without altering or stripping punctuation
 */
export function parseTrackFilename(file: {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  webContentLink?: string;
}): AudioTrack {
  const originalName = file.name;

  return {
    id: file.id,
    name: originalName,
    cleanName: originalName,
    size: file.size || 0,
    mimeType: file.mimeType || 'audio/mpeg',
  };
}
