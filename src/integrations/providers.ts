import { DateTime } from "luxon";
import {
  IntegrationError,
  type ProviderClientOptions,
  type ProviderFolder,
  type ScanResult,
  type SourceMessage,
  type MailScanOptions,
  type CalendarScanOptions,
  type ImportedEvent,
} from "./types";
const GOOGLE = "https://www.googleapis.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
function stripHTML(text: string) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function googleBody(part: any): string {
  if (part.mimeType === "text/html")
    return stripHTML(
      Buffer.from(part.body?.data ?? "", "base64url").toString(),
    );
  const plain = (part.parts ?? []).filter(
    (p: any) => p.mimeType === "text/plain",
  );
  const parts = plain.length ? plain : (part.parts ?? []);
  return (
    (part.body?.data
      ? Buffer.from(part.body.data, "base64url").toString()
      : "") +
    " " +
    parts.map(googleBody).join(" ")
  );
}
class ReadClient {
  protected fetcher: typeof fetch;
  constructor(
    protected options: ProviderClientOptions,
    private origin: string,
    private graph = false,
  ) {
    this.fetcher = options.fetch ?? fetch;
  }
  protected async get(url: string): Promise<any> {
    const parsed = new URL(url);
    if (
      parsed.origin !== this.origin ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    )
      throw new IntegrationError(
        "unsafe-pagination",
        "Provider returned an invalid pagination URL.",
      );
    const request = async (force?: boolean) =>
      this.fetcher(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${await this.options.accessToken(force)}`,
          ...(this.graph
            ? {
                Prefer:
                  'IdType="ImmutableId", outlook.body-content-type="text", outlook.timezone="UTC"',
              }
            : {}),
        },
      });
    let response = await request();
    if (response.status === 401) response = await request(true);
    if (!response.ok)
      throw new IntegrationError(
        response.status === 403
          ? "scope-denied"
          : response.status === 401
            ? "reauthorize"
            : "provider-http",
        `Provider request failed (${response.status}).`,
        response.status,
      );
    return response.json();
  }
  protected async pages<T>(
    url: string,
    key: string,
    next: (data: any, url: string) => string | null,
    map: (raw: any) => T | null,
  ): Promise<ScanResult<T>> {
    const items: T[] = [];
    const seen = new Set<string>();
    try {
      while (url) {
        if (seen.has(url))
          throw new IntegrationError(
            "pagination-cycle",
            "Provider repeated a pagination cursor.",
          );
        seen.add(url);
        const data = await this.get(url);
        for (const raw of data[key] ?? []) {
          const item = map(raw);
          if (item) items.push(item);
        }
        url = next(data, url) ?? "";
      }
      return { items, complete: true, errors: [] };
    } catch (error) {
      return {
        items,
        complete: false,
        errors: [
          error instanceof Error ? error.message : "Provider scan failed.",
        ],
      };
    }
  }
  protected range(options: MailScanOptions) {
    const now = this.options.now?.() ?? new Date();
    const from =
      options.from ?? new Date(now.getTime() - 30 * 86400000).toISOString();
    const to = options.to ?? now.toISOString();
    if (
      !Number.isFinite(Date.parse(from)) ||
      !Number.isFinite(Date.parse(to)) ||
      Date.parse(from) >= Date.parse(to)
    )
      throw new IntegrationError(
        "invalid-range",
        "Choose a valid start and end date.",
      );
    return { from, to };
  }
}
function googleNext(data: any, url: string) {
  if (!data.nextPageToken) return null;
  const next = new URL(url);
  next.searchParams.set("pageToken", data.nextPageToken);
  return next.toString();
}
export class GoogleClient extends ReadClient {
  constructor(options: ProviderClientOptions) {
    super(options, GOOGLE);
  }
  folders() {
    return this.pages<ProviderFolder>(
      `${GOOGLE}/gmail/v1/users/me/labels`,
      "labels",
      googleNext,
      (r) => ({ id: r.id, name: r.name }),
    );
  }
  calendars() {
    return this.pages<ProviderFolder>(
      `${GOOGLE}/calendar/v3/users/me/calendarList`,
      "items",
      googleNext,
      (r) => ({ id: r.id, name: r.summary ?? r.id }),
    );
  }
  async messages(
    options: MailScanOptions = {},
  ): Promise<ScanResult<SourceMessage>> {
    const { from, to } = this.range(options);
    const u = new URL(`${GOOGLE}/gmail/v1/users/me/messages`);
    u.searchParams.set("labelIds", options.folder ?? "INBOX");
    u.searchParams.set(
      "q",
      `after:${Math.floor(Date.parse(from) / 1000)} before:${Math.ceil(Date.parse(to) / 1000)}`,
    );
    u.searchParams.set("maxResults", "100");
    const items: SourceMessage[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    let url = u.toString();
    try {
      while (url) {
        if (seen.has(url))
          throw new Error("Provider repeated a pagination cursor.");
        seen.add(url);
        const list = await this.get(url);
        for (const ref of list.messages ?? []) {
          try {
            const m = await this.get(
              `${GOOGLE}/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
            );
            const date = new Date(Number(m.internalDate));
            if (!Number.isFinite(date.getTime()))
              throw new Error("Message has no valid received date.");
            if (
              date.getTime() < Date.parse(from) ||
              date.getTime() >= Date.parse(to)
            )
              continue;
            items.push({
              id: m.id,
              threadId: m.threadId,
              subject:
                m.payload?.headers?.find(
                  (h: any) => h.name.toLowerCase() === "subject",
                )?.value ?? "Untitled message",
              body: googleBody(m.payload ?? {}).trim() || m.snippet || "",
              receivedAt: date.toISOString(),
              sourceUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(this.options.accountName ?? "0")}#all/${encodeURIComponent(m.id)}`,
            });
          } catch (e) {
            errors.push(
              e instanceof Error ? e.message : "Message fetch failed.",
            );
          }
        }
        url = googleNext(list, url) ?? "";
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Mail scan failed.");
    }
    return { items, complete: errors.length === 0, errors };
  }
  events(o: CalendarScanOptions) {
    const u = new URL(
      `${GOOGLE}/calendar/v3/calendars/${encodeURIComponent(o.calendarId)}/events`,
    );
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("timeMin", o.from);
    u.searchParams.set("timeMax", o.to);
    u.searchParams.set("timeZone", o.timeZone);
    return this.pages<ImportedEvent>(u.toString(), "items", googleNext, (r) => {
      if (r.status === "cancelled") return null;
      const d = DateTime.fromISO(r.start?.dateTime ?? r.start?.date ?? "", {
        zone: r.start?.timeZone ?? o.timeZone,
      }).setZone(o.timeZone);
      if (!d.isValid) return null;
      const end = r.end?.dateTime
        ? DateTime.fromISO(r.end.dateTime).setZone(o.timeZone).toFormat("HH:mm")
        : undefined;
      return {
        id: `${this.options.connectionId}:${o.calendarId}:${r.id}`,
        connectionId: this.options.connectionId,
        calendarId: o.calendarId,
        title: r.summary ?? "Calendar event",
        when: {
          date: d.toISODate()!,
          ...(r.start.dateTime ? { time: d.toFormat("HH:mm") } : {}),
          timeZone: o.timeZone,
        },
        endTime: end,
        sourceUrl: r.htmlLink,
      };
    });
  }
}
export class MicrosoftClient extends ReadClient {
  constructor(options: ProviderClientOptions) {
    super(options, "https://graph.microsoft.com", true);
  }
  async folders(): Promise<ScanResult<ProviderFolder>> {
    const result = await this.pages<ProviderFolder>(
      `${GRAPH}/me/mailFolders?includeHiddenFolders=false`,
      "value",
      (r) => r["@odata.nextLink"] ?? null,
      (r) => ({
        id: r.id,
        name: r.displayName,
        ...(r.parentFolderId ? { parentId: r.parentFolderId } : {}),
      }),
    );
    let complete = result.complete;
    for (let i = 0; i < result.items.length; i++) {
      const f = result.items[i];
      const children = await this.pages<ProviderFolder>(
        `${GRAPH}/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?includeHiddenFolders=false`,
        "value",
        (r) => r["@odata.nextLink"] ?? null,
        (r) => ({ id: r.id, name: r.displayName, parentId: f.id }),
      );
      for (const child of children.items)
        if (!result.items.some((x) => x.id === child.id))
          result.items.push(child);
      complete &&= children.complete;
      result.errors.push(...children.errors);
    }
    return { ...result, complete };
  }
  calendars() {
    return this.pages<ProviderFolder>(
      `${GRAPH}/me/calendars`,
      "value",
      (r) => r["@odata.nextLink"] ?? null,
      (r) => ({ id: r.id, name: r.name }),
    );
  }
  messages(o: MailScanOptions = {}) {
    const { from, to } = this.range(o);
    const u = new URL(
      `${GRAPH}/me/mailFolders/${encodeURIComponent(o.folder ?? "inbox")}/messages`,
    );
    u.searchParams.set(
      "$filter",
      `receivedDateTime ge ${from} and receivedDateTime lt ${to}`,
    );
    u.searchParams.set(
      "$select",
      "id,conversationId,subject,body,receivedDateTime,lastModifiedDateTime,webLink",
    );
    u.searchParams.set("$top", "100");
    return this.pages<SourceMessage>(
      u.toString(),
      "value",
      (r) => r["@odata.nextLink"] ?? null,
      (r) => ({
        id: r.id,
        threadId: r.conversationId,
        subject: r.subject ?? "Untitled message",
        body:
          r.body?.contentType?.toLowerCase() === "html"
            ? stripHTML(r.body?.content ?? "")
            : (r.body?.content ?? ""),
        receivedAt: r.receivedDateTime,
        updatedAt: r.lastModifiedDateTime,
        sourceUrl:
          r.webLink ??
          `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(r.id)}`,
      }),
    );
  }
  events(o: CalendarScanOptions) {
    const u = new URL(
      `${GRAPH}/me/calendars/${encodeURIComponent(o.calendarId)}/calendarView`,
    );
    u.searchParams.set("startDateTime", o.from);
    u.searchParams.set("endDateTime", o.to);
    u.searchParams.set("$top", "100");
    return this.pages<ImportedEvent>(
      u.toString(),
      "value",
      (r) => r["@odata.nextLink"] ?? null,
      (r) => {
        if (r.isCancelled) return null;
        const d = DateTime.fromISO(r.start?.dateTime ?? "", {
          zone: "UTC",
        }).setZone(o.timeZone);
        if (!d.isValid) return null;
        return {
          id: `${this.options.connectionId}:${o.calendarId}:${r.id}`,
          connectionId: this.options.connectionId,
          calendarId: o.calendarId,
          title: r.subject ?? "Calendar event",
          when: {
            date: r.isAllDay ? String(r.start.dateTime).slice(0,10) : d.toISODate()!,
            ...(!r.isAllDay ? { time: d.toFormat("HH:mm") } : {}),
            timeZone: o.timeZone,
          },
          endTime: !r.isAllDay
            ? DateTime.fromISO(r.end?.dateTime ?? "", { zone: "UTC" })
                .setZone(o.timeZone)
                .toFormat("HH:mm")
            : undefined,
          sourceUrl: r.webLink,
        };
      },
    );
  }
}
