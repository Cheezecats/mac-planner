import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { SourceMessage, SourceSuggestion } from "./types";
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
/** Local bounded candidates only. Missing year, numeric day/month ambiguity and vague weekdays require review. */
export function extractDeadlineSuggestions(
  messages: SourceMessage[],
  connectionId: string,
  timeZone: string,
  existingSuggestions: SourceSuggestion[] = [],
): SourceSuggestion[] {
  const result = new Map<string, SourceSuggestion>();
  for (const m of messages) {
    const base = DateTime.fromISO(m.receivedAt, { setZone: true }).setZone(
      timeZone,
    );
    if (!base.isValid) continue;
    const text = `${m.subject}\n${m.body}`.slice(0, 200000);
    const pattern =
      /\b\d{4}-\d{2}-\d{2}\b|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:today|tomorrow|day after tomorrow|next (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b|后天|明天|今天|下(?:周|星期)[一二三四五六日天]/gi;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const at = match.index ?? 0;
      const excerpt = text
        .slice(Math.max(0, at - 100), at + raw.length + 150)
        .replace(/\s+/g, " ")
        .slice(0, 360);
      if (
        !/due|deadline|submit|submission|hand.?in|by\b|截止|提交|交作业|到期|完成|考|essay|assignment|作业/i.test(
          excerpt,
        )
      )
        continue;
      let date: DateTime | null = null;
      if (/^\d{4}-/.test(raw)) date = DateTime.fromISO(raw, { zone: timeZone });
      else if (/^\d{4}年/.test(raw)) {
        const n = raw.match(/\d+/g)!.map(Number);
        date = DateTime.fromObject(
          { year: n[0], month: n[1], day: n[2] },
          { zone: timeZone },
        );
      } else if (
        /^(today|tomorrow|day after tomorrow|今天|明天|后天)$/i.test(raw)
      ) {
        date = base.plus({
          days: /^(today|今天)$/i.test(raw)
            ? 0
            : /^(tomorrow|明天)$/i.test(raw)
              ? 1
              : 2,
        });
      } else if (/[A-Za-z]+\s+\d+.*\d{4}$/.test(raw)) {
        const n = raw.match(/\d+/g)!.map(Number);
        const month = months.indexOf(raw.slice(0, 3).toLowerCase()) + 1;
        date = DateTime.fromObject(
          { year: n.at(-1), month, day: n[0] },
          { zone: timeZone },
        );
      }
      const resolved = date?.isValid ? date.toISODate() : null;
      const candidateKey =
        `${m.id}:` +
        (resolved
          ? `date:${resolved}`
          : `ambiguous:${raw.toLowerCase().replace(/\s+/g, " ")}`);
      const id =
        "suggestion-" +
        createHash("sha256")
          .update(JSON.stringify([connectionId, m.id, candidateKey]))
          .digest("hex")
          .slice(0, 32);
      if (result.has(id)) continue;
      const normalizedTitle = (title: string) =>
        title
          .replace(/^(?:(?:re|fw|fwd)\s*:\s*|回复\s*[:：]\s*)+/gi, "")
          .trim()
          .toLowerCase();
      const previous = existingSuggestions.filter(
        (s) =>
          s.connectionId === connectionId &&
          s.status === "accepted" &&
          s.pageId &&
          (s.providerMessageId === m.id ||
            normalizedTitle(s.title) === normalizedTitle(m.subject)) &&
          s.date?.date !== resolved,
      );
      const updatePages = [...new Set(previous.map((s) => s.pageId))];
      result.set(id, {
        id,
        connectionId,
        providerMessageId: m.id,
        candidateKey,
        title: m.subject.slice(0, 240),
        excerpt,
        date: resolved ? { date: resolved, timeZone } : null,
        ambiguous: !resolved,
        status: "pending",
        sourceUrl: m.sourceUrl,
        sourceUpdatedAt: m.updatedAt,
        ...(updatePages.length === 1
          ? { possibleUpdatePageId: updatePages[0] }
          : {}),
      });
    }
  }
  return [...result.values()];
}
