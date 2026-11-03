import {
  Activity,
  AudioLines,
  CalendarClock,
  HardDrive,
  Keyboard,
  Mic,
  Plug,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

/** One icon per settings section: the nav item and the section heading share it. */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  general: SlidersHorizontal,
  calendar: CalendarClock,
  recording: Mic,
  transcription: AudioLines,
  integrations: Plug,
  shortcuts: Keyboard,
  storage: HardDrive,
  diagnostics: Activity,
};
