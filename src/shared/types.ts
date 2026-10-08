export type View = 'calendar' | 'space' | 'suggestions' | 'connections' | 'settings';
export interface DateValue { date: string; time?: string; timeZone: string }
export interface PageBlock { id: string; type: string; props: Record<string, unknown>; content?: unknown; children?: PageBlock[] }
export interface Page {
  id: string; title: string; blocks: PageBlock[]; deadline: DateValue | null;
  labels: string[]; status: 'active' | 'completed' | 'archived' | 'trashed';
  pinned: boolean; pinOrder: number; parentId: string | null; revision: number;
  createdAt: string; updatedAt: string; trashedAt: string | null; isTemplate: boolean;
  reminder?: ReminderSpec;
  trashState?: { status: 'active' | 'completed' | 'archived'; reminder?: ReminderSpec; entries: { id: string; active: boolean; reminder?: ReminderSpec; revisionAfterTrash: number }[] };
}
export interface ReminderSpec { enabled: boolean; beforeMinutes: number; time?: string }
export type SessionStatus = 'planned' | 'done' | 'cancelled';
export interface CalendarEntry {
  id: string; pageId: string; blockId?: string; title?: string; kind: 'event' | 'work';
  when: DateValue; endTime?: string; active: boolean; status: SessionStatus;
  repeat?: { frequency: 'weekly'; until?: string };
  exceptions: Record<string, { when?: DateValue; status?: SessionStatus; endTime?: string }>;
  reminder?: ReminderSpec; revision: number;
}
export interface CalendarOccurrence {
  id: string; entryId: string; pageId: string; blockId?: string; title: string;
  kind: 'deadline' | 'event' | 'work'; when: DateValue; endTime?: string;
  status: SessionStatus; active: boolean; recurring: boolean; occurrenceDate: string;
}
export interface Label { id: string; name: string; color?: string }
export interface Flashcard { id: string; front: string; back: string; review?: 'again' | 'got-it'; reviewedAt?: string }
export interface QuizQuestion { id: string; prompt: string; type: 'multiple-choice' | 'short-answer'; choices?: string[]; answer: string; explanation?: string }
export interface StudyRecord {
  id: string; pageId: string; kind: 'flashcards' | 'quiz'; title: string;
  cards: Flashcard[]; questions: QuizQuestion[];
  attempts: { id: string; at: string; answers: Record<string, string>; selfAssessment?: Record<string, 'again' | 'got-it'>; score?: number }[]; revision: number;
}
export interface WidgetRecord {
  id: string; pageId: string; title: string; source: string; version: number;
  state: Record<string, unknown>; versions: { version: number; source: string }[]; revision: number;
}
export interface AssetRecord {
  id: string; pageId: string; name: string; kind: 'copy' | 'file-link' | 'folder-link';
  mime: string; size: number; originalPath?: string; storageName?: string;
}
export interface Connection {
  id: string; provider: 'google' | 'microsoft' | 'openai'; accountName: string;
  status: 'connected' | 'expired' | 'error'; settings: Record<string, unknown>;
}
export interface SourceSuggestion {
  id: string; connectionId: string; providerMessageId: string; candidateKey: string;
  title: string; excerpt: string; date: DateValue | null; ambiguous: boolean;
  status: 'pending' | 'accepted' | 'dismissed'; pageId?: string; sourceUrl: string;
  sourceUpdatedAt?: string; possibleUpdatePageId?: string;
}
export interface ImportedEvent {
  id: string; connectionId: string; calendarId: string; title: string;
  when: DateValue; endTime?: string; sourceUrl?: string;
}
export interface Settings {
  view: View; sidebarExpanded: boolean; textScale: number; calendarView: 'month' | 'week';
  weekStartsOn: 1; backupEnabled: boolean; backupPath?: string; backupLastAt?: string;
  reducedMotion: boolean; onboardingDismissed: boolean;
}
export interface WorkspaceSnapshot {
  schemaVersion: 1; pages: Page[]; entries: CalendarEntry[]; labels: Label[];
  studies: StudyRecord[]; widgets: WidgetRecord[]; assets: AssetRecord[];
  suggestions: SourceSuggestion[]; connections: Connection[]; importedEvents: ImportedEvent[];
  settings: Settings;
}
export interface AppEvent { type: 'changed' | 'open-page' | 'assistant-delta' | 'assistant-done' | 'assistant-error' | 'widget-error' | 'flush-request'; pageId?: string; text?: string; data?: unknown }
export interface PlannerAPI {
  isDesktop: boolean;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(callback: (event: AppEvent) => void): () => void;
}
declare global { interface Window { planner?: PlannerAPI } }
