# Privacy and data flows

Planner's calendar, task pages, study progress, widget versions/state, and copied assets live on this Mac. Planner has no hosted task database, analytics endpoint, advertising, or cross-device sync.

## Local storage

The data process is the sole SQLite writer. Stored workspace content and history are encrypted with AES-256-GCM. Copied attachments, selected-file grants, account credentials, and assistant history are encrypted too. macOS Keychain protects the app's encryption key. Search uses decrypted content in memory.

Decryption is required while using the app. Opening an encrypted copied attachment in another application creates a private temporary plaintext copy. Planner cleans up its owned copies on Quit and on the next launch after a crash. An external application may retain its own recent-file information or copies.

Linked originals remain outside Planner's storage. Restoring a backup does not grant access to arbitrary linked paths: locate a missing/unapproved link through the file chooser. Permanent deletion removes the page's app records, its assistant histories, and unshared copied assets; it never deletes linked originals. Copies in previous backups or other applications remain until those copies are deleted separately.

## Assistant

Signing in uses OpenAI's supported Sign in with ChatGPT route for local open-source apps. Requested inference sends the current saved page, locally owned conversation history for that page, and only the attached sources explicitly selected in the assistant panel. The app uses streamed Responses requests with storage disabled. The OpenAI service and your account's applicable terms govern processing outside this Mac.

The assistant has a bounded set of page/schedule tools. Requested edits use revision checks and Undo. Inferred dates are proposed for review. It has no unrestricted filesystem or desktop access. Generated interactive tools have no Node, filesystem, credential, network, or general app bridge; they receive provided inputs and can save only their own state.

## Google and Microsoft

Authorization occurs in the system browser. Google requests Gmail/calendar read-only access; Microsoft requests delegated Mail.Read and Calendars.Read, plus authentication scopes. Planner does not send email or edit provider calendars.

A manual scan reads selected folders over a chosen date interval (default Inbox, last 30 days). It extracts reviewable suggestions locally, preserving provider identifiers for accepted/dismissed deduplication. Calendar observations are read-only overlays. Disconnect stops further fetching and removes that account's credential; accepted local pages remain.

Email content is not automatically sent to the assistant. A person can choose to discuss an accepted page containing email-derived text, which transmits that selected context to OpenAI. Production Gmail verification must disclose this actual flow, comply with Limited Use requirements, and determine whether restricted-data transfer requires a security assessment. This implementation is not itself provider approval.

## Backups

Portable backups include structured app data, widget source/state, and copied attachments. They exclude credentials, temporary connector caches, machine-local backup settings, and temporary plaintext files. External links remain references. The passphrase protects each archive independently from Keychain; losing it makes that archive unrecoverable. Enabled daily backups retain seven app-created versions in the chosen folder while Planner runs.

## Codex

The companion uses a private local socket and a token stored with user-only permissions. Codex can read/edit/schedule pages through the same validated service. Data you explicitly ask Codex to read is subsequently governed by Codex and the account/service used there. Planner does not import your other Codex or ChatGPT conversations.
