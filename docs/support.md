# Using and recovering Planner

## Starting and writing

The first launch opens Calendar. Space's All items view contains undated ideas. Choose **New** to open a blank page with title focus. Use `⌘K` to search titles, page text, and labels; `⌘N` creates a page. The sidebar expands only when its toggle is clicked and remembers the choice. Text size and reduced motion are in Settings.

Checklists, work sessions, and page completion are independent. Complete a page explicitly when the task is finished. Completing it deactivates outstanding planned work/reminders but preserves fixed events and unfinished history; Undo restores the transition. Moving work does not move the deadline.

## Files

Attach makes an encrypted app-owned copy. Link references a selected original file/folder. If a link moves or becomes inaccessible, choose **Locate**. Planner never deletes the external original when you remove a link or delete a page.

Opening a copied file in another Mac app makes a temporary decrypted copy. Save changes back as a newly attached copy if you need Planner to retain them; external edits do not silently replace the encrypted original.

## Failed saves and conflicts

A save failure appears in the page and the app message. Keep the editor open; your pending edits remain in memory. Resolve storage/permission problems and retry. If another writer changed the page, review/reload the newer page rather than silently overwriting it. Quitting waits for the current editor flush and shows a failure instead of discarding unsaved writing.

## Trash and backups

Delete moves a page to Trash; restore it in Settings. Permanent deletion is explicit. It cannot remove copies already in old backups.

Choose a folder and a passphrase of at least eight characters to enable daily encrypted backups. Keep the passphrase separately. Restore validates the archive and assets before replacing current data, saves a recovery copy of the current encrypted database, and stages copied assets before committing. Wrong passwords or invalid archives leave the current workspace intact.

Database upgrades preserve a pre-migration copy. If an upgrade fails, retain the data folder and the original backup, then return to the last compatible app. Do not delete your Keychain-protected key. Older versions refuse unsupported future data rather than rewriting it.

## Reminders and tools

Reminders are opt-in and need macOS permission plus a signed app. Closing the window keeps the menu-bar process alive. Quit stops delivery. Launch/resume does not burst old notifications; missed work remains visible in Space.

If an interactive tool fails, use Stop or Reload. Its saved state and source versions remain available; restore a previous version if a generated update breaks it. A tool failure should leave the editor responsive.

## Connections

Expired authorization requires reconnecting. An incomplete scan is labeled incomplete; do not assume its suggestions represent the entire selected interval. Ambiguous dates require review/editing. Accepting and dismissing a suggestion are remembered across rescans. Calendar overlays do not modify local work plans.

The assistant requires a selected page and an eligible ChatGPT account. Interrupted requests do not count as completed inference; retry intentionally. Optional account failures leave the offline planner usable.

## Reporting a problem

Include the app version, Mac architecture/OS, the action that failed, and the displayed error. Use a small redacted reproduction. Do not include account tokens, Keychain material, private attachments, or an unredacted backup. This repository has no public support endpoint configured yet.
