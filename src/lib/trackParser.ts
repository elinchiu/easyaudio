import { AudioTrack } from '../types/track';

/** 保留完整原始檔名，不做任何清理 */
export function parseTrackFilename(file: {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
}): AudioTrack {
  return {
    id: file.id,
    name: file.name,
    cleanName: file.name,
    size: file.size || 0,
    mimeType: file.mimeType || 'audio/mpeg',
  };
}