# Routines

TLDR: five scheduled jobs run this pool beyond the hourly Gmail sweep, plus
one Thanksgiving one-shot. All are read-only reporters. Each fires a fresh
session on this repo with the Gmail connector and nothing else, reads
CLAUDE.md first, and ends with either a NEEDS ANTHONY section or the two
words NO ACTION. None writes, sends, labels, marks Paid, resolves an
identity, or touches another pool.

Set by Anthony on 2026-09-04. CLAUDE.md is the rulebook; this file is the
schedule. If a prompt here and CLAUDE.md disagree, CLAUDE.md wins and the
prompt is a bug.

## 1. How they run

1a. Mechanism: Routines (scheduled triggers), the same thing as the existing
    "Survivor Gmail Sweep". Fresh session per fire, environment
    `env_01E2ghUxXKj19qoDX3bTxf3p`, source repo `anthonydellapia1117/Survivor`,
    connector grant: Gmail only.

1b. What a run can see: Gmail (full threads, never previews), this repo, and
    the real clock. There is no database connection, no admin login and no
    service-role key, by design. Every routine works from the mail record
    and the game rows in the repo, and says so when the app is the only
    place a fact can be settled. Gmail returns timestamps in UTC; every
    prompt converts to ET before comparing with a deadline.

1c. The hourly sweep these sit beside: "Survivor Gmail Sweep", every hour
    07-23 UTC. It reads unread mail under the label **Pool-Survivor** and
    unread Venmo receipts whose body carries exactly one tier amount, records
    picks, stages entries and payment candidates, marks what it handled read
    and labels it **Pool-Survivor-Done**. Those two labels are the only
    filing convention the routines rely on, and each prompt checks they exist
    before trusting a search.

1d. Output contract, every routine, every run: under 12 lines. Either a
    section headed **NEEDS ANTHONY**, one line per item with the exact
    question and, where one applies, the deadline it is tied to, or the
    words **NO ACTION** alone. No narration and no list of what was fine.
    When a list would pass the cap it collapses into one line that leads
    with the count and names every item; a name is never dropped to fit.

1e. Standing limits in every prompt: read CLAUDE.md first, never mark Paid,
    never resolve or suggest an identity, never send or draft anything,
    never write to Lynne, never report, quote or name anything that belongs
    to another pool.

1f. Clock. Routines store cron in UTC. Every cron below was registered at the
    EDT offset (UTC-4). From Sunday 2026-11-01 (EST) each fires one hour
    earlier on the ET clock. The deadline side is safe either way: no run
    lands on the wrong side of a noon deadline. The kickoff side is handled
    per routine and stated in each section. To put the ET times back after
    Nov 1, add one to the UTC hour of each cron.

1g. Season end. Four routines report NO ACTION after 2027-01-12; Final Sheet
    Watch after 2027-01-14, so a late Week 18 sheet is still read. Disable
    them then. Every routine also reports NO ACTION before 2026-09-07.

## 2. The week they follow

| ET                  | What happens                                                    | Routine              |
| ------------------- | --------------------------------------------------------------- | -------------------- |
| Mon 8:05 AM         | Second-pass Venmo read: aggregates and splits                   | Venmo Wide Sweep     |
| Mon 9:05 AM         | Requests out (Wednesday-game weeks), coverage vs last week      | Pick Gap Check       |
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

Days a tier does not close report NO ACTION. Every routine derives the week
and the tier from the game rows of
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
Cron as registered (UTC): `5 13 * * 1-5`
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

1. Work out the week and the tier from the repo, never from memory. Game days come from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file: take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day (NE at SEA is Wednesday 09-09 at 8:20 PM ET although kickoff_at reads 2026-09-10). That file's header comment, its weeks rows and its pick_deadline carry a Week 1 special case that supabase/migrations/20260903000041_tiered_pick_deadlines.sql removed; the tier rule is CLAUDE.md's pick deadline table, applied to every week including Week 1. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. The open week is the lowest week whose Friday noon has not passed; if none is open, NO ACTION and stop. Tuesday, Wednesday and Thursday each close a tier only if the open week has a game the next day: Tuesday closes Wednesday-game picks (Weeks 1 and 12), Wednesday closes Thursday-game picks (every week except 18), Thursday closes Friday-game picks (Weeks 12 and 16). Friday always closes every remaining pick, Saturday, Sunday and Monday games alike. Monday closes nothing. The week numbers in parentheses are what the rows hold today; if the rows disagree, the rows win. Call a tier by its game day: Wednesday-game, Thursday-game, Friday-game, or weekend.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET before comparing with any deadline, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. The requests. Search Sent for the open week's pick requests: in:sent from:anthonydellapia@gmail.com subject:("Week N pick" OR "Week N picks"), and keep a thread only if its subject starts with Week N pick or Week N picks followed by a dash, a recipient name and an entry count, checking the number exactly so Week 1 never picks up Weeks 10 to 18. Each is one recipient and names that recipient's entries. If none match, also search Sent bodies for "Week N picks" with "AD Survivor Pool" before concluding nothing was sent.
3a. No requests and a tier closes today: NEEDS ANTHONY - Week N pick requests not sent - <tier> picks close at noon today. No requests on Monday: one line only if the open week has a Wednesday game (Weeks 1 and 12): Week N pick requests not sent - Wednesday-game picks close Tuesday noon. Any other Monday with no requests is NO ACTION; the Tuesday to Friday runs ask.
3b. Requests exist, on Monday and on the first day this week a tier closes: compare the recipient addresses with the previous week's requests (Week 1: skip, there is no earlier week). Any address asked last week and not this week is one line: <address> - asked Week N-1, not Week N - dropped or done? If CLAUDE.md's roster snapshot names a gifted entry with no player address, one line: <entry> - gifted, no address on file per the CLAUDE.md snapshot - confirm on /admin/emails/picks; nobody is asked for it.
3c. Monday season notes, one line each and only on the day named: 2026-10-26 (Week 8: the app's local calculation switches to single elimination and SKIP_WEEK becomes submittable, per the rules engine and its config default of 7; CLAUDE.md is silent on both and Lynne decides eliminations - remind Anthony to confirm on /admin and to say so in his Week 8 request; this job writes nothing); 2026-11-23 (Week 12 has three early tiers: Tuesday, Wednesday and Thursday noon); 2026-12-21 (Week 16 Christmas Day games close Thursday noon); 2027-01-04 (Week 18 has no Thursday tier).
3d. Wednesday only, Week 2 onward: if Sent holds no message whose subject is Survivor, a dash, Week N-1 recap (the app writes that dash as an em dash) by now, one line: Week N-1 recap not found in Sent - forwarded?

4. Tuesday to Friday, when a tier closes today: for every request thread decide whether the recipient has replied with a team for every entry named in the request. Look at replies on the request thread, and at messages from that address under Pool-Survivor or Pool-Survivor-Done whose subject or first line names Week N or one of that recipient's entries; open nothing else from that address. An entry is picked when the reply assigns it a team, explicitly or by all or both; the same team on more than one of a recipient's entries is still a pick for each. A recipient whose reply covers only some entries is a partial. Map a team name to its abbreviation with the city-name vocabulary in src/lib/lynne/names.ts, case-insensitive; a name that matches nothing there is quoted in the line with a question, never guessed.
4a. Tuesday, Wednesday, Thursday: one line naming the teams whose picks close at noon today (away and home of every game whose day_of_week is tomorrow's day) and the count of recipients and entries with no reply yet: anyone taking one of those teams must be in by noon, the rest have until Friday. Then one line per partial: <name> - <k> of <n> entries picked - which team for the rest? Never list every silent recipient on these days; the count is the item.
4b. Friday: every entry with no pick at noon takes an automatic loss in the app's missed-pick sweep (the rules engine; CLAUDE.md is silent on it and Lynne decides elimination in her pool). Lead the section with the count of entries at stake, then one line per recipient with no reply or a partial: <name> - <k> of <n> entries picked. If that would pass the cap, give the count, the names in one comma-separated line, and say the rest are on /admin/week/N.
4c. If the section has any line, add once: confirm on /admin/week/N before chasing; Gmail is not the record, the app is.
4d. No tier closes today, it is not Monday, and nothing under step 3 produced a line: NO ACTION.

5. Never mark anything Paid. Never resolve who a sender is: a reply from an address that matches no request is one line with the address and the entry names it claims, and a question; never pair it with an owner name from memory. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

6. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, collapse a list into one line that leads with the count and names every item, comma separated; never drop a name to fit.
```

Expected on a quiet Wednesday: NO ACTION. Expected on Friday 09-11 with two
owners silent: a NEEDS ANTHONY section led by the number of entries at stake.

## 4. Deadline Close Check

Name: **Survivor Deadline Close Check**
Cron (America/New_York): `20 14 * * 2-5`
Cron as registered (UTC): `20 18 * * 2-5`
Trigger ID: see section 9d.

Why: three things become true when a tier closes and none announce
themselves. A pick that arrived after noon is late, recorded with a late flag,
and Anthony decides what to do with it. The picks for that tier are on their
way to Lynne, or are not. On Friday the whole week is locked, the missed-pick
sweep is a click, never automatic, and standings are silently wrong until it
runs. It fires at 2:20 PM (1:20 PM after Nov 1) so a send made over lunch is
found rather than nagged about; the next kickoff after any run is the
following day's, already covered by the previous run.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-12 report NO ACTION and stop.

You are the Deadline Close Check for the Survivor sub-pool. Hyphens only, no emojis.

1. Work out the week and the tier from the repo, never from memory. Game days come from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file: take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day. That file's header comment, its weeks rows and its pick_deadline carry a Week 1 special case that supabase/migrations/20260903000041_tiered_pick_deadlines.sql removed; the tier rule is CLAUDE.md's pick deadline table, applied to every week including Week 1. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. Week N is the lowest week whose Friday noon had not passed at 11:59 this morning; if none, NO ACTION and stop. A tier closed at noon today only if today is the day before one of week N's game days: Tuesday closed Wednesday-game picks (Weeks 1 and 12), Wednesday closed Thursday-game picks (every week except 18), Thursday closed Friday-game picks (Weeks 12 and 16), and Friday closed every remaining pick. If nothing closed today: NO ACTION and stop. The week numbers in parentheses are what the rows hold today; if the rows disagree, the rows win. Call a tier by its game day: Wednesday-game, Thursday-game, Friday-game, or weekend.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET before comparing with any deadline, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor and what it has processed under Pool-Survivor-Done; call list_labels once for their IDs, and if either is missing say so in one line rather than treating a search as empty.

3. Late picks. A pick is late when it arrived, in ET, after its own team's deadline: noon on the day before that team's game day. Look at replies on the Week N pick-request threads in Sent (subject Week N pick or Week N picks, the number checked exactly) and at messages under Pool-Survivor or Pool-Survivor-Done whose subject or first line names Week N, received since the week's first tier closed, not only since noon today; on Friday that includes every Week N pick received after Friday noon. Map team names with the city-name vocabulary in src/lib/lynne/names.ts, case-insensitive; a name that matches nothing there is quoted with a question, never guessed. The app records a pick entered after its deadline with a late flag; it does not refuse it, and this job decides nothing. One line each: <name> - <entry> - <team> - received <time> ET - after the <tier> deadline - accept, refuse or sweep is your call on /admin/week/N. A pick reported by an earlier run this week may be repeated if it is still the same question.

4. Picks to Lynne. CLAUDE.md does not fix when Anthony sends her each week's picks; her own cadence (Thursday-game picks echoed Wednesday or Thursday, the full week Friday or Saturday) is what makes this worth asking after each close. Report only what Sent shows: search Sent since Monday 00:00 ET for a message to Lynne carrying Week N picks, the NO./NAMES grid or an attachment named DellaPia_WeekN_Picks.csv. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv attachment, a NO./NAMES grid, or the roster he sent her on 2026-08-24 or 2026-09-03, or her own messages in those threads or under Pool-Survivor; if none of that exists, one line: Lynne not identifiable from the mail record - step 4 skipped. If no Week N send is found: one line - no Week N picks to Lynne in Sent this week - sent another way, sending later, or not needed for the <tier> tier? If the latest one predates today's noon and today is Wednesday or Friday: one line - Week N picks to Lynne last sent <time> ET - does it cover the <tier> tier?

5. Friday only. Week N locked at noon and the missed-pick sweep is a click, never automatic; standings are silently wrong until it runs. One line: Week N locked - run the sweep at /admin/deadline - Gmail shows <k> recipients with no reply: <names> (or: Gmail shows every recipient replied) - the sweep preview is the record. Then roster drift: if any message under Pool-Survivor-Done received since the latest roster mail to Lynne in Sent asks for a new entry, one line: <k> new-entry mails since her roster of <date> - roster drift is on /admin/entries - send before Week N+1's first tier.

6. Never mark anything Paid. Never resolve who a sender is: an unmatched address is one line with the address and the entry names it claims, and a question; never pair it with an owner name from memory. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

7. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, collapse a list into one line that leads with the count and names every item, comma separated; never drop a name to fit.
```

Expected on a Tuesday with no Wednesday game: NO ACTION. Expected every
Friday: at least the one sweep line.

## 5. Lynne Echo Check

Name: **Survivor Lynne Echo Check**
Cron (America/New_York): `5 15 * * 4,6`
Cron as registered (UTC): `5 19 * * 4,6`
Trigger ID: see section 9d.

One-shot, same prompt: **Survivor Lynne Echo Check (Thanksgiving)**, fires
once at Thu 2026-11-26 11:05 AM ET (`2026-11-26T16:05:00Z`), before the
1:00 PM kickoff. Trigger ID: see section 9d.

Why: what Anthony sent and what Lynne recorded are two documents, and the
week she transcribes one wrong is the week an entry loses on a team it never
picked. Thursday compares every early-tier row (Wednesday, Thursday and
Friday games, all closed by Thursday noon) at 3:05 PM, five hours before an
8:15 PM Thursday kickoff; Saturday compares the full week the evening before
the Sunday slate, and in Week 15 under three hours before the 5:00 PM
Saturday game. Thanksgiving's 1:00 PM game needs the 11:05 AM one-shot. The
two Wednesday games (Weeks 1 and 12) are checked Thursday, after they were
played; fire the routine by hand on Wednesday afternoon if a pre-kickoff read
of those two matters. Variances carry both values and are never resolved.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-12 report NO ACTION and stop.

You are the Lynne Echo Check for the Survivor sub-pool. Hyphens only, no emojis.

1. The week, from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql and nothing else in that file. Take each game's day from its day_of_week column, never from the date in kickoff_at, which is UTC and stamps every evening game on the next calendar day (a Thursday 8:15 PM ET game reads as Friday 00:15Z or 01:15Z); ignore that file's header comment and deadline rows, which predate the current tiers in CLAUDE.md. On Thursday it is the week that has a game whose day_of_week is Thursday and whose kickoff, converted to ET, falls on today's date, whether or not it has kicked off; if no week does (Week 18 is the only such Thursday), NO ACTION and stop. On Saturday it is the week whose Sunday games are tomorrow in ET. On any other day this job does not run: NO ACTION and stop. Thursday covers every early-tier row of week N: entries whose team plays Wednesday, Thursday or Friday of that week, every tier that had closed by Thursday noon. Saturday covers the full week.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor; call list_labels once for its ID, and if it is missing say so in one line rather than treating a search as empty.

3. Her echo. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv attachment, a NO./NAMES grid, or the roster he sent her on 2026-08-24 or 2026-09-03, or her own messages in those threads or under Pool-Survivor; if none of that exists, one line: Lynne not identifiable from the mail record - nothing to compare, and stop. Find her Week N message: on Thursday her early-tier picks list, sent Tuesday to Thursday, usually in the shape Dallas-#1110-Name and #1158-Name; on Saturday her full-week picks, sent Friday or Saturday, usually with a spreadsheet. If her message takes another shape, still compare and say in one line what shape it took. Read the attachment if the tool exposes it; if it does not, say so in one line and compare the body only.

4. His submission. Take every Week N submission to her in Sent, the NO./NAMES grid or DellaPia_WeekN_Picks.csv, and merge them: where the same entry appears more than once, the latest message wins for that entry. On Thursday keep only the merged rows whose team plays Wednesday, Thursday or Friday.

5. Compare. Ours are the numbers and names Anthony has sent her this season, from his submissions and roster mails in Sent. Compare only rows whose number or name is in that set: match by her number first, then exact name, then case-insensitive name. Never fuzzy. A row on her list matching none of ours by number or name is not ours and is never reported. Teams compare as text the same way; his CSV already uses her team names and the literal BYE, so a difference in team text is a variance to report, not to reconcile. One line per difference, both values shown: she lists a different team; she does not list an entry he sent (per CLAUDE.md a missing entry is not a data error and may be one she already eliminated, so the line asks whether it is out); she lists one of ours he did not send; one of our numbers carries a name that is not ours, or one of our names a number that is not ours. Per CLAUDE.md never assume which side is wrong and never resolve it. The deadline each line is tied to is the first kickoff, in ET, of the games in scope for this run.

6. Her echo has not arrived: one line - no Week N <early-tier or full-week> echo from Lynne as of <time> ET - nothing to compare; on the Saturday of Week 15 add: Saturday games kick off 5:00 PM and 8:20 PM ET. His submission is not in Sent: one line - Week N submission to Lynne not found in Sent.

7. Never mark anything Paid. Never resolve identity. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

8. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If there are more than eight differences, list the first eight and one closing line: <k> more differences - her Week N list does not line up with his submission; compare on /admin/import.
```

Expected when her list matches his: NO ACTION. Expected on a transcription
slip: one line naming the entry, her team, and his team.

## 6. Final Sheet Watch

Name: **Survivor Final Sheet Watch**
Cron (America/New_York): `5 17 * * 2,4`
Cron as registered (UTC): `5 21 * * 2,4`
Trigger ID: see section 9d.

Why: her Final Sheet is the authority on who is out. It arrives Monday or
Tuesday, corrections follow as separate mails, and three admin clicks hang
off it: import, scores, recap. Tuesday reads the sheet and hands Anthony the
list, with the duplicate-team eliminations named because those are the ones
people do not believe. Thursday catches a sheet that landed late and any
correction since. If the tool does not expose the spreadsheet, the run
reports arrival and whatever her text says, and says so.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. Before 2026-09-07 or after 2027-01-14 report NO ACTION and stop.

You are the Final Sheet Watch for the Survivor sub-pool. Hyphens only, no emojis.

1. Week N is the one that just finished: the highest week whose every kickoff is earlier than now, from the nfl_games rows of supabase/migrations/20260822000014_nfl_schedule.sql. kickoff_at in that file is UTC (a Monday night game is stamped early Tuesday UTC; Week 18 has no Monday game); convert to ET before comparing. Ignore that file's header comment and deadline rows, which predate the current tiers in CLAUDE.md. If no week has finished, NO ACTION and stop.
1a. On Thursday this run covers only what arrived since Tuesday 5:05 PM ET: her sheet if it was not in by then, and any message from her since. If nothing from her arrived in that window, NO ACTION and stop. On any day other than Tuesday or Thursday this job does not run: NO ACTION and stop.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread; never trust a search preview. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. Message timestamps come back in UTC: convert to ET, and report times in ET. The hourly sweep files inbound pool mail under the label Pool-Survivor; call list_labels once for its ID, and if it is missing say so in one line rather than treating a search as empty.

3. Identify Lynne only from the mail record, never by guessing: the To address of Anthony's own Sent messages that carry a DellaPia_Week*_Picks.csv attachment, a NO./NAMES grid, or the roster he sent her on 2026-08-24 or 2026-09-03, or her own messages in those threads or under Pool-Survivor; if none of that exists, one line: Lynne not identifiable from the mail record - nothing to read, and stop. Find her Week N Final Sheet, sent Monday or Tuesday, and every message from her after it this week: corrections arrive as follow-ups and each must be re-read. Read the attachment if the tool exposes it; say in one line if it does not. If her Week N-1 sheet arrived after last week's runs and was never reported, report it under the same lines with N-1 in place of N.

4. Ours are the roster as he last sent it to her: every entry named in his roster mails and submissions in Sent (names from the roster lists, numbers and names from the NO./NAMES grids and DellaPia_Week*_Picks.csv files), less every entry he asked her to delete, the latest instruction winning. A name he told her to remove is not ours, whatever it was called before. An entry with a name but no number yet is still ours. Match her rows to ours by her number first, then exact name, then case-insensitive name; never fuzzy; a row matching none is not ours and is never listed. From her sheet, for ours only:
4a. Her pool-wide counts if she gives them, quoted exactly as she writes them (in the body, or the NO LOSSES / 1 LOSS/BYE / OUT rows under the grid if the attachment is readable); if neither is readable, one line: her counts not in the mail text.
4b. Ours she marks Out. On her sheet Out is the red fill on the NAMES cell, or the literal OUT in a week column, or the row being gone since her last sheet. A text read of the attachment loses fill: when that is all you have, count Out from literal OUT cells, rows gone and her own words, and say once: fill colours not readable here - Out count is a floor, confirm on /admin/import. Give the team and, if she gives one, her reason. A duplicate team is an elimination in her pool, never a warning: name any, with the two weeks if she cites them; otherwise say she did not.
4c. Ours on her previous sheet and absent from this one. Her sheet shrinks by design and a missing entry is not an error; list them so Anthony can confirm each is an elimination he already knows about. Week 1: there is no earlier sheet; instead list any of ours her Week 1 sheet does not carry.
4d. Anything in her mail that changes a number, a standing or a deadline.

5. NEEDS ANTHONY lines:
- Week N Final Sheet in at <time> ET - <k> of ours Out: <names> - back up, import at /admin/import, review variances, enter scores at /admin/scores, recap at /admin/recap.
- one line per item from 4b, 4c and 4d, showing her value and what his submission in Sent says. This run cannot see the app; where only the app can settle it, say so in the line instead of supplying a value.
- correction received <time> ET after the sheet: <what changed> - re-check the import.
- Tuesday, no sheet by now: no Week N Final Sheet from Lynne as of <time> ET.

6. Never mark anything Paid. Never resolve identity: one of ours whose number appears under a name that is not ours, or one of ours her sheet does not carry, is a line with both values, not a decision; her other entries are never listed. Never auto-resolve a variance. This job is the Survivor pool only. Search only where this prompt says. The moment a thread shows it belongs to another pool or to anything else Anthony runs, stop reading it and never report, quote or name it.

7. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If one line per item would pass 12, collapse 4b into one line that leads with the count and names every entry, comma separated, and 4c the same way; the cap yields to completeness, never the other way round.
```

Expected on a normal Tuesday: one line with the sheet's arrival time and the
count of ours out, plus one line per elimination. Expected on a Thursday with
no sheet or correction since Tuesday: NO ACTION.

## 7. Venmo Wide Sweep

Name: **Survivor Venmo Wide Sweep**
Cron (America/New_York): `5 8 * * 1`
Cron as registered (UTC): `5 12 * * 1`
Trigger ID: see section 9d.

Why: the hourly sweep touches unread receipts whose body carries exactly one
tier amount. CLAUDE.md says that filter is the first pass, not the only one:
Nicholas Teti's $200 covered eight entries across two owners, and Charles
Raudenbush's $100 came as two $50 deposits. This is the second pass, once a
week, over every Venmo receipt of the last seven days, read or unread. It
reports; the hourly sweep is the writer. Receipts before 2026-08-31 were
second-passed by hand. No deadline depends on it, so the Nov 1 shift costs
nothing.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. After 2027-01-12 report NO ACTION and stop.

You are the Venmo Wide Sweep for the Survivor sub-pool: the second pass over payments that CLAUDE.md asks for, the aggregates and splits a strict amount filter misses. Hyphens only, no emojis.

1. Read the Payment sweeps subsection under Money in CLAUDE.md (the one headed match on AMOUNT first) before anything else. It is the whole method.

2. Gmail is read-only for this job. Run exactly this search, paged until no page token: from:venmo@venmo.com (subject:"paid you" OR subject:"paid your") newer_than:7d. Fetch every thread in full with get_thread; Venmo threads same-subject receipts from one sender, so a split can live in one thread. Never trust a search preview. Take the amount from the subject line, never from the memo. Never reply, draft, send, forward, label, unlabel, archive, trash, mark spam, mark read, or change anything in the mailbox. Never write to Lynne or to any sender. The hourly sweep labels what it has processed Pool-Survivor-Done; call list_labels once for its ID, and a message carries the label only if that ID is in its label_ids. If the label is missing say so in one line rather than treating every receipt as unprocessed. Every receipt in the window is read to classify it; that is the only reading it gets.

3. Amount first, always. A name alone is never a signal: the Tropea and Flaherty false positives came from matching on names.
3a. Tier amounts $30, $60, $90, $100 whose message does not carry the Pool-Survivor-Done label: one line each, the question being whether the hourly sweep has not reached it yet, missed it, or set it aside. A receipt dated before the hourly sweep's first run on 2026-09-04 is expected to lack the label: report it only if it is an aggregate or split under 3b, never as missed.
3b. Non-tier amounts with a plausible pool reading. An aggregate: a sum of tier prices, such as $200 for eight entries across two owner records, or $130 as $100 plus $30. A split: a fraction of a tier price, whether or not its partner is in the window, such as $50 memoed 1 of 2; when one is found, search the identical Venmo sender string from venmo@venmo.com over the last 60 days for the partner and cite both. One line per receipt, marked possible aggregate or split, needs review.
3c. Non-tier amounts that are neither a sum of tier prices nor a fraction of one: drop silently.
3d. Scope, every amount, tier prices included. This job is the Survivor pool only. A receipt whose memo or context shows it belongs to another pool or to anything else Anthony runs is out of scope whatever its amount: drop it silently and never quote its memo, sender or amount.

4. Each line carries: date, amount, the sender string exactly as Venmo shows it, memo verbatim, the Venmo transaction ID copied exactly as the receipt shows it (if none is shown write txn id not shown; never construct one and never substitute a Gmail message or thread id), the reading, and the question. Say once at the top of the section: check /admin/audit for a payment_sweep_exclude row naming the transaction before acting.

5. Never mark anything Paid. Never stage or write anything: the hourly sweep is the writer. Never resolve identity and never suggest one: the sender string stands alone in the line; do not pair it with an owner name from CLAUDE.md, the spec or memory, and do not say who it resembles. The question on the line is whether this is pool money, not who sent it; Anthony matches it to an owner in /admin/payments.

6. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question (payments have no tier deadline; omit the deadline clause), or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine. If the lines would pass 12, keep every aggregate and split and close with one line: <k> more tier receipts without the Done label - see Gmail.
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
| Import Lynne's sheet                | /admin/import                     | Preview, then explicit commit          |
| Forward the recap                   | /admin/recap                      | A draft is never a send                |
| Send pick requests                  | /admin/emails/picks               | Never sent on Anthony's behalf         |
| Send roster additions and removals  | /admin/entries                    | Never sent on Anthony's behalf         |
| Chase unpaid owners                 | /admin/payments, /admin/emails    | Ledger only; Gmail cannot say who paid |
| Set Lynne numbers, chase names      | /admin/entries                    | Database only                          |
| Mark a payment                      | /admin/payments                   | Transaction ID or cash by Anthony      |
| Regenerate the Sheets backup        | /admin (Sheets export)            | Generated export, admin click          |
| Back up                             | /api/admin/backup                 | Admin login only                       |

## 9. Housekeeping

9a. Change a prompt: edit it here first, then paste the fenced prompt whole into
    the Routine. This file and the Routine must match; if they drift, this
    file is right.
9b. After Nov 1: add one to the UTC hour of each cron if the ET times matter
    to you. The deadline side holds either way; the Deadline Close Check
    moves from 2:20 to 1:20 PM, still after noon.
9c. After 2027-01-12: disable all but Final Sheet Watch; disable that after
    its 2027-01-14 run.
9d. Trigger IDs, filled at creation:

| Routine                                   | Trigger ID |
| ----------------------------------------- | ---------- |
| Survivor Pick Gap Check                   | pending    |
| Survivor Deadline Close Check             | pending    |
| Survivor Lynne Echo Check                 | pending    |
| Survivor Lynne Echo Check (Thanksgiving)  | pending    |
| Survivor Final Sheet Watch                | pending    |
| Survivor Venmo Wide Sweep                 | pending    |
