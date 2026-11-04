import {
  Activity,
  AudioLines,
  CalendarClock,
  HardDrive,
  Keyboard,
  Mic,
  Palette,
  Plug,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsSectionId } from './settingsIndex';

/** One icon per settings page, in the sidebar and in Ctrl+K. */
export const SECTION_ICONS: Record<SettingsSectionId, LucideIcon> = {
  appearance: Palette,
  shortcuts: Keyboard,
  recording: Mic,
  transcription: AudioLines,
  calendar: CalendarClock,
  integrations: Plug,
  titles: Sparkles,
  storage: HardDrive,
  diagnostics: Activity,
};
