import { describe, it, expect, vi } from "vitest";
import {
  GoogleClient,
  MicrosoftClient,
  extractDeadlineSuggestions,
} from "../../src/integrations/index";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("read-only provider adapters", () => {
  it('preserves Outlook all-day dates while converting timed events',async()=>{
    const fetcher=vi.fn().mockResolvedValue(json({value:[{id:'all',subject:'Exam',isAllDay:true,start:{dateTime:'2026-10-15T00:00:00',timeZone:'UTC'},end:{dateTime:'2026-10-16T00:00:00',timeZone:'UTC'}},{id:'timed',subject:'Call',isAllDay:false,start:{dateTime:'2026-10-15T00:00:00',timeZone:'UTC'},end:{dateTime:'2026-10-15T01:00:00',timeZone:'UTC'}}]}));
    const result=await new MicrosoftClient({connectionId:'c',accessToken:async()=>'t',fetch:fetcher}).events({calendarId:'calendar',from:'2026-10-01',to:'2026-10-31',timeZone:'America/Los_Angeles'});
    expect(result.complete).toBe(true);expect(result.items[0].when.date).toBe('2026-10-15');expect(result.items[0].when.time).toBeUndefined();expect(result.items[1].when.date).toBe('2026-10-14');expect(result.items[1].when.time).toBe('17:00');
  });
  it("preserves opaque Graph nextLink and immutable headers, exposes partial results", async () => {
    const next =
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=A%2BB";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: "a",
              subject: "Deadline",
              body: { content: "Due 2026-10-15" },
              receivedDateTime: "2026-10-01T10:00:00Z",
              webLink: "https://outlook.office.com/a",
            },
          ],
          "@odata.nextLink": next,
        }),
      )
      .mockResolvedValueOnce(json({ error: { code: "Denied" } }, 403));
    const client = new MicrosoftClient({
      connectionId: "c",
      accessToken: async () => "token",
      fetch: fetcher,
    });
    const result = await client.messages({});
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(fetcher.mock.calls[1][0]).toBe(next);
    expect(
      new Headers(fetcher.mock.calls[1][1].headers).get("Prefer"),
    ).toContain("ImmutableId");
  });
  it("refreshes once on 401 and never follows off-provider URLs", async () => {
    const token = vi.fn().mockResolvedValue("t");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(
        json({ value: [], "@odata.nextLink": "https://evil.example/steal" }),
      );
    const result = await new MicrosoftClient({
      connectionId: "c",
      accessToken: token,
      fetch: fetcher,
    }).folders();
    expect(token.mock.calls).toEqual([[undefined], [true]]);
    expect(result.complete).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("lists every Gmail page, fetches full bodies, does not group candidates by thread", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ messages: [{ id: "m1" }], nextPageToken: "opaque" }),
      )
      .mockResolvedValueOnce(
        json({
          id: "m1",
          threadId: "same",
          internalDate: "1790899200000",
          payload: {
            headers: [{ name: "Subject", value: "Essay" }],
            body: {
              data: Buffer.from("Due 2026-10-15 and 2026-10-16").toString(
                "base64url",
              ),
            },
          },
        }),
      )
      .mockResolvedValueOnce(json({ messages: [{ id: "m2" }] }))
      .mockResolvedValueOnce(
        json({
          id: "m2",
          threadId: "same",
          internalDate: "1790899200000",
          snippet: "Due tomorrow",
        }),
      );
    const result = await new GoogleClient({
      connectionId: "c",
      accessToken: async () => "t",
      fetch: fetcher,
    }).messages({ folder: "LABEL" });
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(String(fetcher.mock.calls[2][0])).toContain("pageToken=opaque");
    expect(
      extractDeadlineSuggestions(result.items, "c", "Asia/Shanghai"),
    ).toHaveLength(3);
  });
});
describe("deadline candidates", () => {
  const base = {
    id: "m",
    subject: "Assignment",
    receivedAt: "2026-10-07T16:30:00Z",
    sourceUrl: "https://example.com/source",
  };
  it("anchors relative Chinese/English dates to receipt timezone and leaves ambiguous dates unresolved", () => {
    const s = extractDeadlineSuggestions(
      [{ ...base, body: "Due tomorrow. 截止2026年10月15日。 Due 10/11." }],
      "account",
      "Asia/Shanghai",
    );
    expect(s.map((x) => x.date?.date)).toEqual([
      "2026-10-09",
      "2026-10-15",
      undefined,
    ]);
    expect(s[2].ambiguous).toBe(true);
    expect(
      s.every((x) => x.excerpt.length <= 360 && x.sourceUrl === base.sourceUrl),
    ).toBe(true);
  });
  it("deduplicates candidates stably per account and message while retaining separate candidates", () => {
    const msg = {
      ...base,
      body: "Due 2026-10-15; due 2026-10-15; due 2026-10-16",
    };
    const a = extractDeadlineSuggestions([msg, msg], "a", "UTC");
    expect(a).toHaveLength(2);
    expect(a[0].id).not.toBe(
      extractDeadlineSuggestions([msg], "b", "UTC")[0].id,
    );
  });
});
it("keeps two messages for the same date separate and proposes accepted-page updates for follow-ups", () => {
  const prior = extractDeadlineSuggestions(
    [
      {
        id: "m1",
        subject: "Essay",
        body: "Due 2026-10-15",
        receivedAt: "2026-10-01T00:00:00Z",
        sourceUrl: "https://example.test/1",
      },
    ],
    "c",
    "UTC",
  );
  prior[0].status = "accepted";
  prior[0].pageId = "p";
  const incoming = extractDeadlineSuggestions(
    [
      {
        id: "m1",
        subject: "Essay",
        body: "Due 2026-10-15",
        receivedAt: "2026-10-01T00:00:00Z",
        sourceUrl: "https://example.test/1",
      },
      {
        id: "m2",
        subject: "Re: Essay",
        body: "Updated deadline due 2026-10-16",
        receivedAt: "2026-10-02T00:00:00Z",
        sourceUrl: "https://example.test/2",
      },
    ],
    "c",
    "UTC",
    prior,
  );
  expect(incoming[0].candidateKey).not.toBe(incoming[1].candidateKey);
  expect(incoming[1].possibleUpdatePageId).toBe("p");
});
it("uses Gmail calendar occurrence expansion and follows every calendar page", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        items: [
          {
            id: "occ1",
            summary: "First",
            start: { dateTime: "2026-10-15T09:00:00+08:00" },
            end: { dateTime: "2026-10-15T10:00:00+08:00" },
          },
        ],
        nextPageToken: "n",
      }),
    )
    .mockResolvedValueOnce(
      json({
        items: [
          {
            id: "occ2",
            summary: "Second",
            start: { date: "2026-10-16" },
            end: { date: "2026-10-17" },
          },
        ],
      }),
    );
  const r = await new GoogleClient({
    connectionId: "c",
    accessToken: async () => "t",
    fetch: f,
  }).events({
    calendarId: "primary",
    from: "2026-10-01T00:00:00Z",
    to: "2026-11-01T00:00:00Z",
    timeZone: "Asia/Shanghai",
  });
  expect(r.complete).toBe(true);
  expect(r.items.map((x) => x.when)).toEqual([
    { date: "2026-10-15", time: "09:00", timeZone: "Asia/Shanghai" },
    { date: "2026-10-16", timeZone: "Asia/Shanghai" },
  ]);
  expect(f.mock.calls[0][0]).toContain("singleEvents=true");
});
