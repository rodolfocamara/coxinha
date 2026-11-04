export const voiceButton =
  'rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline focus-visible:outline-ring';
export const voiceField =
  'w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm';
export function voiceTime(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}
