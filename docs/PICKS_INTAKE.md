# Picks intake, chasing, results and the list to Lynne

TLDR: five local commands replace hand entry and the self-emailed DECISION
loop for picks. `npm run picks` turns unread player mail or pasted text into
a proposed table and writes only after you type y. `npm run lynne` prints the
entries that locked at a deadline in Lynne's numbering and leaves it as a
Gmail draft. `npm run chase` drafts one reminder per recipient with no pick.
`npm run results` brings her newest Football sheet in through the importer.
`npm run distribute` drafts the post-lock BCC with the one link - the anchor
AD-26-Survivor on the site root, never a path (CLAUDE.md, 2026-09-11). Every one
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
Publish the consent screen BEFORE running `npm run gmail:auth`, or the token
expires in seven days; the order, the Google prerequisites and where each
variable lives are in docs/ROUTINES.md section 10c-done.

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

`--deadline` is the 2:00 PM ET lock day: tue closes the Wednesday game, wed the
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
/admin/import and /grid.

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

## 5b. Her picks by email, when there is no sheet

She does not always send a sheet. Before the Wednesday and Thursday games of
Week 1 she sent a plain-text message with no attachment at all - Gmail
`1a08631cab24c4ce`, "Wednesday and Thursday Games", 2026-09-09 8:43 AM ET -
shaped as a heading naming a team, then one line per entry:

```
npm run lynne:picks -- --message-id 1a08631cab24c4ce
```

You should see the message's sender and subject, the week it derived, a line
per team with the NO.s under it, and then `Wrote 8 cell(s)`. Use `--find` in
place of `--message-id` to take her newest message with no attachment; it
prints which one it took before writing anything, and `--dry-run` stops before
the write.

Her format:

```
The following people are picking Seattle:
#144-Chris Mierzwa 11
#573- Judy Manzi

The following is taking the LA Rams:
#1200-Brett
```

5c. **This never writes to `picks`.** `picks` is this group's record of what
its own 121 chose; her statement about her whole pool goes into her own rows,
`lynne_roster.cells`, beside the cells her sheets carry. The two are compared
and never merged.

5d. **What stops the run, before anything is written.** A heading that maps to
none of her team names, or to more than one ("Seattle over Miami"), is printed
and nothing is written - "New York" is neither NY Giants nor NY Jets, and that
is exactly where a guess puts a pick on the wrong team. So is a NO. she states
under two different teams: that one is hers to settle. So is a line like
`1005 - E.A.T.` with no `#`, which is simply not read as an entry - missing a
row she stated is safe and reported, inventing one is not.

5e. **The week comes from the weeks table**, never from her subject line,
which names no week. It is the first week whose late deadline had not passed
when the message arrived. `--week N` overrides it and the derived value is
printed either way, so an override is visible.

5f. **A variance stops that row and nothing else.** Where she names one of the
121 and her team differs from the pick this group holds, the line carries both
values and the cell is left alone. Same where her email contradicts a cell of
her own sheet. Neither side is corrected. On the Week 1 load the only overlap
was her NO. 1005, `E.A.T.` on Seattle, which matched.

5g. **Run it twice and the second run writes nothing.** The guard is an
`audit_log` row keyed on the Gmail message id, so it holds for a re-run, for a
second ops run in the same window, and for SQL applied by hand.

5h. **The reveal rule is the site's, not this command's.** A cell is stored the
moment she states it; the public view serves it only once that team's game has
kicked off. On 2026-09-10 the seven Seattle cells were public and the LA Rams
cell was still masked, because that game had not started.

## 6. The week's picks, after the lock

```
npm run distribute -- --week 1
```

Refuses before the week's Friday 2:00 PM lock. After it, one draft, To
yourself, BCC every owner address and every player address on a live entry
(the same list as the All filter on /admin/emails), saying the picks are
locked and post on the grid as each game kicks off, with the one link and
the one-sentence standings line the dashboard shows, read from the same
view the dashboard reads. Nothing about money.
You should see `draft <id> created, BCC <k> addresses. Not sent`.

**One draft per week.** The week is claimed in `audit_log` under
`distribute_draft_claim` before the Gmail call and recorded under
`distribute_drafted` after it, the way `scripts/lib/send.ts` claims a send; a
claim on its own counts, so a draft whose outcome is unknown never becomes
two. A later run for a week that already has one prints
`Already drafted for week N at <time>; nothing to do.` and stops, so a second
tick in the same hour - or a hand run beside a scheduled one - cannot leave
two whole-roster drafts in Gmail. Two things are deliberately not blocked:
`--dry-run`, which creates nothing and still prints the message and the count,
and `--again`, which drafts it again on purpose after you have deleted the
first. A redraft records its own row.

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
  `pick_reminder` (once per recipient per lock day) and `week_reminder`
  (once per week SLOT, exact recipient count), both gated on
  `REMINDER_AUTOSEND=true`, every send audited.
- A variance is printed with both values and never resolved.
- Nothing here touches money or identity resolution.

## 9. The week reminder

```
npm run remind
```

Three mornings a week, one message to everyone: To yourself, Bcc every address
on the live roster (every owner address and every `player_email` on a live
entry, lowercased, once each, yours included). Set by Anthony on 2026-09-09
and put on three slots on 2026-09-10; the text is his Week 1 reminder with the
deadline sentences derived from the week's games, so Week 12 and Week 16 read
right without a special case.

| Slot | Morning   | Names                                              | Key          |
| ---- | --------- | -------------------------------------------------- | ------------ |
| wed  | Wednesday | the week's EARLY boundary - the Thursday game       | `week:N:wed` |
| thu  | Thursday  | the week's LATE boundary - the Sunday games         | `week:N:thu` |
| fri  | Friday    | that same LATE boundary, as the **FINAL CALL**      | `week:N:fri` |

Thursday and Friday name **one** boundary, so the once-only key is the week
and the SLOT and never the week and the boundary - under a boundary key the
final call would be dropped as a duplicate of Thursday's, with nothing printed
but `already sent`. Only the Friday message says FINAL CALL, in the subject
and on its first line.

Every deadline comes from the weeks table. A slot's morning is the ET calendar
date of a boundary the table holds - wed and fri on their boundary's own day,
thu on the day before the late one - and no hour is written anywhere in
`scripts/remind/lib/due.ts`: all eighteen weeks read 2:00 PM ET today and every
one could move without a line of it changing. The minute the mail actually
goes is the `pick-reminder` cron in `scripts/ops/config.json`
(`0 12 * * 3,4,5`).

With no arguments it reads the weeks table and the ET calendar, finds today's
slot, and drafts for it; on a day with no slot, or once that slot's deadline
has passed, it prints `Nothing due` and exits. `--week N --slot wed|thu|fri`
names one for a hand run (a slot whose deadline has passed is refused).
`--dry-run` prints the message and stops. `--yes` skips the y prompt.

9a. **The count gate.** The derived recipient count must equal
`EXPECTED_ROSTER_ADDRESSES` in `scripts/lib/constants.ts` (41)
exactly. Anything else prints the whole list and the delta, pushes a NEEDS
ANTHONY line, and stops before any draft or send. Not a range: a range let a
wrong count through once. When an address is corrected the count usually
stays 40; when it does not, the constant changes in a reviewed PR.

9b. **Sending.** `--send` mails the `week_reminder` template instead of
drafting, only when the environment has `REMINDER_AUTOSEND=true`, only once
per slot (a `week_reminder_claim` or `week_reminder_sent` audit row on
`week:N:wed`, `week:N:thu` or `week:N:fri` makes a re-run print `already sent`
and skip), and only when the Bcc count equals the expected count - the gate is
checked again inside `sendWeekReminder`, not only by the command. The claim
row goes in before the Gmail call, the sent row with the message id and the
full Bcc after it. The subject must begin `Survivor` or the send is refused.

9c. **What it says, and the one link.** Reply to the email or text the
number; more than one entry means one team for each; and the site link on
exactly one line, "You do not make picks in the app. It is there to look
at:". That line is the only place any pick-asking message may carry the
link, and `tests/unit/player-copy-submit-path.test.ts` holds it there.

9d. **The schedule** is a Routine, documented in `docs/ROUTINES.md`
sections 10 and 11. A Routine is created in the claude.ai UI and never from a
session or the API: the repo source and the environment are UI-only fields, so
an API-made Routine fires with nothing to run and reports success.

## 10. Operations from the repo

```
npm run ops -- hourly
npm run ops -- daily
npm run ops -- sweep | pick-reminder | lynne-import | chase | results | distribute
```

Set by Anthony on 2026-09-09, extended 2026-09-10. `scripts/ops/config.json`
holds every schedule (5-field cron, UTC) and parameter; `scripts/ops/cli.ts`
runs a job by spawning the same npm script a hand run uses, with the config's
arguments, so nothing here is a second code path.

**Two entry points, two Routines.** `hourly` runs every job whose cron fell
inside the last `tickWindowMinutes` (60) and prints one line per job; the
jobs' own once-only guards make a second run in the same hour a no-op. It was
called `tick` and that name still works. `daily` runs the six reporters in
`scripts/ops/reporters` against one read of the roster. `--dry-run` prints
what would run and starts nothing - it reaches no database and no Gmail.

The split is about what is hour-sensitive: a reply landing at 1:15 has to be
recorded before a 2:00 deadline, and the two sending jobs fire on a morning
slot and on a lock day, so those need the hour. Reporting does not.

10-0. **The reporters write nothing.** No send, no draft, no label, no mark,
no identity resolved, no variance resolved. Each prints twelve lines or fewer:
a `NEEDS ANTHONY` section, or the two words `NO ACTION`. When a list would
pass the cap it collapses into one line that keeps **every** name - the cap
yields to completeness, never the other way round. They replace the six
claude.ai Routines of `docs/ROUTINES.md` sections 3-7, which had Gmail and no
database and worked the roster out of mail; these read it. Gmail is optional
for a daily run, and its absence is reported rather than swallowed: without it
the sheet watch cannot see whether a newer sheet of hers is waiting, and
silence would read as "nothing is waiting".

10a. `sweep` is `npm run picks -- --yes`: every unread message from a known
player address whatever its subject or label, plus unread mail from anyone
else whose subject carries a word in `sweepSubjectTerms` (`survivor`,
`picks`), which is staged for you as an identity question and never written.

10b. `pick-reminder` and `chase` are the only jobs the config may mark as
sending, and the loader refuses a config that says otherwise or hands
`--send` to another job. Both still send only through `scripts/lib/send.ts`
with `REMINDER_AUTOSEND=true`; when that is unset the dispatcher does not
start them and prints `REMINDER_AUTOSEND is not true: drafts only, nothing
started`.

10c. `lynne-import` fetches her newest Football xlsx from Gmail to a temp
file and runs `lynne:roster` on it (a sha256 loads once; her filename is kept
as the temp file's basename, sanitised, because that is what `lynne_roster`
records as `source_file`). `results` and `distribute` run for the most recent
week whose late deadline has passed and say `no week has locked yet` before
Week 1 locks. `results` ends at exit 0 with `seen before, nothing to do` when
her newest sheet is the one already imported **for that week**, and fails when
it is one imported for another week - then her sheet for this week has not
arrived, and reporting the run as finished would leave the week's standings
stale.

10d. `expectedRosterAddresses` (41) is the exact count every whole-roster
message gates on - the reminder and the distribute draft both stop on any
other number and print the list. A distribute run that stops earlier, because
the week is already drafted, does not reach that gate; `--dry-run` does.

10e. A tick refuses to run at all if any job would lose a run to it - a slot
falling in the gap between two ticks. `npm run ops -- tick` names the job and
the slot. The schedules and the tick's own cron are in
`scripts/ops/config.json`; the loader every command imports checks only the
shape of that file, so a schedule that is wrong against the tick stops the
tick and not the picks intake.

## 11. Local desk or hosted runner: what runs where

Set 2026-09-10, from the code, after the Gmail OAuth session asked. Every
answer below names the file it comes from, so the next session reads the code
rather than asking again.

11a. **Both, and it is the same code either way.** There is no hosted intake
service. The commands are the local CLI on Anthony's Mac, and the Routine's
cloud container runs **those same commands**: `scripts/ops/cli.ts:137` is
`spawnSync("npm", ["run", cfg.command, "--", ...args])` and it is the only
child process anything in `scripts/` or `src/` spawns. So "hosted" here means
one more machine running `npm run`, with the same `.env` contract, not a
different code path. Nothing needs to move.

11b. **The token, hosted.** `storedToken()` in `scripts/lib/gmail.ts` reads
`GMAIL_OAUTH_TOKEN_JSON` when it is set and falls back to
`~/.config/survivor/gmail-token.json` otherwise. So yes: on a runner you paste
the contents of that file into `GMAIL_OAUTH_TOKEN_JSON`, which is what 1b
already says. The file stays on the Mac and is not moved or deleted; the two
are the same credential read from two places.

11c. **The Routine's Gmail connector does NOT make the OAuth path optional,
and this is the answer the question was really after.** `npm run ops` reaches
Gmail through `gmailClient()` - googleapis, `GMAIL_OAUTH_CLIENT_ID`,
`GMAIL_OAUTH_CLIENT_SECRET` and the stored token. There is **no MCP client
anywhere in `scripts/`**. The connector belongs to the *agent* in the Routine's
session, not to the command the agent is told to run, so it cannot stand in for
the OAuth credentials. A hosted run of these commands needs them.

**The seven-day expiry is real and it does break an unattended runner.** A
Google OAuth client whose consent screen is left in **Testing** issues refresh
tokens that stop working after seven days - that is Google's published policy
for the Testing publishing status, not anything this repo controls, and it
should be confirmed in the Cloud Console (APIs & Services > OAuth consent
screen) before acting on it. The consequence here is concrete:
`GMAIL_OAUTH_TOKEN_JSON` goes stale weekly, and every Gmail-touching job -
sweep, chase, lynne-import, results, distribute, the week reminder - fails
until somebody runs `npm run gmail:auth` again and re-pastes the JSON. That is
not unattended.

The way out is to move the consent screen to **In production**. A personal
gmail.com account can publish; it shows an unverified-app warning at consent,
which is acceptable for a single user granting access to his own mailbox.
**Internal is not an option** - that publishing status needs a Google Workspace
domain, and this is a gmail.com account. The third choice is to accept a weekly
re-auth, which means the runner is attended once a week and should not be
described as unattended.

11d. **Yes, unchanged.** A pick the intake resolves is written by
`submitPick` (`scripts/lib/db.ts:364`), which calls the audited
`admin_submit_pick` RPC - the same RPC `/admin` uses. A line it cannot resolve
is staged by `stagePending` (`scripts/lib/db.ts`) through
`admin_stage_pending` into `pending_actions`, with `kind` one of
`identity | player_question | pick` and `actor` the admin's own address. The
CLI writes nothing else and resolves nothing itself.

11e. **What the Routine actually did on 2026-09-10, and why it is not the
command running.** `audit_log` 681 at 10:46 ET staged Lynne's "Tonights game"
message with `actor` and `staged_by` = `ops-routine`. That row was **not
written by `npm run ops`**, on three independent readings of the code:

- `ops-routine` appears **nowhere in this repository**. Every command writes
  the actor `adminClient()` returns, which is `ADMIN_EMAIL` -
  `anthonydellapia@gmail.com`.
- its `kind` is `lynne`, and `stagePending` types `kind` as
  `identity | player_question | pick`. The CLI cannot produce `lynne`.
- its payload is `{subject, summary}` - prose - where the CLI builds
  `{entry_id, entry_name, week, team, source, received_at, from, subject,
  line, reason, question}`.

So the Routine's **agent** called `admin_stage_pending` directly through its
Supabase MCP connector and read the mail through its Gmail connector, rather
than running the command. Its prompt says the opposite: "never send, draft,
label or read mail yourself, and never touch the database except through that
command."

**The decision it recorded is correct** and the row is inert, which is the only
reason this is a note and not an incident: NO. 1283 and 1284 are outside
972-1092 (zero matching rows), it is staged and not applied, it names its
source message, and `KIND_DISPATCH` in `src/lib/queue.ts` covers only
`payment | pick | entries`, so `appliesAutomatically("lynne")` is false and
Approve cannot apply it by itself.

**What it is evidence of is the gap, not the fix.** An agent working around a
command it cannot run bypasses every guarantee the command carries: the typed
`kind`, the payload shape, the honest actor, `admin_submit_pick`, and the
send allowlist in `scripts/lib/send.ts`. An actor string that names the ops
routine on a row the ops routine did not write is the same shape as an actor
string naming a migration that did not exist (CLAUDE.md, Working rules).

11f. **A local checkout is never authoritative.** On 2026-09-10 Anthony's Mac
was sixteen commits behind at `8aaed4f`, which predates that week's merges -
so a file read there would have shown the old deadline table, the unwired
retired-address guard and the wrong pool-close date, all three as if they were
current. **`origin/main` is the source of truth for what this project does; the
database is the source of truth for what it holds.** Before quoting a file,
`git fetch origin main` and read that, or read it on GitHub. Before quoting a
number, read the database. A stale working copy disagreeing with either is a
stale working copy, never a discrepancy to investigate.
