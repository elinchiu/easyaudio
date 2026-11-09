export function getDirectAudioUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}