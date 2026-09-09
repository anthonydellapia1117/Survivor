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

2a. From Gmail. Every unread message from any confirmed owner's email or
any player email on their live entries, whatever its subject and whatever
label it carries. Your own mailbox is never on that list (the free entries
sit under your owner row), so your self-sent copies and DECISION notes are
not read as picks; picks for the AAA entries go in by paste (2b). An
entry the standings mark eliminated is off the intake roster, as it is off
the pick-email screen: the command names it at the start, and a reply for
it is staged, never written:

```
npm run picks
```

2b. From a text or a phone call. Paste the lines, one pick per line, in any
of the shapes players use ("Maria & Mary #3 - Eagles", "Mary/Maria 3:
Chargers", "Pumpy321 Chargers", "Eagles for both"), then Ctrl-D:

```
npm run picks -- --paste --from philadelphiapoultryinc@gmail.com
```

`--from` takes an email or a name fragment and must match one person; it
scopes bare lines and "for both" to that person's entries, and an entry it
names outside those is staged, never written. A gifted entry's name resolves
to the person who plays it, never to the buyer: `--from "Chas Flaster"` is
Chas and his two, not Kris and his four. A buyer's scope never holds a
gifted entry, addressed or not, and a gifted entry with no address on file
cannot be named by `--from` at all: it is picked by nobody until the address
is recorded. A `--from` that names a person with no live entry to pick for
writes nothing; every line is staged. `--file picks.txt` reads a
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

Only y or yes writes; after a paste the y is read from the terminal, so
`--paste` needs one (a pipe with no terminal is refused, never answered for
you). Picks go through admin_submit_pick with source email or text; a late
one is stored with late = true, never refused and never hidden. A change to
a pick that is already scored, an older mail arriving after a newer pick, or
a change after the lock is staged for you rather than written.
A team the entry already used in an earlier week is an ELIMINATION in her
pool, not a warning, so it is never written as an ordinary pick: it is
staged as a pending pick row that says which week the team was used in, and
approving it on /admin/queue records it knowingly with its receipt time.
One entry, one team: a message that gives the same entry two different
teams is staged with both named rather than written in the order the lines
happened to come, and that holds when one of the two is a repeated team:
the elimination question is withdrawn and the conflict row asks which team
was meant. A week heading on the same line as a team ("Week 2:
Chiefs") is a bare pick for that week, not an entry called "Week 2".
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
refuses to run before that tier has closed (the list is not final until
then; `--before-lock` overrides), prints `<number>  <label>  -  <team>` in
her own team vocabulary (Seattle, Green Bay, BYE) sorted by her number,
names any entry it refused (no Lynne number on file; a missing label means
she holds our entry name, which is what goes out), names what it held back
before the tier was even chosen (a MISSED row from the missed-pick sweep,
which is a loss and not a team; an entry the standings mark eliminated,
whose early pick for this week she must not receive; an entry with no
standings row, which is not on the roster the views carry), and creates
the same text as a draft in the "Survivor - DellaPia | 2026 Entry List"
thread. You should see `Draft <id> created ... Not sent`. Open Gmail, check
it, send. `--no-draft` prints only.

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
mid-send; later runs treat it as sent, so nobody is mailed twice. The push
for a failed send names nobody and quotes no error (an address is roster
data and stays off the push service); the recipient and the error are on
the terminal and the claim is on /admin/audit. Right before each send the
deadlines are judged again on a fresh clock, so a run that started before a
lock and was carried past it by the prompt or by earlier recipients skips
anyone whose choices have all closed, and claims nothing for them. `--send` with
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
/admin/import and /master-list.

5a. What is applied. Her grid carries teams and OUT status, not per-week
results, so on that format the importer records the file, the rows and the
variances and applies no result; scores come from /admin/scores. A legacy
per-week file (entry, team, result columns) applies a result to each entry
whose current pick agrees with hers. `--message-id <gmail id>` picks a
specific message; `--dry-run` stops before the commit; `--yes` skips the
prompt. The sheet's latest filled week must be the week being imported: an
older sheet has an empty Week N column and would record every entry as
missing, and a newer one is the next week's file and must keep its sha256
for that import. Either is refused by name; `--message-id` picks the right
message. A legacy per-week file carries no week of its own, so it is never
taken by date at all: it imports only from a message named with
`--message-id`.

5b. Her master sheet as a reference. Every row of the newest Football
xlsx she sends, one row per NO., the NAMES cell verbatim (trailing spaces,
her spelling), her filled week cells as she wrote them, keyed by the file's
sha256:

```
npm run lynne:roster -- --file "Football 2026-3.xlsx" --message-id <gmail id>
```

It prints the sha256 and the row counts first, names the duplicate names
her sheet carries (Ian Lubin 1 and 2 at 674-675 and again at 1319-1320 on
the 2026-09-08 sheet; stored as-is, one row per NO., never merged), and
when a prior sheet is loaded prints the diff against it (added, removed and
renamed NO.s) before anything is written. After `y` it loads through
`admin_load_lynne_roster`, the only write path, which writes every row and
one audit row together. A sheet already loaded is reported and left alone.
It never creates an owner or an entry and never changes a lynne_number; the
numbers are set through `admin_update_entry` as the 2026-09-08 renumber
was. `--dry-run` prints and stops; `--yes` skips the prompt. You should see
`Loaded <n> rows (<d> duplicate names kept as-is). Owners and entries
untouched.`

## 6. The week's picks, after the lock

```
npm run distribute -- --week 1
```

Refuses before the week's Friday noon lock. After it, one draft, To
yourself, BCC every owner address and every player address on a live entry
(the same list as the All filter on /admin/emails), saying the picks are
locked and post on the grid as each game kicks off, with the /grid link and
the one-sentence standings line the dashboard shows, read from the same
view the dashboard reads. Nothing about money.
You should see `draft <id> created, BCC <k> addresses. Not sent`.

## 7. Notifications

```
npm run notify -- "one line"
```

Posts the line to ntfy.sh/`NTFY_TOPIC` when the topic is set, prints it
otherwise. picks, chase, results and distribute call the same function when
they stage a NEEDS ANTHONY row and when a run finishes. A push about a
staged pick row says the kind and the week and points at /admin/queue,
never the reason or the line: both can carry a team, and a pick is not
public before kickoff. The push about a correction that beat the lock is
the same; the lock is judged at the moment the mail arrived, not when the
command ran.

## 8. Rules these commands keep

- Names are matched exactly on their words (case, `#`, spacing and
  punctuation aside), through the alias table and the owner's own name, never
  fuzzily: a typo'd name is staged with its candidates. Team words alone
  forgive one letter. Names are stored verbatim; nothing normalises one.
- One entry, one team, or it is reported. No guess is ever written.
- Every write is an audited RPC as the admin. No service-role key exists.
- Drafts only. The one send path is `scripts/lib/send.ts`, allowlisted to
  `pick_reminder`, gated on `REMINDER_AUTOSEND=true`, once per recipient per
  lock day, every send audited.
- A variance is printed with both values and never resolved.
- Nothing here touches money or identity resolution.
