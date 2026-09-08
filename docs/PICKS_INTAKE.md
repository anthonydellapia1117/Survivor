# Picks intake, chasing, results and the list to Lynne

TLDR: five local commands replace hand entry and the self-emailed DECISION
loop for picks. `npm run picks` turns unread player mail or pasted text into
a proposed table and writes only after you type y. `npm run lynne` prints the
entries that locked at a deadline in Lynne's numbering and leaves it as a
Gmail draft. `npm run chase` drafts one reminder per recipient with no pick.
`npm run results` brings her newest Football sheet in through the importer.
`npm run distribute` drafts the post-lock BCC with the /grid link. Every one
of them drafts; the single send path is the pick_reminder gate in section 4c.
Money and identity decisions still go by DECISION self-email; none of this
touches them.

## 1. One-time setup, about ten minutes

1a. Admin sign-in. The commands act as the admin the way /admin does.

In the repo root, file `.env.local` (git-ignored), add:

```
ADMIN_EMAIL=anthonydellapia@gmail.com
SURVIVOR_ADMIN_PASSWORD=<your /admin password>
```

Leave the password out and the command asks for it, hidden, each run.

1b. Gmail. Google Cloud console > APIs & Services > Credentials > Create
credentials > OAuth client ID > Application type Desktop app. Enable the
Gmail API on the same project. Copy the id and secret into `.env.local`:

```
GMAIL_OAUTH_CLIENT_ID=<client id>
GMAIL_OAUTH_CLIENT_SECRET=<client secret>
```

Then, once:

```
npm run gmail:auth
```

You should see a URL; open it signed in as anthonydellapia@gmail.com, allow,
and the terminal prints `Token saved to ~/.config/survivor/gmail-token.json`.
The scope is gmail.modify: read, label, draft and, through the one gate in
section 4c, send. On a machine with no home-directory token (a Routine
container) paste that file's contents into `GMAIL_OAUTH_TOKEN_JSON` instead.

1c. Optional. `NTFY_TOPIC=<your topic>` in `.env.local` makes every command
post its one-line summary and every NEEDS ANTHONY line to
https://ntfy.sh/<topic>; unset, the lines are printed. Pick the topic
yourself; nothing here invents one. `REMINDER_AUTOSEND=true` is the send
gate in section 4c and is left unset unless you mean it.

## 2. Picks

2a. From Gmail. Every unread message from any owner email or player email on
the live roster, whatever its subject and whatever label it carries:

```
npm run picks
```

2b. From a text or a phone call. Paste the lines, one pick per line, in any
of the shapes players use ("Maria & Mary #3 - Eagles", "Mary/Maria 3:
Chargers", "Pumpy321 Chargers", "Eagles for both"), then Ctrl-D:

```
npm run picks -- --paste --from philadelphiapoultryinc@gmail.com
```

`--from` takes an email or a name fragment and must match one owner; it
scopes bare lines and "for both" to that person's entries, and an entry it
names outside those is staged, never written. `--file picks.txt` reads a
file instead of stdin. A message that names a week in its subject or first
lines ("Re: Week 1 picks - ...") is recorded in that week; `--week N`, then
the open week, is only the fallback for a message that names none. Mail
keeps its Gmail receipt time as the pick's time, so a reply that beat its
deadline stays on time however long it waited to be read.

2c. What you see: a table of entry, owner, team, deadline, on time or LATE,
and a note (new, OVERRIDE of the current pick, or already recorded). Under
it, every line it could not resolve, with the candidates it saw. Then:

```
Write 4 pick(s) and stage 1 pending row(s)? (y/N)
```

Only y or yes writes. Picks go through admin_submit_pick with source email or
text; a late one is stored with late = true, never refused and never hidden.
Unresolved lines become pending_actions rows (kind identity when there is no
sender or the sender matches nobody on the roster, player_question when a
known person sent it and the line itself is the problem) carrying the Gmail
message id, for /admin/queue. Mail read from Gmail is always recorded with
source email; `--source` applies to pasted or filed text only. Processed messages are marked read and filed under
Pool-Survivor-Done; `--keep-unread` leaves them. `--dry-run` shows the table
and stops.

2d. Name shorthand that cannot be derived from an entry name lives in
`scripts/picks/aliases.ts`. Add a line there when a new one turns up. Stored
names are never touched by any of this.

## 3. The list to Lynne

```
npm run lynne -- --week 1 --deadline fri
```

`--deadline` is the noon ET lock day: tue closes the Wednesday game, wed the
Thursday games, thu the Friday games, fri Saturday, Sunday and Monday. It
prints `<number>  <label>  -  <full team name>` sorted by her number, names
any entry it refused (no Lynne number or label on file), and creates the
same text as a draft in the "Survivor - DellaPia | 2026 Entry List" thread.
You should see `Draft <id> created ... Not sent`. Open Gmail, check it, send.
`--no-draft` prints only.

## 4. Chasing entries with no pick

```
npm run chase -- --week 1
```

For every live entry with no current pick for the week (voided and
eliminated entries excluded), grouped by recipient the same way
/admin/emails/picks groups them (a giftee gets their own message, an
addressless gift is on nobody's), it prints the recipient count and the
entry count, refuses to run if those do not reconcile to the live unpicked
count, shows the table, and after `y` creates one Gmail draft per recipient.
Each draft names that person's entries verbatim, gives the deadline of the
earliest-locking game they could still pick (teams already used by that
entry are left out) and the Friday boundary for everything else, and says to
reply to the email or text 215-384-8335. The subject carries the word
Survivor. You should see `draft <id> -> <address> (<n> entries)` per
recipient, then `Not sent`.

4a. `--bcc`: the same content minus the entry names, as one draft BCC to
every unpicked recipient, To yourself, for the days you want one click.

4b. `--dry-run` prints the table and the first message and stops. `--yes`
skips the y prompt (for a Routine). `--week` defaults to the open week.

4c. Sending. By default nothing here sends. `--send` mails the
`pick_reminder` template instead of drafting, and only when:

- the environment has `REMINDER_AUTOSEND=true` (otherwise the command
  exits at once with `REMINDER_AUTOSEND is not true: drafts only.`)
- the recipient has no current pick on the live roster
- no `pick_reminder_sent` audit row exists for that recipient on that ET
  lock day (a re-run prints `already sent ... skipped`)

Every send writes two audit rows: a claim (action `pick_reminder_claim`)
before the Gmail call, and the send (action `pick_reminder_sent`) after it
with the Gmail message id. A claim with no sent row means the run died
mid-send; later runs treat it as sent, so nobody is mailed twice, and the
push names the recipient so you can check /admin/audit. `--send` with
`--bcc` is refused. `pick_reminder` is the only template on the allowlist in
`scripts/lib/send.ts`; adding one is a code change, not a flag. How the Pick
Gap Check routine is told to use this is in docs/ROUTINES.md section 3e.

## 5. Her results sheet

```
npm run results -- --week 1
```

Finds Lynne's newest email with a `Football*.xlsx` attachment, downloads
it, prints its sha256, and refuses if that sha256 was imported before (the
`lynne_imports` dedupe, enforced again by the RPC). Then it takes exactly the
path /admin/import takes: her NO./NAMES grid is matched to our entries by her
number first, then exact name, then case-insensitive name, never fuzzy; the
plan is computed; and the variance table is printed with both values on
every line. Nothing is resolved. After `y` it commits through
`admin_apply_lynne_import`, the results-only importer, and prints the import
id. You should see the variance table and `import <id>`; review it on
/admin/import and /official.

5a. What is applied. Her grid carries teams and OUT status, not per-week
results, so on that format the importer records the file, the rows and the
variances and applies no result; scores come from /admin/scores. A legacy
per-week file (entry, team, result columns) applies a result to each entry
whose current pick agrees with hers. `--message-id <gmail id>` picks a
specific message; `--dry-run` stops before the commit; `--yes` skips the
prompt.

## 6. The week's picks, after the lock

```
npm run distribute -- --week 1
```

Refuses before the week's Friday noon lock. After it, one draft, To
yourself, BCC every owner address and every player address on a live entry
(the same list as the All filter on /admin/emails), with the /grid link and
the one-sentence standings line the dashboard shows. Nothing about money.
You should see `draft <id> created, BCC <k> addresses. Not sent`.

## 7. Notifications

```
npm run notify -- "one line"
```

Posts the line to ntfy.sh/`NTFY_TOPIC` when the topic is set, prints it
otherwise. picks, chase, results and distribute call the same function when
they stage a NEEDS ANTHONY row and when a run finishes.

## 8. Rules these commands keep

- Names are compared loosely and stored verbatim; nothing normalises a name.
- One entry, one team, or it is reported. No guess is ever written.
- Every write is an audited RPC as the admin. No service-role key exists.
- Drafts only. The one send path is `scripts/lib/send.ts`, allowlisted to
  `pick_reminder`, gated on `REMINDER_AUTOSEND=true`, once per recipient per
  lock day, every send audited.
- A variance is printed with both values and never resolved.
- Nothing here touches money or identity resolution.
