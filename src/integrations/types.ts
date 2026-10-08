import type {
  AppEvent,
  DateValue,
  Connection,
  ImportedEvent,
  Page,
  SourceSuggestion,
} from "../shared/types";
export type Provider = Connection["provider"];
/** Implement this with encrypted native persistence. No credentials cross renderer IPC. */
export interface IntegrationVault {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface OAuthSession {
  connectionId: string;
  provider: Provider;
  accountId: string;
  accountName: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  scopes: string[];
  expiresAt: number;
  earliestRefreshAt?: number;
}
export interface ProviderFolder {
  id: string;
  name: string;
  parentId?: string;
}
export interface SourceMessage {
  id: string;
  threadId?: string;
  subject: string;
  body: string;
  receivedAt: string;
  sourceUrl: string;
  updatedAt?: string;
}
export interface ScanResult<T> {
  items: T[];
  complete: boolean;
  errors: string[];
}
export interface ProviderClientOptions {
  connectionId: string;
  accountId?: string;
  accountName?: string;
  accessToken: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}
export interface MailScanOptions {
  folder?: string;
  from?: string;
  to?: string;
}
export interface CalendarScanOptions {
  calendarId: string;
  from: string;
  to: string;
  timeZone: string;
}
export interface DomainGateway {
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> | T;
  readAsset(id: string, pageId: string): Promise<string>;
}
export interface AssistantOptions {
  accessToken: (forceRefresh?: boolean) => Promise<string>;
  session?: () => Promise<OAuthSession | null>;
  historyVault: IntegrationVault;
  gateway: DomainGateway;
  emit: (event: AppEvent) => void;
  fetch?: typeof fetch;
}
export interface AssistantSendOptions {
  pageId: string;
  text: string;
  model?: string;
  assetIds?: string[];
  signal?: AbortSignal;
}
export interface AssistantDeadlineProposal {
  pageId: string;
  date: DateValue;
  reason: string;
}
export interface AssistantSendResult {
  text: string;
  changes: string[];
  proposals: AssistantDeadlineProposal[];
}
export type AssistantHistoryItem = Record<string, unknown>;
export class IntegrationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}
export type { Connection, ImportedEvent, Page, SourceSuggestion };
