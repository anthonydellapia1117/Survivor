# Routines

TLDR, as of 2026-09-10: **there are two Routines, and everything they run is
code in this repo.**

| Routine             | Cron (UTC)            | Runs                    |
| ------------------- | --------------------- | ----------------------- |
| **Survivor Sweep**  | `43 7-23,0-3 * * *`   | `npm run ops -- hourly` |
| **Survivor Daily**  | `30 12 * * *`         | `npm run ops -- daily`  |

`hourly` is what section 10 called the Ops Tick: every job in
`scripts/ops/config.json` whose cron fell in the last hour. It is renamed for
what it does and `tick` is still accepted. `daily` is new: the six reporters
in `scripts/ops/reporters`, which replace the six claude.ai Routines that
sections 3 to 7 of this file describe.

**Sections 3 to 7 are now history, not schedule.** Each of those Routines was
a prompt: a fresh session with Gmail, this repo and no database at all
(section 1b), working the roster out of mail. The same six checks now read the
live roster through the admin's own RLS session, and they are pure functions
with tests. The prompts are kept below because they are the specification the
code was written from, and because the reasoning in them - why Friday names
every recipient, why a variance carries both values, why the Venmo sweep never
pairs a sender with an owner - is the reasoning the code keeps. **Where a
prompt below and the code disagree, the code is what runs.** The old triggers
are paused and stay paused; nothing here deletes one.

The split is about what is hour-sensitive. A reply that lands at 1:15 has to
be recorded before a 2:00 deadline, and the two sending jobs fire six hours
before a boundary - so those need the hour. Reporting does not: once a day is
the difference between a report someone reads and twenty-four nobody does.

Set by Anthony on 2026-09-04, reshaped 2026-09-10. CLAUDE.md is the rulebook;
this file is the schedule. If a prompt here and CLAUDE.md disagree, CLAUDE.md
wins and the prompt is a bug.

## 1. How they run

1a. Mechanism: Routines (scheduled triggers). Fresh session per fire,
    environment `env_01E2ghUxXKj19qoDX3bTxf3p`, source repo
    `anthonydellapia1117/Survivor`, connector grant: Gmail only. **They are
    created in the claude.ai Routines UI, never from a session or the API:**
    in this org the API path cannot attach a connector, and a Routine created
    that way on 2026-09-04 came back with no Gmail and no repo source, so it
    was deleted. The repo and the environment are UI-only fields, which is
    why creating one from a session produces a Routine that runs and does
    nothing. Section 9d is the checklist and section 10 has the click path.

1b. What a run can see: Gmail (full threads, never previews), this repo, and
    the real clock. There is no database connection, no admin login and no
    service-role key, by design. Every routine works from the mail record
    and the game rows in the repo, and says so when the app is the only
    place a fact can be settled. Gmail returns timestamps in UTC; every
    prompt converts to ET before comparing with a deadline. The one
    exception is section 3e: an environment that carries the admin login
    and the Gmail token can run `npm run chase`, which reads the live roster
    through the admin's own RLS session, never a service-role key.

1c. The hourly sweep these sit beside: "Survivor Gmail Sweep", every hour
    07-23 UTC. It reads unread mail under the label **Pool-Survivor** and
    unread Venmo receipts whose body carries exactly one tier amount, records
    picks, stages entries and payment candidates, marks what it handled read
    and labels it **Pool-Survivor-Done**. Those two labels are the only
    filing convention the routines rely on, and each prompt checks they exist
    before trusting a search.

1d. Output contract, every routine, every run: 12 lines or fewer. Either a
    section headed **NEEDS ANTHONY**, one line per item with the exact
    question and, where one applies, the deadline it is tied to, or the
    words **NO ACTION** alone. No narration and no list of what was fine.
    When a list would pass the cap it collapses into one line that leads
    with the count and keeps every name (and, for a late pick, the entry and
    team); a name is never dropped to fit, and the cap yields to completeness.

1e. Standing limits in every prompt: read CLAUDE.md first, never mark Paid,
    never resolve or suggest an identity, never send or draft anything
    (the single, gated exception is the pick_reminder template in section
    3e), never write to Lynne, never report, quote or name anything that
    belongs to another pool.

1f. Clock. Routines store cron in UTC. Every cron below is given at the
    EDT offset (UTC-4). From Sunday 2026-11-01 (EST) each fires one hour
    earlier on the ET clock. The deadline side is safe either way: no run
    lands on the wrong side of a noon deadline. The kickoff side is handled
    per routine and stated in each section. The two mail windows anchored to
    a run time, both in Final Sheet Watch (the Thursday read since Tuesday,
    and the carry-over of anything that landed after the previous Thursday),
    are bounded at 4:00 PM ET all season so the shift opens no gap. To put the ET times back
    after Nov 1, add one to the UTC hour of each cron.

1g. Season end. Four routines report NO ACTION after 2027-01-12; Final Sheet
    Watch after 2027-01-14, so a late Week 18 sheet is still read. Disable
    them then. All but the Venmo Wide Sweep also report NO ACTION before
    2026-09-07; the Venmo Wide Sweep first fires that day and may be fired by
    hand earlier.

## 2. The week they follow

| ET                  | What happens                                                    | Routine              |
| ------------------- | --------------------------------------------------------------- | -------------------- |
| Mon 8:05 AM         | Second-pass Venmo read: aggregates and splits                   | Venmo Wide Sweep     |
| Mon 9:05 AM         | Requests out (Wed-game weeks), coverage vs last week, season notes | Pick Gap Check    |
| Tue 9:05 AM         | Wednesday-game picks close at noon (Weeks 1, 12)                | Pick Gap Check       |
| Tue 2:20 PM         | Wednesday tier closed: late picks, picks to Lynne               | Deadline Close Check |
| Tue 5:05 PM         | Lynne's Final Sheet for last week: in, read, summarised         | Final Sheet Watch    |
| Wed 9:05 AM         | Thursday-game picks close at noon; last week's recap forwarded? | Pick Gap Check       |
| Wed 2:20 PM         | Thursday tier closed: late picks, picks to Lynne                | Deadline Close Check |
| Thu 9:05 AM         | Friday-game picks close at noon (Weeks 12, 16)                  | Pick Gap Check       |
| Thu 2:20 PM         | Friday tier closed: late picks, picks to Lynne                  | Deadline Close Check |
| Thu 3:05 PM         | Her early-tier echo vs what Anthony sent                        | Lynne Echo Check     |
| Thu 5:05 PM         | A sheet that landed late, and her corrections since Tuesday     | Final Sheet Watch    |
| Fri 9:05 AM         | Everything else closes at noon: automatic loss                  | Pick Gap Check       |
| Fri 2:20 PM         | Week locked: late picks, sweep due, roster drift, picks to Lynne| Deadline Close Check |
| Sat 3:05 PM         | Her full-week echo vs what Anthony sent                         | Lynne Echo Check     |
| Thu 11-26 11:05 AM  | Thanksgiving: the echo check before the 1:00 PM kickoff         | Lynne Echo Check     |

Days a tier does not close report NO ACTION. Every routine but the Venmo Wide
Sweep derives the week and the tier from the game rows of
`supabase/migrations/20260822000014_nfl_schedule.sql` (the `day_of_week`
column; that file's header comment, weeks rows and `pick_deadline` carry a
Week 1 special case that `20260903000041` removed) and the deadline table in
CLAUDE.md, never from a hard-coded calendar.

Calendar facts the prompts rely on: Week 1 has a Wednesday game (NE at SEA,
Wed 09-09 8:20 PM ET, closes Tue 09-08 noon). Week 12 has a Wednesday game,
three Thursday games from 1:00 PM, and a Friday game (Tue, Wed, Thu noon).
Week 15 has two Saturday games (Friday noon, same as Sunday). Week 16 has a
Thursday game and three Christmas Day games from 1:00 PM (Wed and Thu noon).
Week 18 has no Thursday game. Week 8 is where the app's local calculation
switches to single elimination and the first week a SKIP_WEEK may be
submitted, per the rules engine and its config default of 7; CLAUDE.md is
silent on both and Lynne's sheet decides eliminations either way.

## 3. Pick Gap Check

Name: **Survivor Pick Gap Check**
Cron (America/New_York): `5 9 * * 1-5`
Cron stored (UTC): `5 13 * * 1-5`
Trigger ID: see section 9d.

Why: a missing pick takes an automatic loss in the app's sweep, no grace
period. The hourly sweep records what arrives; nobody reports what has not.
Monday asks whether the requests went out in a Wednesday-game week and
whether anyone dropped off the list. Tuesday to Thursday gives the count of
silent recipients against the teams that close at noon. Friday names them,
because at noon every silent entry is at stake. After Nov 1 it fires at 8:05
AM, still before every noon.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-12 report NO ACTION and stop.

You are the Pick Gap Check for the Survivor sub-pool. Hyphens only, no emojis.

1. Work out the week and the tier from the repo, never from memory. Game days come from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file: take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day (NE at SEA is Wednesday 09-09 at 8:20 PM ET although kickoff_at reads 2026-09-10). That file's header comment, its weeks rows and its pick_deadline carry a Week 1 special case that supabase/migrations/20260903000041_tiered_pick_deadlines.sql removed; the tier rule is CLAUDE.md's pick deadline table, applied to every week including Week 1. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. The open week is the lowest week whose Friday noon has not passed (a week's Friday is the one before its Saturday, Sunday and Monday games); if none is open, NO ACTION and stop. Tuesday, Wednesday and Thursday each close a tier only if the open week has a game the next day: Tuesday closes Wednesday-game picks (Weeks 1 and 12), Wednesday closes Thursday-game picks (every week except 18), Thursday closes Friday-game picks (Weeks 12 and 16). Friday always closes every remaining pick, Saturday, Sunday and Monday games alike. Monday closes nothing. The week numbers in parentheses are what the rows hold today; if the rows disagree, the rows win. Call a tier by its game day: Wednesday-game, Thursday-game, Friday-game, or weekend.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET before comparing with any deadline, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. The requests. Search Sent for the open week's pick requests: in:sent subject:("Week N pick" OR "Week N picks"), and keep a thread only if its subject starts with Week N pick or Week N picks followed by a dash (the app writes it as an em dash), a recipient name and an entry count, checking the number exactly so Week 1 never picks up Weeks 10 to 18. Each is one recipient and names that recipient's entries. If none match, also search Sent bodies for "Week N picks" with "AD Survivor Pool" before concluding nothing was sent.
3a. No requests and a tier closes today: NEEDS ANTHONY - Week N pick requests not sent - <tier> picks close at noon today. No requests on Monday: one line only if the open week has a Wednesday game (Weeks 1 and 12): Week N pick requests not sent - Wednesday-game picks close Tuesday noon. Any other Monday with no requests is NO ACTION; the next run on a day a tier closes asks.
3b. Requests exist, on Monday and on the first day this week a tier closes: compare the recipient addresses with the previous week's requests (Week 1: skip, there is no earlier week). Any address asked last week and not this week is one line: <address> - asked Week N-1, not Week N - dropped or done? If CLAUDE.md's roster snapshot names a gifted entry with no player address, one line: <entry> - gifted, no address on file per the CLAUDE.md snapshot - confirm on /admin/emails/picks; nobody is asked for it.
3c. Monday season notes, one line each and only on the day named: 2026-10-26 (Week 8: the app's local calculation switches to single elimination and SKIP_WEEK becomes submittable, per the rules engine and its config default of 7; CLAUDE.md is silent on both and Lynne decides eliminations - remind Anthony to confirm on /admin and to say so in his Week 8 request; this job writes nothing); 2026-11-23 (Week 12 has three early tiers: Tuesday, Wednesday and Thursday noon); 2026-12-21 (Week 16 Christmas Day games close Thursday noon); 2027-01-04 (Week 18 has no Thursday tier).
3d. Wednesday only, Week 2 onward: if Sent holds no message whose subject is Survivor, a dash, Week N-1 recap (the app writes that dash as an em dash) by now, one line: Week N-1 recap not found in Sent - forwarded?

4. Tuesday to Friday, when a tier closes today: for every request thread decide whether the recipient has replied with a team for every entry named in the request. Look at replies on the request thread, and at messages from that address under Pool-Survivor or Pool-Survivor-Done whose subject or first line names Week N or one of that recipient's entries; open nothing else from that address. An entry is picked when the reply assigns it a team, explicitly or by all or both; the same team on more than one of a recipient's entries is still a pick for each. A recipient whose reply covers only some entries is a partial. Map a team name to its abbreviation the way normalizeTeam in src/lib/lynne/parse.ts does: abbreviation, full name, city or nickname from NFL_TEAMS in src/lib/standing.ts, or Lynne's city names in src/lib/lynne/names.ts, case-insensitive, exact after trimming, never fuzzy. A name that maps to nothing there leaves the entry unpicked and is quoted in that recipient's line with a question, never guessed.
4a. Tuesday, Wednesday, Thursday: one line naming the teams whose picks close at noon today (away and home of every game whose day_of_week is tomorrow's day) and the count of recipients and entries with no reply yet: anyone taking one of those teams must be in by noon, the rest have until Friday. Then one line per partial: <name> - <k> of <n> entries picked - which team for the rest? Never list every silent recipient on these days; the count is the item. If every recipient has replied for every entry named and there is no partial, 4a writes nothing.
4b. Friday: every entry with no pick at noon takes an automatic loss in the app's missed-pick sweep (the rules engine; CLAUDE.md is silent on it and Lynne decides elimination in her pool). If no entry is at stake, 4b writes nothing. Otherwise lead the section with the count of entries at stake, then one line per recipient with no reply or a partial: <name> - <k> of <n> entries picked. If that would pass the cap, give the count, every name in one comma-separated line, and say the per-entry detail is on /admin/week/N.
4c. If the section has any line, add once: confirm on /admin/week/N before chasing; Gmail is not the record, the app is.
4d. If nothing under steps 3 and 4 produced a line, whether or not a tier closes today, Monday included: NO ACTION.

5. Never mark anything Paid. Never resolve who a sender is: a reply from an address that matches no request is one line with the address and the entry names it claims, and a question; never pair it with an owner name from memory. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

6. Report in 12 lines or fewer. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, collapse a list into one line that leads with the count and keeps, for every item, the name and the entry and, for a late pick, the team; never drop a name to fit.
```

Expected on a quiet Wednesday: NO ACTION. Expected on Friday 09-11 with two
owners silent: a NEEDS ANTHONY section led by the number of entries at stake.

3e. Autosend: the pick_reminder template. Set by Anthony on 2026-09-08.

    The reporter above never writes. Chasing is a separate command,
    `npm run chase` (docs/PICKS_INTAKE.md section 4), which by default
    leaves one Gmail draft per recipient with no pick and creates nothing
    else. It can send instead, under exactly these conditions, all enforced
    in `scripts/lib/send.ts` and none of them a prompt's to relax:

    - the template is `pick_reminder`, the only name on the send allowlist
    - the environment has `REMINDER_AUTOSEND=true`; unset (the default) or
      any other value means drafts only, whatever flags are passed
    - the recipient has no current pick for the week, from the live roster,
      never from Gmail
    - at most one send per recipient per ET lock day, judged from
      `audit_log` rows with action `pick_reminder_sent`; a re-run in the
      same lock day reports "already sent" and skips
    - every send writes that audit row with the recipient, the week, the
      lock day, the deadline and the Gmail message id, and a claim row
      (`pick_reminder_claim`) goes in before the Gmail call, so a run that
      dies mid-send still blocks a second mail that day

    To let the Pick Gap Check use it, the Routine's environment needs, in
    addition to the Gmail connector: `ADMIN_EMAIL`, `SURVIVOR_ADMIN_PASSWORD`,
    `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`,
    `GMAIL_OAUTH_TOKEN_JSON` (the contents of
    `~/.config/survivor/gmail-token.json` after `npm run gmail:auth`),
    `REMINDER_AUTOSEND=true`, and optionally `NTFY_TOPIC`. The Supabase
    URL and anon key are in `.env.production` in the repo. Then add this
    step to the prompt, after step 4 and before step 5, pasted whole
    (Anthony pastes it; nothing in this repo edits a Routine):

    ```
    4e. Sending, only when the environment has REMINDER_AUTOSEND=true and only on a day a tier closes: run `npm run chase -- --week N --send --yes` from the repo root. It mails the pick_reminder template to each recipient with no pick on the live roster, once per recipient per lock day, and writes an audit row per send. Report its output under NEEDS ANTHONY as one line per line it printed that starts with "sent", "already sent", "NEEDS ANTHONY" or "refused"; if REMINDER_AUTOSEND is not true it exits with "drafts only" and you write nothing for this step. Never run it with --bcc, never run it twice in one run, and never send anything any other way.
    ```

    Without that environment the step exits with `REMINDER_AUTOSEND is not
    true: drafts only.` and the routine stays a reporter. Turning it off is
    removing the variable; no code change is involved either way.

    Never run two autosends at once (a hand run of `npm run chase --send`
    while the routine is firing): the once-per-recipient-per-lock-day check
    is read from audit_log immediately before each send, not reserved in
    the database, so two overlapping runs could each mail one recipient.
    One admin, one run at a time is the standing assumption (CLAUDE.md,
    Working rules).

## 4. Deadline Close Check

Name: **Survivor Deadline Close Check**
Cron (America/New_York): `20 14 * * 2-5`
Cron stored (UTC): `20 18 * * 2-5`
Trigger ID: see section 9d.

Why: three things become true when a tier closes and none announce
themselves. A pick that arrived after noon is late, recorded with a late flag,
and Anthony decides what to do with it. The picks for that tier are on their
way to Lynne, or are not. On Friday the whole week is locked, the missed-pick
sweep is a click, never automatic, and standings are silently wrong until it
runs. It fires at 2:20 PM (1:20 PM after Nov 1) so a send made over lunch is
found rather than nagged about; the first kickoff in the tier a run covers is
always the following day or later, and every earlier kickoff belongs to a
tier the previous run already covered.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-12 report NO ACTION and stop.

You are the Deadline Close Check for the Survivor sub-pool. Hyphens only, no emojis.

1. Work out the week and the tier from the repo, never from memory. Game days come from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file: take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day. That file's header comment, its weeks rows and its pick_deadline carry a Week 1 special case that supabase/migrations/20260903000041_tiered_pick_deadlines.sql removed; the tier rule is CLAUDE.md's pick deadline table, applied to every week including Week 1. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. Week N is the lowest week whose Friday noon had not passed at 11:59 this morning; if none, NO ACTION and stop. A tier closed at noon today only if today is the day before one of week N's game days: Tuesday closed Wednesday-game picks (Weeks 1 and 12), Wednesday closed Thursday-game picks (every week except 18), Thursday closed Friday-game picks (Weeks 12 and 16), and Friday closed every remaining pick. Saturday, Sunday and Monday close nothing: on those days NO ACTION and stop. If nothing closed today: NO ACTION and stop. The week numbers in parentheses are what the rows hold today; if the rows disagree, the rows win. Call a tier by its game day: Wednesday-game, Thursday-game, Friday-game, or weekend.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET before comparing with any deadline, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. Late picks. A pick is late when it arrived, in ET, after its own team's deadline: noon on the day before that team's game day. Look at replies on the Week N pick-request threads in Sent (subject Week N pick or Week N picks, the number checked exactly) and at messages under Pool-Survivor or Pool-Survivor-Done whose subject or first line names Week N, received since the week's first tier closed, not only since noon today; on Friday that includes every Week N pick received after Friday noon. Map a team name to its abbreviation the way normalizeTeam in src/lib/lynne/parse.ts does: abbreviation, full name, city or nickname from NFL_TEAMS in src/lib/standing.ts, or Lynne's city names in src/lib/lynne/names.ts, case-insensitive, exact after trimming, never fuzzy. A name that maps to nothing there is quoted with a question, never guessed. The app's pick RPC records a pick entered after its deadline with a late flag and does not refuse it (CLAUDE.md is silent on the flag), and this job decides nothing. One line each: <name> - <entry> - <team> - received <time> ET - after the <tier> deadline - accept, refuse or sweep is your call on /admin/week/N. A pick reported by an earlier run this week may be repeated if it is still the same question.

4. Picks to Lynne. CLAUDE.md does not fix when Anthony sends her each week's picks; her own cadence (Thursday-game picks echoed Wednesday or Thursday, the full week Friday or Saturday) is what makes this worth asking after each close. Report only what Sent shows: search Sent since Monday 00:00 ET for a message to Lynne carrying Week N picks, the NO./NAMES grid or an attachment named DellaPia_WeekN_Picks.csv. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv or DellaPia_Roster*.csv attachment, a NO./NAMES grid, or a roster list of entry names in the Name #1 numbering of CLAUDE.md sent on or after 2026-08-24, and, once that address is known, her own messages from that address, in those threads or under Pool-Survivor or Pool-Survivor-Done; if none of that exists, one line: Lynne not identifiable from the mail record - step 4 skipped. If no Week N send is found: one line - no Week N picks to Lynne in Sent this week - sent another way, sending later, or not needed for the <tier> tier? If the latest one predates today's noon and today is Wednesday, Thursday or Friday (Tuesday is left alone on purpose; nothing says the Wednesday-game picks go to her separately): one line - Week N picks to Lynne last sent <time> ET - does it cover the <tier> tier?

5. Friday only. Week N locked at noon (CLAUDE.md: the late deadline is the sweep boundary) and the missed-pick sweep is a click, never automatic, per the app, on which CLAUDE.md is silent; standings are silently wrong until it runs. One line: Week N locked - run the sweep at /admin/deadline - Gmail shows <k> recipients with no reply: <names> (or: Gmail shows every recipient replied) - the sweep preview is the record. Then roster drift: her latest roster mail is the most recent Sent message to her carrying a DellaPia_Roster*.csv attachment or a roster list of entry names; if any message under Pool-Survivor-Done received since it asks for a new entry, one line: <k> new-entry mails since her roster of <date> - roster drift is on /admin/entries - send before Week N+1's first tier (in Week 18 there is no next week: end the line at /admin/entries). If step 4 could not identify Lynne, skip this roster line and say so in the step 4 line.

6. Never mark anything Paid. Never resolve who a sender is: an unmatched address is one line with the address and the entry names it claims, and a question; never pair it with an owner name from memory. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

7. Report in 12 lines or fewer. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, collapse a list into one line that leads with the count and keeps, for every item, the name and the entry and, for a late pick, the team; never drop a name to fit.
```

Expected on a Tuesday with no Wednesday game: NO ACTION. Expected every
Friday: at least the one sweep line.

## 5. Lynne Echo Check

Name: **Survivor Lynne Echo Check**
Cron (America/New_York): `5 15 * * 4,6`
Cron stored (UTC): `5 19 * * 4,6`
Trigger ID: see section 9d.

One-shot, same prompt: **Survivor Lynne Echo Check (Thanksgiving)**, fires
once at Thu 2026-11-26 11:05 AM ET (`2026-11-26T16:05:00Z`), before the
1:00 PM kickoff. Trigger ID: see section 9d.

Why: what Anthony sent and what Lynne recorded are two documents, and the
week she transcribes one wrong is the week an entry loses on a team it never
picked. Thursday compares every early-tier row (Wednesday, Thursday and
Friday games, all closed by Thursday noon) at 3:05 PM, five hours before an
8:15 PM Thursday kickoff; Saturday compares the full week the afternoon before
the Sunday slate, and in Week 15 under three hours before the 5:00 PM
Saturday game. Thanksgiving's 1:00 PM game needs the 11:05 AM one-shot. The
two Wednesday games (Weeks 1 and 12) are checked Thursday, after they were
played; fire the routine by hand on Wednesday afternoon for a pre-kickoff read;
that run compares only the Wednesday-game rows. Variances carry both values and are never resolved.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-12 report NO ACTION and stop.

You are the Lynne Echo Check for the Survivor sub-pool. Hyphens only, no emojis.

1. The week, from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file. Take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day (a Thursday 8:15 PM ET game reads as Friday 00:15Z or 01:15Z); ignore that file's header comment and deadline rows, which predate the current tiers in CLAUDE.md. On Thursday it is the week that has a game whose day_of_week is Thursday and whose kickoff, converted to ET, falls on today's date, whether or not it has kicked off; if no week does (Week 18 is the only such Thursday), NO ACTION and stop. On Saturday it is the week whose Sunday games are tomorrow in ET. On Wednesday, which only a hand fire reaches, it is the week that has a game whose day_of_week is Wednesday and whose kickoff, converted to ET, falls on today's date (Weeks 1 and 12), and only the Wednesday-game rows are in scope. On any other day this job does not run: NO ACTION and stop. Thursday covers every early-tier row of week N: entries whose team plays Wednesday, Thursday or Friday of that week, every tier that has closed by the time this run fires; at the 11:05 AM Thanksgiving fire the Friday-game tier is still open and its rows are compared at the afternoon run. Saturday covers the full week.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. Her echo. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv or DellaPia_Roster*.csv attachment, a NO./NAMES grid, or a roster list of entry names in the Name #1 numbering of CLAUDE.md sent on or after 2026-08-24, and, once that address is known, her own messages from that address, in those threads or under Pool-Survivor or Pool-Survivor-Done; if none of that exists, one line: Lynne not identifiable from the mail record - nothing to compare, and stop. Find her Week N message: on Wednesday or Thursday her early-tier picks list, sent Tuesday to Thursday, usually in the shape Dallas-#1110-Name and #1158-Name; on Saturday her full-week picks, sent Friday or Saturday, usually with a spreadsheet. If her message takes another shape, still compare and say in one line what shape it took. Read the attachment if the tool exposes it; if it does not, say so in one line and compare only the rows her body text actually carries: an entry absent from the body because her list is in an attachment this run cannot read is never reported as unlisted, and if the body carries no rows for ours the only line is: her Week N echo is an attachment this run cannot read - compare on /admin/import.

4. His submission. Take every Week N submission to her in Sent, the NO./NAMES grid or DellaPia_WeekN_Picks.csv, and merge them: where the same entry appears more than once, the latest message wins for that entry. On Thursday keep only the merged rows whose team plays Wednesday, Thursday or Friday; on Wednesday keep only those whose team plays Wednesday. A submission that is only an attachment this run cannot read is found but not comparable: one line - Week N submission to Lynne is the CSV only and this run cannot read it - nothing to compare, and stop; never report it as not found and never compare against an empty set.

5. Compare. Ours are the numbers and names Anthony has sent her this season, from his submissions and roster mails in Sent. Compare only rows whose number or name is in that set: match by her number first, then exact name, then case-insensitive name. Never fuzzy. A row on her list matching none of ours by number or name is not ours and is never reported. Teams compare as text the same way; his CSV already uses her team names and the literal BYE, so a difference in team text is a variance to report, not to reconcile. One line per difference, both values shown: she lists a different team; she does not list an entry he sent (per CLAUDE.md a missing entry is not a data error and may be one she already eliminated, so the line asks whether it is out); she lists one of ours he did not send; one of our numbers carries a name that is not ours, or one of our names a number that is not ours. Per CLAUDE.md never assume which side is wrong and never resolve it. The deadline each line is tied to is the earliest kickoff, in ET, among the games in scope that is still ahead of now; if every game in scope has kicked off, write already kicked off in place of a deadline.

6. Her echo has not arrived: one line - no Week N <early-tier or full-week> echo from Lynne as of <time> ET - nothing to compare; on the Saturday of Week 15 add: Saturday games kick off 5:00 PM and 8:20 PM ET. His submission is not in Sent: one line - Week N submission to Lynne not found in Sent.

7. Never mark anything Paid. Never resolve identity. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

8. Report in 12 lines or fewer. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If there are more than seven differences, list the first seven and one closing line that leads with the count and names every remaining entry, comma separated: <k> more: <entries> - her Week N list does not line up with his submission; compare on /admin/import.
```

Expected when her list matches his: NO ACTION. Expected on a transcription
slip: one line naming the entry, her team, and his team.

## 6. Final Sheet Watch

Name: **Survivor Final Sheet Watch**
Cron (America/New_York): `5 17 * * 2,4`
Cron stored (UTC): `5 21 * * 2,4`
Trigger ID: see section 9d.

Why: her Final Sheet is the authority on who is out. It arrives Monday or
Tuesday, corrections follow as separate mails, and three admin clicks hang
off it: import, scores, recap. Tuesday reads the sheet and hands Anthony the
list, with the duplicate-team eliminations named because those are the ones
people do not believe. Thursday catches a sheet that landed late and any
correction since. If the tool does not expose the spreadsheet, the run
reports arrival and whatever her text says, and says so. After Nov 1 both
fires land at 4:05 PM ET; the Thursday window is anchored at 4:00 PM so the
shift opens no gap.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-14 report NO ACTION and stop.

You are the Final Sheet Watch for the Survivor sub-pool. Hyphens only, no emojis.

1. Week N is the one that just finished: the highest week whose every kickoff is earlier than now, from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql. kickoff_at in that file is UTC (a Monday night game is stamped early Tuesday UTC; Week 18 has no Monday game); convert to ET before comparing. Ignore that file's header comment and deadline rows, which predate the current tiers in CLAUDE.md. If no week has finished, NO ACTION and stop. On Thursday this run covers only what arrived since Tuesday 4:00 PM ET (the Tuesday run fires at 5:05 PM ET through 2026-10-27 and at 4:05 PM ET from 2026-11-03; an hour of overlap repeats a line, a gap loses a correction): her sheet if it was not in by then, and any message from her since. If nothing from her arrived in that window, NO ACTION and stop. On any day other than Tuesday or Thursday this job does not run: NO ACTION and stop.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv or DellaPia_Roster*.csv attachment, a NO./NAMES grid, or a roster list of entry names in the Name #1 numbering of CLAUDE.md sent on or after 2026-08-24, and, once that address is known, her own messages from that address, in those threads or under Pool-Survivor or Pool-Survivor-Done; if none of that exists, one line: Lynne not identifiable from the mail record - nothing to read, and stop. Find her Week N Final Sheet, anything from her after week N's last kickoff in ET (usually Monday or Tuesday; Week 18 ends Sunday afternoon, so its sheet may land Sunday night), and every message from her after it: corrections arrive as follow-ups and each must be re-read. Read the attachment if the tool exposes it; say in one line if it does not. If her Week N-1 sheet, or any correction to it, arrived after last Thursday 4:00 PM ET, no run has reported it: report it under the same lines with N-1 in place of N.

4. Ours are the roster as he last sent it to her: every entry named in his roster mails and submissions in Sent (names from the roster lists, numbers and names from the NO./NAMES grids and DellaPia_Week*_Picks.csv files), less every entry he asked her to delete, the latest instruction winning. A name he told her to remove is not ours, whatever it was called before. An entry with a name but no number yet is still ours. Match her rows to ours by her number first, then exact name, then case-insensitive name; never fuzzy; a row matching none is not ours and is never listed. From her sheet, for ours only:
4a. Her pool-wide counts if she gives them, quoted exactly as she writes them (in the body, or the NO LOSSES / 1 LOSS/BYE / OUT rows under the grid if the attachment is readable); if neither is readable, one line: her counts not in the mail text.
4b. Ours she marks Out. On her sheet Out is the red fill on the NAMES cell or the literal OUT in a week column. A text read of the attachment loses fill: when that is all you have, count Out from literal OUT cells and her own words, and say once: fill colours not readable here - Out count is a floor, confirm on /admin/import. Give the team and, if she gives one, her reason. A duplicate team is an elimination in her pool, never a warning: name any, with the two weeks if she cites them; otherwise say she did not.
4c. Ours on her previous sheet and absent from this one. Her sheet shrinks by design and a missing entry is not an error; list them so Anthony can confirm each is an elimination he already knows about; they are not in the 4b count. Week 1: there is no earlier sheet; instead list any of ours her Week 1 sheet does not carry.
4d. Anything in her mail that changes a number, a standing or a deadline.

5. NEEDS ANTHONY lines:
- Week N Final Sheet in at <time> ET - <k> of ours Out: <names> - back up, import at /admin/import, review variances, enter scores at /admin/scores, recap at /admin/recap.
- one line per item from 4b, 4c and 4d, showing her value and what his submission in Sent says. This run cannot see the app; where only the app can settle it, say so in the line instead of supplying a value.
- correction received <time> ET after the sheet: <what changed> - re-check the import.
- Tuesday, no sheet by now: no Week N Final Sheet from Lynne as of <time> ET.

6. Never mark anything Paid. Never resolve identity: one of ours whose number appears under a name that is not ours, or one of ours her sheet does not carry, is a line with both values, not a decision; her other entries are never listed. Never auto-resolve a variance. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

7. Report in 12 lines or fewer. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If one line per item would pass 12, collapse 4b into one line that leads with the count and names every entry, comma separated, and 4c the same way; the cap yields to completeness, never the other way round.
```

Expected on a normal Tuesday: one line with the sheet's arrival time and the
count of ours out, plus one line per elimination. Expected on a Thursday with
no sheet or correction since Tuesday: NO ACTION.

## 7. Venmo Wide Sweep

Name: **Survivor Venmo Wide Sweep**
Cron (America/New_York): `5 8 * * 1`
Cron stored (UTC): `5 12 * * 1`
Trigger ID: see section 9d.

Why: the hourly sweep touches unread receipts whose body carries exactly one
tier amount. CLAUDE.md says that filter is the first pass, not the only one:
Nicholas Teti's $200 covered eight entries across two owners, and Charles
Raudenbush's $100 came as two $50 deposits. This is the second pass, once a
week, over every Venmo receipt of the last seven days, read or unread. It
reports; the hourly sweep is the writer. Receipts before Monday 2026-08-31
8:05 AM ET fall outside every run of this routine and stay with Anthony's
hand reconciliation. No deadline depends on it, so the Nov 1 shift costs
nothing.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. After 2027-01-12 report NO ACTION and stop.

You are the Venmo Wide Sweep for the Survivor sub-pool: the second pass over payments that CLAUDE.md asks for, the aggregates and splits a strict amount filter misses. Hyphens only, no emojis.

1. Read the Payment sweeps subsection under Money in CLAUDE.md (the one headed match on AMOUNT first) before anything else. It is the whole method.

2. Gmail is read-only for this job. Run exactly this search, paged until no page token: from:venmo@venmo.com (subject:"paid you" OR subject:"paid your") newer_than:7d. Fetch every thread in full with get_thread; Venmo threads same-subject receipts from one sender, so a split can live in one thread. Never trust a search preview. Take the amount from the subject line, never from the memo. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. The hourly sweep labels what it has processed Pool-Survivor-Done; call list_labels once for its ID, and a message carries the label only if that ID is in its label_ids. If the label is missing say so in one line rather than treating every receipt as unprocessed. Every receipt in the window is read to classify it; that is the only reading it gets.

3. Amount first, always. A name alone is never a signal: the Tropea and Flaherty false positives came from matching on names.
3a. Tier amounts $30, $60, $90, $100 whose message does not carry the Pool-Survivor-Done label: one line each, the question being whether the hourly sweep has not reached it yet, missed it, or set it aside. A receipt received before 5:43 PM ET on 2026-09-04, the hourly sweep's first run, is expected to lack the label: report it only if it is an aggregate or split under 3b, never as missed.
3b. Non-tier amounts with a plausible pool reading. An aggregate: a sum of two or more tier prices, such as $200 for eight entries across two owner records, or $130 as $100 plus $30. A split: a non-tier amount under $100 that meets any one of three tests: its memo reads as an instalment (1 of 2, 2 of 2, half, part, deposit, balance); it is exactly half a tier price ($15, $45, $50); or it sums to a tier price with another receipt carrying the identical Venmo sender string, byte for byte, within the last 60 days. For the first two tests search that sender string from venmo@venmo.com over the last 60 days for the partner; apply 3d to the partner before anything else, cite it on the same line only if it passes 3d, and otherwise treat the receipt as a lone split and say the partner was not found. One line per receipt, marked possible aggregate or split, needs review.
3c. Non-tier amounts that meet none of those tests: drop silently.
3d. Scope, every amount, tier prices included. This job is the Survivor pool only. A receipt, inside the window or found by the 60-day partner search, whose memo or context shows it belongs to another pool or to anything else Anthony runs is out of scope whatever its amount: drop it silently and never quote its memo, sender or amount.

4. Each line carries: date, amount, the sender string exactly as Venmo shows it, memo verbatim (an emoji written as its name in square brackets, such as [football], the one exception to hyphens only), the Venmo transaction ID copied exactly as the receipt shows it (if none is shown write txn id not shown; never construct one and never substitute a Gmail message or thread id), the reading, and the question. Say once at the top of the section: check /admin/audit for a payment_sweep_exclude row naming the transaction before acting.

5. Never mark anything Paid. Never stage or write anything: the hourly sweep is the writer. Never resolve identity and never suggest one: the sender string stands alone in the line; do not pair it with an owner name from CLAUDE.md, the spec or memory, and do not say who it resembles. The question on the line is whether this is pool money, not who sent it; Anthony matches it to an owner in /admin/payments.

6. Report in 12 lines or fewer. Either a section headed NEEDS ANTHONY, one line per item with the exact question (payments have no tier deadline; omit the deadline clause), or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, keep every aggregate and split line and fold the remaining tier receipts into one closing line: <k> more tier receipts without the Done label: <sender strings, comma separated> - see Gmail. If the aggregate and split lines alone pass the cap, print them all; the cap yields to completeness.
```

Expected most Mondays: NO ACTION. Expected the Monday after a $200 or a pair
of $50s: one line per receipt with the transaction ID.

## 8. Not routines

These are clicks or ledger reads, by design, and no routine performs them.
The routines above say when each is due.

| Action                              | Where                             | Rule                                   |
| ----------------------------------- | --------------------------------- | -------------------------------------- |
| Commit the missed-pick sweep        | /admin/deadline                   | Never automatic without a click        |
| Enter or fetch scores               | /admin/scores                     | Fetch pre-fills, never auto-commit     |
| Import Lynne's sheet                | /admin/import or `npm run results` | Preview, then explicit commit; a sha256 seen before is refused |
| Forward the recap                   | /admin/recap                      | A draft is never a send                |
| Send pick requests                  | /admin/emails/picks               | Never sent on Anthony's behalf         |
| Chase entries with no pick          | `npm run chase`                   | Drafts; sends only under section 3e    |
| Post the week's picks after the lock | `npm run distribute`             | One BCC draft, never sent here         |
| Send roster additions and removals  | /admin/entries                    | Never sent on Anthony's behalf         |
| Chase unpaid owners                 | /admin/payments, /admin/emails    | Ledger only; Gmail cannot say who paid |
| Set Lynne numbers, chase names      | /admin/entries                    | Database only                          |
| Mark a payment                      | /admin/payments                   | Transaction ID or cash by Anthony      |
| Regenerate the Sheets backup        | /admin (Sheets export)            | Generated export, admin click          |
| Back up                             | /api/admin/backup                 | Admin login only                       |

Anthony sends her the roster by hand; the Friday roster-drift line first
fires 09-11. Picks arrive through `npm run picks`, the per-lock list goes
out through `npm run lynne`, the unpicked are chased with `npm run chase`,
her sheet comes back in through `npm run results`, and the week's picks go
out through `npm run distribute` (docs/PICKS_INTAKE.md). Each of those posts
one line to ntfy when `NTFY_TOPIC` is set, and prints it otherwise.

## 9. Housekeeping

9a. Change a prompt: edit it here first, then paste the fenced prompt whole into
    the Routine. This file and the Routine must match; if they drift, this
    file is right.
9b. After Nov 1: add one to the UTC hour of each cron if the ET times matter
    to you. The deadline side holds either way; the Deadline Close Check
    moves from 2:20 to 1:20 PM, still after noon.
9c. After 2027-01-12: disable all but Final Sheet Watch; disable that after
    its 2027-01-14 run.
9d. Creating them. Each one is made in the claude.ai Routines UI with the
    same repository, environment and connector settings as the Survivor Gmail
    Sweep (open that Routine and copy them), Gmail as the only connector,
    push notifications on, and the fenced prompt of the named section pasted
    whole. The UI takes the schedule in ET and stores it as the UTC cron shown
    in each section. Paste each trigger ID into the table once it exists.

| Routine                                   | Schedule (ET)                   | Prompt    | Trigger ID |
| ----------------------------------------- | ------------------------------- | --------- | ---------- |
| Survivor Pick Gap Check                   | Mon-Fri 9:05 AM                 | section 3 |            |
| Survivor Deadline Close Check             | Tue-Fri 2:20 PM                 | section 4 |            |
| Survivor Lynne Echo Check                 | Thu and Sat 3:05 PM             | section 5 |            |
| Survivor Lynne Echo Check (Thanksgiving)  | once, Thu 2026-11-26 11:05 AM   | section 5 |            |
| Survivor Final Sheet Watch                | Tue and Thu 5:05 PM             | section 6 |            |
| Survivor Venmo Wide Sweep                 | Mon 8:05 AM                     | section 7 |            |
| Survivor Ops Tick                         | hourly at :43, 5 AM to 10 PM    | section 10 | trig_01W9BrBAoWKBQm9AjJ9FVVKK (ENABLED) |

## 10. Ops Tick

Name: **Survivor Ops Tick**
Cron (America/New_York): `43 3-23 * * *` (every hour at :43, 3 AM to 11 PM ET)
Cron stored (UTC): `0,19,38,57 * * * *`
Trigger ID: `trig_01W9BrBAoWKBQm9AjJ9FVVKK` (created 2026-09-09 as the Week
Reminder, renamed and repointed the same day. **It is ENABLED**, verified
2026-09-10 against the live trigger list; an earlier draft of this file said
paused and was wrong. Its prompt runs `npm run ops -- tick`, and `tick` is
still accepted as the old name for `hourly`, so this Routine keeps working
across the rename and needs no edit. What it still needs is the environment
variables in section 11c - without them a fire signs in to nothing.

Why: set by Anthony on 2026-09-09. Operations moved into the repo. The
schedule and every parameter live in `scripts/ops/config.json`, one entry
point per job in `scripts/ops` (`npm run ops -- <job>`), and the Routine is
one line: run `npm run ops -- tick` and report what it printed. A tick runs
every job whose cron fell inside the last hour and nothing else; the jobs'
own once-only guards (audit rows per boundary and per recipient per lock
day, a sha256 per sheet, read marks and the Done label on mail) keep a
second tick in the same hour from acting twice.

The tick's own cron is checked in too, as `tickSchedule` in
`scripts/ops/config.json`, and the loader refuses a config where any job would
lose a run to it: either every slot a job names falls inside a tick's 60-minute
look-back, or the job is due at every tick anyway (the sweep, which names every
hour on purpose). **It started at 11:43 UTC and the pick-reminder's 10:00 slot
fell in the gap before the first tick of the day** - so in EDT, where a noon-ET
deadline is 16:00 UTC and six hours before it is exactly 10:00, the early
reminder would have gone at 11:43, four hours and seventeen minutes before the
deadline instead of six (issue #41). Starting at 09:43 UTC keeps the six-hour
rule in both EDT and EST. The two crons above and `tickSchedule` have to agree;
`tests/unit/ops.test.ts` holds the config to the schedule and names any slot
that would be lost.

The six jobs, their UTC crons and what each runs (the config is the source;
this table is a copy for reading):

| Job           | Cron (UTC)            | Runs                                  | Sends |
| ------------- | --------------------- | ------------------------------------- | ----- |
| sweep         | `43 * * * 0-4` ET, `43 0-7 * * 5` ET, `0,19,38,57 8-23 * * 5` ET, `0,19,38,57 0-1 * * 6` ET, `43 2-23 * * 6` ET | `npm run picks -- --yes`              | no    |
| pick-reminder | `0 12 * * 3,4,5`      | `npm run remind -- --send --yes`      | yes   |
| chase         | `5 13 * * 2-5`        | `npm run chase -- --send --yes`       | yes   |
| lynne-import  | `5 21 * * 2,4`        | `npm run lynne:roster -- --file <her newest Football xlsx, fetched> --message-id <id> --yes` | no |
| results       | `5 21 * * 2,4`        | `npm run results -- --yes --week <last locked week>` | no |
| distribute    | `20 18 * * 5`         | `npm run distribute -- --yes --week <last locked week>` | no |
| scores        | `0 3 * * 5` ET, `0 3 * * 6` ET, `0 17 * * 0` ET, `0 22 * * 0` ET, `0 3 * * 1` ET, `0 3 * * 2` ET | `npm run scores -- --yes` | no |

Three rules that used to be pasted into a Routine or a Gmail setting are code
now:

- The sweep reads every unread message from every owner address and every
  `player_email` on a live entry, whatever its subject or label, and also
  every unread message from anyone else whose subject carries one of the
  words in `sweepSubjectTerms` (`survivor`, `picks`) - the Gmail filter's
  rule. A stranger's mail is staged for Anthony as an identity question, never
  written as a pick.
- The week reminder goes THREE times a week, each on its own morning, from
  the weeks table (Anthony, 2026-09-10, replacing the two-boundary schedule):
  **Wednesday** naming the week's early boundary (the Thursday game's
  deadline), **Thursday** naming the late one (the weekend games' deadline,
  the Friday lock) and **Friday** the FINAL CALL, naming that same late one.
  Thursday and Friday name one boundary, so the once-only key is week + SLOT -
  `week:N:wed`, `week:N:thu`, `week:N:fri` - and never week + boundary, which
  would let one of the two swallow the other.
  **The cron and the schedule are one setting in two places.** Which slot a
  run belongs to is the ET calendar day of a stored boundary
  (`scripts/remind/lib/due.ts`, which knows no hour at all); the minute the
  mail goes is the cron's `0 12 * * 3,4,5`. A cron on a day that names no slot
  finds nothing due and says so quietly, which is the silent failure #41 was
  about, so `tests/unit/ops.test.ts` holds the cron's three days to the three
  slots. `reminderLeadHours` is no longer the trigger; it is the notice the two
  SAME-DAY slots owe - wed names that Wednesday's deadline, fri names that
  Friday's - and the same test holds the cron to at least that many hours
  before a 2 PM ET deadline in both EDT (18:00 UTC) and EST (19:00 UTC).
- Only `pick-reminder` and `chase` may send, and only through
  `scripts/lib/send.ts` with `REMINDER_AUTOSEND=true`; the loader refuses a
  config that marks any other job as sending or hands it `--send`. Every
  whole-roster message (reminder, distribute) derives its recipients live and
  stops unless the count equals `expectedRosterAddresses` (40) exactly.

Environment the tick needs to do anything but report: `ADMIN_EMAIL`,
`SURVIVOR_ADMIN_PASSWORD`, `GMAIL_OAUTH_CLIENT_ID`,
`GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_TOKEN_JSON`, and
`REMINDER_AUTOSEND=true` for the two sending jobs; optionally `NTFY_TOPIC`.
Without them a sending job is not started ("REMINDER_AUTOSEND is not true:
drafts only, nothing started") and the others fail at sign-in and say so - as
`failed`, counted with the nonzero exits, never as `skipped`: a due job that
never ran is not the tick working (issue #40). `npm run ops -- tick --dry-run`
reaches nothing at all and prints a placeholder for each derived argument, so
it runs without credentials.
Nothing in this repo holds or requests a secret. The Routine's session config
came back with **no repository source at all**, which stopped being a caution
on 2026-09-10 and became the incident in 10a.

Prompt, pasted whole into the Routine (already set by `update_trigger`):

```
From the repo root run `npm run ops -- tick` once and report its output as printed, nothing else. Never run it twice, never with other arguments, never send, draft, label or read mail yourself, and never touch the database except through that command. If the output holds a NEEDS ANTHONY line, head the report NEEDS ANTHONY and quote the line; if it says "nothing due" or every job reads ok, report NO ACTION.
```

Once the tick is enabled with its environment, the hourly **Survivor Gmail
Sweep** Routine (section 1c) covers the same mail read through the connector;
pausing it then is Anthony's call. The reporters in sections 3 to 7 stay as
they are: they read and never write.

## 10a. 2026-09-10: the tick fired with no checkout

**The Thursday 8 AM reminder did not go.** The Ops Tick fired on schedule at
12:43 UTC, the session started, and `npm run ops -- tick` failed with **"no git
repository"** - there was no clone to run it in. `week:1:thu` was sent by hand
instead (Gmail `1a08b8674c5d0995`, To Anthony, 40 on Bcc derived live and gated
at exactly 40), and its `week_reminder_claim` and `week_reminder_sent` rows -
`audit_log` 679 and 680, one transaction - **say in their notes that it was a
hand send and not `npm run remind`**, because an actor string that names a
command which did not run is the same lie as a migration that does not exist
(CLAUDE.md, Working rules). `week:1:fri` was deliberately left unclaimed, so
the Friday final call still goes.

**The cause is one empty field.** Read from the live trigger record for
`trig_01W9BrBAoWKBQm9AjJ9FVVKK`:

| Field                                   | Value                          |
| --------------------------------------- | ------------------------------ |
| `session_request.config.sources`        | `[]` - **empty. This is it.**  |
| `session_request.environment_variables` | `{}` - empty                   |
| `session_request.environment_id`        | `env_01E2ghUxXKj19qoDX3bTxf3p` |
| `mcp_connections`                       | `[]`                           |
| `created_via`                           | `meta_mcp`                     |

`created_via: meta_mcp` is the whole story. This Routine was made through the
API, and **the API stores no source**: the environment came across, the prompt
came across, the repository did not. That is 11a, written as a warning in
advance and now an incident.

**The control is in the same list.** `Survivor Gmail Sweep` is the one Survivor
Routine created outside that path (`created_via: http_api`), and it is the one
that carries a checkout:

    sources: [{ "git_repository": { "url": "https://github.com/anthonydellapia1117/Survivor" } }]
    mcp_connections: 2   (Gmail, Supabase)

Read the whole list rather than those two, because the shapes are not uniform:

| Routine                    | created_via | `config` block | `sources` | connectors |
| -------------------------- | ----------- | -------------- | --------- | ---------- |
| Survivor Gmail Sweep       | `http_api`  | yes            | **1**     | 2          |
| Survivor Ops Tick          | `meta_mcp`  | yes            | **0**     | **0**      |
| the six paused reporters   | `meta_mcp`  | **none**       | absent    | 1 each     |

So the Ops Tick is the only Survivor Routine with a `config` block whose
`sources` is **empty**, and the only one carrying **no connector at all**. The
six reporters are an older record shape with no `config` object whatsoever, so
they are not evidence about how the API stores a source; the pair worth
comparing is the top two rows.

**`sources` is not the only field that differs** between those two - so do not
read this as one field being magic. `allowed_tools`, `outcomes`,
`autofix_on_pr_create`, `mcp_connections` and the cron all differ too. What
makes `sources` the cause is what each field DOES: an empty `allowed_tools` or
a missing connector changes what a session may reach, and none of them can
produce "no git repository" - only the absent checkout can. The connector gap
is real and separate, and it matters for the older prompt-driven Routines
rather than for `npm run ops`, which reads Gmail through `GMAIL_OAUTH_*`.

**The environment is not the cause**, which rules out a broken image or a
container with no git. This session runs in the *same* `env_01E2ghUxXKj19qoDX3bTxf3p`
and has a working clone, because its own `session_context.sources` is
populated. Nor does the message come from here: **no code in this repo emits
it** - the only occurrences of that string anywhere are in this section, which
is prose about it - and the only child process `scripts/ops/cli.ts` spawns is
`npm` (line 137). The message is upstream of any code here.

**`last_run` reads SUCCEEDED.** The session started, ran and reported; the
command inside it failed. A Routine's run status says the session finished, it
never says the work happened - so nothing alerted, and the miss was found by
Anthony rather than by us. There is no check in this repo that would have
caught it, because a tick that cannot start cannot report.

**The one field to set, and it is UI-only:**

    claude.ai > Settings > Routines > Survivor Ops Tick > Edit
      > Source repo:  anthonydellapia1117/Survivor       branch  main
      > Save

It cannot be set from a session. `update_trigger` accepts `name`,
`cron_expression`, `enabled`, `model`, `prompt` and `run_once_at`; `create_trigger`
accepts an `environment_id` but no source either. There is **no MCP path to a
checkout at all**, which is why sessions get repos (`create_session` does take
`source_url`) and API-made Routines do not. Nothing was changed on the trigger
from this session.

**If the Edit form does not offer Source repo on this Routine** - 11a says an
API-made Routine cannot be repaired, only replaced - then create it fresh by
the 11b click path as **`Survivor Sweep`**, enable that, and **pause** the Ops
Tick rather than deleting it, so its run history survives (11d). Either way the
prompt is unchanged: `npm run ops -- hourly`, with `tick` still accepted.

After the repo is set the tick still needs 11c's environment variables, or it
reaches the Supabase sign-in and fails there. That failure is loud (`failed`,
counted with the nonzero exits, never `skipped` - issue #40), which the missing
checkout was not.

**Leave it enabled meanwhile.** A tick with no checkout does nothing and costs
nothing, and the moment the field is set it starts working on the next hour.
Its first run will find `week:1:thu` already claimed and skip it, which is what
the audit rows above are for. It has gone on firing hourly and failing the same
way - 13:43:06 UTC, session `cse_01NaxXkuU2e6fGoXghCrCJPh`, 30 seconds,
SUCCEEDED - which is what a Routine that cannot start looks like from outside.

**One thing to watch after the repo is set, unverified:** `npm run ops` needs
`tsx`, a devDependency, so a fresh checkout with no `node_modules` and no
install step would fail at the first command. Whether the environment snapshot
supplies them is not established here; the first real fire will say.

## 10b. 2026-09-10 15:12 UTC: the repo is attached, the credentials are not

**Anthony attached the repository.** The Ops Tick trigger record now reads:

| Field                                   | Then      | Now                                   |
| --------------------------------------- | --------- | ------------------------------------- |
| `session_request.config.sources`        | `[]`      | **the git_repository, populated**     |
| `mcp_connections`                       | `0`       | **3** (Gmail, Supabase, one more)     |
| `allowed_tools`                         | `[]`      | populated                             |
| `session_request.environment_variables` | `{}`      | **`{}` - still empty**                |

So the checkout is fixed and the credentials are not. **The environment carries
none of them either**, which is not inference: this session runs in the same
`env_01E2ghUxXKj19qoDX3bTxf3p`, its container started at 15:10 UTC - after the
repo was attached - and `env` in it shows no `SUPABASE`, `GMAIL`, `ADMIN`,
`REMINDER` or `NTFY` variable at all.

**Will tomorrow's 8 AM fire send? No. It will not draft either.** Run in that
same container, the two commands fail at the first gate each:

    $ npx tsx scripts/remind/cli.ts --week 1 --slot fri --send --yes
    REMINDER_AUTOSEND is not true: drafts only.            exit 1

    $ npx tsx scripts/remind/cli.ts --week 1 --slot fri --dry-run
    A hidden prompt needs a terminal. Set SURVIVOR_ADMIN_PASSWORD in the
    environment for a non-interactive run.                 exit 1

And upstream of both, `scripts/ops/cli.ts:128` never spawns it: a job the
config marks `sends` with autosend off returns `skipped`,
`"REMINDER_AUTOSEND is not true: drafts only, nothing started"`. So the
pick-reminder job produces **no message of any kind** - not a send, not a
draft, not a staged row. The tick will report `skipped` and exit 0, which
reads as the tick working.

**Three variables, and only three.** `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `ADMIN_EMAIL` already come from the
committed `.env.production`, so they are not the gap:

| Variable                                        | Without it                                    |
| ----------------------------------------------- | --------------------------------------------- |
| `REMINDER_AUTOSEND=true`                        | the sending jobs never start                  |
| `SURVIVOR_ADMIN_PASSWORD`                       | no command reaches the database at all        |
| `GMAIL_OAUTH_CLIENT_ID` / `_SECRET` / `_TOKEN_JSON` | no command reaches Gmail                  |

**Everything downstream of the credentials is sound**, exercised end to end on
this run against the live roster and stopped at the point of dispatch: the
slot resolves to `week:1:fri` (send date 2026-09-11, naming the late boundary
2026-09-11T18:00:00Z), the retired-address guard passes, the count gate reads
40 of 40 with delta 0, the subject begins `Survivor` and carries FINAL CALL,
the body names the date and the 59 outstanding, and `sendWeekReminder` clears
every gate and reaches the Gmail call - which was a stub that threw instead of
sending. `week:1:fri` has no `audit_log` row, so the slot is still open.

**The Gmail connector does not cover for the missing OAuth variables.**
`npm run ops` reaches Gmail through googleapis and `GMAIL_OAUTH_*`; there is no
MCP client in `scripts/`. The connector belongs to the agent, not to the
command - see `docs/PICKS_INTAKE.md` section 11c, and 11e for what the agent
did instead on the 10:46 fire.

## 10c. Making the Routine self-sufficient - a weekend job, not a tonight job

Set by Anthony on 2026-09-10. **Do not put the current Gmail token on the
environment tonight.** The token he authorized today was minted while the OAuth
consent screen is in **Testing**, and Google expires a Testing app's refresh
tokens after **seven days**. Pasting it into `GMAIL_OAUTH_TOKEN_JSON` buys one
week of sends and then fails - and it fails the way this project hates most:
`GMAIL_OAUTH_TOKEN_JSON` is still set, so the tick still starts, and only the
Gmail call dies. Publishing the consent screen is the real fix.

**Do these in this order. The order is the whole point.**

1. **Publish the consent screen.** Google Cloud Console > APIs & Services >
   OAuth consent screen > **Publishing status** > `PUBLISH APP` > confirm. It
   should then read **In production**. A personal gmail.com account can do
   this; consent will show an unverified-app warning, which is fine for one
   person granting access to his own mailbox.

   **`Internal` is not available and never will be here.** That publishing
   status requires a Google Workspace domain, and this is a gmail.com account.
   Publishing is the only path; there is no third option to look for.

2. **Re-run the consent, on the Mac, AFTER step 1.**

   ```
   npm run gmail:auth
   ```

   You should see `Token saved to ~/.config/survivor/gmail-token.json`.

   **This is why the order matters.** A refresh token carries the expiry of the
   publishing status it was MINTED under. Re-authorising first and publishing
   afterwards leaves you holding a seven-day token and no warning that you do.

3. **Copy that file's whole contents** - the entire JSON object, one line is
   fine.

4. **Set five variables on the environment**, claude.ai > Settings >
   Environments > `env_01E2ghUxXKj19qoDX3bTxf3p`. These are Anthony's and are
   never printed, pasted or invented here:

   | Variable                   | Value                                       |
   | -------------------------- | ------------------------------------------- |
   | `REMINDER_AUTOSEND`        | `true`                                      |
   | `SURVIVOR_ADMIN_PASSWORD`  | the /admin password                         |
   | `GMAIL_OAUTH_CLIENT_ID`    | from `.env.local`                           |
   | `GMAIL_OAUTH_CLIENT_SECRET`| from `.env.local`                           |
   | `GMAIL_OAUTH_TOKEN_JSON`   | the whole file from step 3                  |

   **If the container proxies outbound HTTPS**, `npm run scores` also needs
   Node to honour it. Node's global `fetch` does NOT read `HTTPS_PROXY` on its
   own: it goes direct, comes back **403**, and the message reads as though
   ESPN blocked us while `curl` to the same URL returns 200. The npm script
   sets `NODE_USE_ENV_PROXY=1`, Node's own switch, which is a no-op where no
   proxy is set - so run the command through `npm run scores` rather than
   `tsx scripts/scores/cli.ts`. Found on 2026-09-11 doing exactly that.

   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `ADMIN_EMAIL` come from the committed `.env.production` and are not needed
   here. `NTFY_TOPIC` is optional.

5. **Watch one fire.** On the next `:43` the tick's report should read
   `sweep: ok` rather than an `Admin sign-in failed` or a Gmail error. Until it
   does, the reminder still goes by hand.

**Until step 5 passes, the week reminder is hand-sent.** `week:1:thu` went that
way on 2026-09-10 (10a) and `week:1:fri` goes that way on the 11th, on
Anthony's instruction: he would rather send by hand twice than hold a token
that dies silently next week.

### 10c-done. What was actually done, 2026-09-10 (session oauth)

**Steps 1 to 3 above are complete and verified.** Recorded here so nobody
repeats them or trusts an older line in this file over them.

1. **Google would not publish until the Branding page had a homepage and a
   privacy policy URL.** The Publish button stays disabled with the tooltip
   "homepage url, and privacy policy url are required for switching the app
   to external production mode". Set on project `survivor-2026-sheets`:
   - Application home page `https://ad-26-survivor.vercel.app`
   - Application privacy policy link `https://ad-26-survivor.vercel.app/privacy`
     (`src/app/privacy/page.tsx`, PR #59 - public, unauthenticated, linked
     from no nav on purpose; every sentence in it is checked against what
     the pool stores, shows and sends, so a change to those is a change to
     that page)
   - Authorized domain `ad-26-survivor.vercel.app`
2. **Published: Publishing status reads In production.** The confirm dialog
   only noted that restricted scopes need verification; nothing was submitted
   and none is needed under the 100-user cap. Consent shows the
   unverified-app warning, which is expected.
3. **Re-authorised AFTER publishing.** The old Testing token was deleted
   first, then `npm run gmail:auth` minted a new one. **Proof it took: the new
   token has no `refresh_token_expires_in` field.** The Testing token carried
   `604799` (seven days). If a future token ever shows that field again, the
   app has fallen back to Testing - check the Audience page before anything
   else.

**Where the four Gmail and admin variables live:**

| Variable | Local Mac | Routine environment |
| --- | --- | --- |
| `GMAIL_OAUTH_CLIENT_ID` | `.env.local` (git-ignored) | DELLA, `env_01E2ghUxXKj19qoDX3bTxf3p` |
| `GMAIL_OAUTH_CLIENT_SECRET` | `.env.local` | DELLA |
| `GMAIL_OAUTH_TOKEN_JSON` | not set; `~/.config/survivor/gmail-token.json` is read instead | DELLA, the file's JSON on one line |
| `SURVIVOR_ADMIN_PASSWORD` | not set; the command prompts for it | DELLA |

Anthony pasted all four into DELLA himself on 2026-09-10. A session does not
write secrets into the environment and cannot open its editor reliably (the
settings gear in the Cloud environment menu does not respond to automated
clicks). `REMINDER_AUTOSEND` is deliberately NOT in that list: it waits until
after the Week 1 lock, and a separate trigger is armed for it.
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`ADMIN_EMAIL` need no environment entry: they come from the committed
`.env.production`.

**Cloud sessions install dependencies themselves (PR #60).** Every Ops Tick
fire before 2026-09-10 17:43 UTC exited 127 with `sh: 1: tsx: not found`: a
Routine container clones the repo with no `node_modules`, `tsx` is a
devDependency, and DELLA has no setup script. `.claude/settings.json` now runs
`npm ci --no-audit --no-fund` in a `SessionStart` hook, only when
`CLAUDE_CODE_REMOTE=true`, so a local checkout is never touched and a Routine
runs the lockfile's exact versions. Remove that hook and every tick goes back
to failing before any job starts. It adds roughly two minutes to a fire, which
is why the agent's first `npm run ops` call can outlast its 120-second
foreground timeout and finish in the background.

**First real fire, 2026-09-10 18:43 UTC:** `sweep: ok`, 0 picks written, and
the subject sweep read and filed a burst of unknown-sender mail whose subject
carried "Survivor" - including this repo's own GitHub notification mail -
staging it as identity rows. The sweep's guards after that are PR #66 and
later, not this section.

## 10d. The prompt, rewritten 2026-09-10

`audit_log` 681 was written by the Routine's **agent** through its Supabase
connector, not by `npm run ops` - the actor `ops-routine` names a routine that
did not write the row, which is `audit_log` 653's phantom migration one level
up (`docs/PICKS_INTAKE.md` section 11e has the three-way proof). The old prompt
already said never to touch the database except through the command, and it was
ignored, so it now says what it means and says why:

```
Run `npm run ops -- hourly` once from the repo root. Report its stdout exactly as printed, and nothing else.

THAT COMMAND IS THE ONLY THING THIS SESSION DOES. In this session you never:
- query, read or write Supabase or any database, by any means, including the Supabase connector;
- read, search, label, draft or send mail, by any means, including the Gmail connector;
- write an audit_log row, stage a pending_actions row, or supply an actor string yourself;
- run any other npm script, pass any other argument, or run the command twice.

If the command cannot run, or exits nonzero: report NEEDS ANTHONY on the first line, quote the exact failure verbatim, and STOP. Do not diagnose it, do not work around it, and above all do not do by hand what the command was going to do. A row you write yourself carries an actor naming a routine that did not write it - that is a false statement in the audit log, it happened on 2026-09-10 as audit_log 681, and it must not happen again. A failure reported honestly is the correct outcome; a task completed by going around the command is not.

If the output holds a NEEDS ANTHONY line, head your report NEEDS ANTHONY and quote that line. If it says nothing due, or every job reads ok, report NO ACTION.
```

Two notes on it. The argument moved from `tick` to **`hourly`**, its current
name; `tick` still runs and either would work. And the Routine carries a
**third connector, Vercel**, alongside Gmail and Supabase - the prompt's ban is
written as "by any means" rather than as a list of two, because the list is not
the point and connectors get added.

**A prompt is not a guard**, which is why the same change added one:
`tests/unit/audit-actor-names.test.ts` fails if any audit actor literal in this
repository names a routine, a schedule or an agent, and separately if anything
under `scripts/` hardcodes an actor at all rather than passing the one
`adminClient()` derived. It was broken four ways and watched to fail each time,
including two mutations that only broke its own scanners - the first version
passed one of those, because a canary asserting on the combined list stayed
green while the TypeScript half returned nothing.

## 11. The two Routines, and the clicks that make them

Set by Anthony on 2026-09-10. Sections 3 to 9 above describe seven triggers.
Six of them are the reporters that are now `scripts/ops/reporters`, and they
stay **paused**; the seventh is the Ops Tick, renamed. What should be enabled
is exactly two.

11a. **A Routine cannot be created from a session, and this is not a
     preference.** The repo source and the environment are UI-only fields on
     the Routine form; the API accepts a name, a cron and a prompt and stores
     no source and no connector grant. A Routine made that way fires a session
     with no repo to run `npm run ops` in and no Gmail to read, so it succeeds
     and does nothing - which is worse than failing. One was created that way
     on 2026-09-04 and had to be deleted (section 1a). **Do not create these
     from the API, and do not "fix" one that was.**

11b. The click path, once per Routine:

     1. claude.ai > Settings > Routines > **New Routine**.
     2. Name: `Survivor Sweep` (or `Survivor Daily`).
     3. Environment: `env_01E2ghUxXKj19qoDX3bTxf3p`.
     4. Source repo: `anthonydellapia1117/Survivor`, branch `main`.
     5. Connectors: **Gmail only**. Nothing else is granted.
     6. Schedule (UTC): `43 7-23,0-3 * * *` for the Sweep,
        `30 12 * * *` for the Daily.
     7. Prompt, one line and nothing else:
        - Sweep: `Run npm run ops -- hourly and report exactly what it printed.`
        - Daily: `Run npm run ops -- daily and report exactly what it printed.`
     8. Save, then **Enable**.

11c. The environment has to carry the variables the commands read, or a fire
     signs in to nothing: `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_EMAIL`,
     `SURVIVOR_ADMIN_PASSWORD`, `GMAIL_OAUTH_CLIENT_ID`,
     `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_TOKEN_JSON`, and optionally
     `NTFY_TOPIC`. `REMINDER_AUTOSEND=true` is the separate switch that lets
     the two sending jobs send; without it they draft, and `hourly` does not
     start them at all. **These are Anthony's to set and are never printed,
     pasted or invented here.**

11d. The six paused reporter triggers are left exactly as they are. They are
     not deleted: their run history is the record of what ran before the
     reporters moved into the repo, and a paused Routine costs nothing.

11e. **What is actually enabled today**, read from the live trigger list on
     2026-09-10 rather than from this file:

     | Routine                        | State    | Cron (UTC)            |
     | ------------------------------ | -------- | --------------------- |
     | Survivor Ops Tick              | ENABLED  | `43 7-23,0-3 * * *`   |
     | Survivor Gmail Sweep           | paused 2026-09-10 17:27 UTC, `enabled: false` on the live trigger | `43 11-23,0-2 * * *`  |
     | Survivor Pick Gap Check        | paused   | `5 13 * * 1-5`        |
     | Survivor Deadline Close Check  | paused   | `20 18 * * 2-5`       |
     | Survivor Lynne Echo Check      | paused   | `5 19 * * 4,6`        |
     | Survivor Final Sheet Watch     | paused   | `5 21 * * 2,4`        |
     | Survivor Venmo Wide Sweep      | paused   | `5 12 * * 1`          |
     | Survivor Lynne Echo (Thanksgiving) | enabled, one-shot | 2026-11-26T16:05:00Z |

     So the hourly half of the two-Routine plan is **already running** under
     the name "Survivor Ops Tick": its prompt is `npm run ops -- tick`, which
     the rename keeps working. The Daily is the one that does not exist yet.
     "Survivor Gmail Sweep" is the older prompt-driven sweep that section 1c
     describes; it sits beside the tick and is Anthony's to retire once the
     tick has run clean for a week.
