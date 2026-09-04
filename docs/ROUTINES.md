# Routines

TLDR: five scheduled jobs run this pool beyond the hourly Gmail sweep. All five
are read-only reporters. Each fires a fresh session on this repo with the Gmail
connector and nothing else, reads CLAUDE.md first, and ends with either a
NEEDS ANTHONY section or the two words NO ACTION. None of them writes, sends,
labels, marks Paid, resolves an identity, or touches another pool.

Set by Anthony on 2026-09-04. CLAUDE.md is the rulebook; this file is the
schedule. If a prompt here and CLAUDE.md disagree, CLAUDE.md wins and the
prompt is a bug.

## 1. How they run

1a. Mechanism: Routines (scheduled triggers), the same thing as the existing
    "Survivor Gmail Sweep". Fresh session per fire, environment
    `env_01E2ghUxXKj19qoDX3bTxf3p`, source repo `anthonydellapia1117/Survivor`,
    connector grant: Gmail only.

1b. What a run can see: Gmail (full threads, never previews), this repo, and
    the real clock. There is no database connection and no service-role key,
    by design. So every routine works from the mail record and the schedule
    in the repo, and says so when the app is the only place a fact can be
    confirmed.

1c. Output contract, every routine, every run: under 12 lines. Either a
    section headed **NEEDS ANTHONY**, one line per item with the exact question
    and the deadline it is tied to, or the words **NO ACTION** alone. No
    narration and no list of what was fine.

1d. Standing limits in every prompt: read CLAUDE.md first, never mark Paid,
    never resolve identity, never send or draft anything, never write to
    Lynne, never read or name anything that belongs to another pool.

1e. Clock. Routines store cron in UTC. Every cron below was registered at the
    EDT offset (UTC-4). From Sunday 2026-11-01 (EST) each fires one hour
    earlier on the ET clock. Every time was chosen with that margin so nothing
    lands on the wrong side of a noon deadline either way, and step 0 of every
    prompt reads the real clock, so what a run does is unaffected. To put the
    ET times back after Nov 1, add one to the UTC hour of each cron.

1f. Season end. After 2027-01-12 every routine reports NO ACTION. Disable all
    five then (Week 18 Final Sheet is due Tue 2027-01-12).

## 2. The week they follow

| ET                   | What happens                                             | Routine             |
| -------------------- | -------------------------------------------------------- | ------------------- |
| Mon 8:05 AM          | Second-pass Venmo read: aggregates and splits            | Venmo Wide Sweep    |
| Mon 9:05 AM          | Were this week's pick requests sent, to everyone         | Pick Gap Check      |
| Tue 9:05 AM          | Wednesday-game picks close at noon (Weeks 1, 12 only)    | Pick Gap Check      |
| Tue 1:20 PM          | Wednesday tier closed: late picks, picks to Lynne        | Deadline Close Check|
| Tue 5:05 PM          | Lynne's Final Sheet for last week: in, read, summarised  | Final Sheet Watch   |
| Wed 9:05 AM          | Thursday-game picks close at noon (every week but 18)    | Pick Gap Check      |
| Wed 1:20 PM          | Thursday tier closed: late picks, picks to Lynne         | Deadline Close Check|
| Thu 9:05 AM          | Friday-game picks close at noon (Weeks 12, 16 only)      | Pick Gap Check      |
| Thu 1:20 PM          | Friday tier closed: late picks, picks to Lynne           | Deadline Close Check|
| Thu 3:05 PM          | Her Thursday-game echo vs what Anthony sent              | Lynne Echo Check    |
| Fri 9:05 AM          | Everything else closes at noon: automatic loss           | Pick Gap Check      |
| Fri 1:20 PM          | Week locked: late picks, sweep is due, roster to Lynne   | Deadline Close Check|
| Sat 3:05 PM          | Her full-week echo vs what Anthony sent                  | Lynne Echo Check    |

Days a tier does not close report NO ACTION. Every routine derives the week
and the tier from `supabase/migrations/20260822000014_nfl_schedule.sql` and
the deadline table in CLAUDE.md, never from a hard-coded calendar.

Calendar facts the prompts rely on: Week 1 has a Wednesday game (NE at SEA,
Wed 09-09, closes Tue 09-08 noon). Week 12 has Wednesday, Thursday and Friday
games (Tue, Wed, Thu noon). Week 15 has Saturday games (Friday noon, same as
Sunday). Week 16 has a Thursday game and three Christmas Day games (Wed and
Thu noon). Week 18 has no Thursday game. Week 8 is the elimination-rule change
and the first SKIP_WEEK week under the locked rules.

## 3. Pick Gap Check

Name: **Survivor Pick Gap Check**
Cron (America/New_York): `5 9 * * 1-5`
Cron as registered (UTC): `5 13 * * 1-5`
Trigger ID: see section 9d.

Why: a missing pick is an automatic loss at the deadline, no grace period.
The hourly sweep records what arrives; nobody reports what has not. Monday
asks whether the requests went out at all and whether anyone dropped off the
list. Tuesday to Friday asks who has not replied before the tier that closes
at noon that day.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. If the date is after 2027-01-12 the season is over: report NO ACTION and stop.

You are the Pick Gap Check for the Survivor sub-pool. Hyphens only, no emojis.

1. Work out the week and the tier from the repo, never from memory. Game days are in supabase/migrations/20260822000014_nfl_schedule.sql. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. The open week is the lowest week whose Friday noon has not passed; if none is open, NO ACTION and stop. A tier closes at noon today only if the open week has a game tomorrow: Tuesday closes Wednesday-game picks (Weeks 1 and 12 only), Wednesday closes Thursday-game picks (every week except 18), Thursday closes Friday-game picks (Weeks 12 and 16 only), Friday closes everything else. Monday closes nothing.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread. Never trust a search preview. Never mark read, label, draft, send or forward. Never write to Lynne.

3. Find the open week's pick requests in Sent: from anthonydellapia@gmail.com, subject beginning "Week N pick" where N is the open week. Each is one recipient and names that recipient's entries.
3a. None exist, any day: NEEDS ANTHONY - Week N pick requests not sent - first tier closes <day> noon.
3b. Monday and they exist: compare the recipient addresses with the previous week's requests. Any address asked last week and not this week is one line: <address> - asked Week N-1, not Week N - dropped or done? Also list any gifted entry CLAUDE.md records with no player address: nobody is being asked for it.
3c. Monday only, season notes, one line each and only on the day named: 2026-10-26 (Week 8 starts single elimination and is the first SKIP_WEEK week under the locked rules - say so in the request); 2026-11-23 (Week 12 has three early tiers, Tuesday, Wednesday and Thursday noon); 2026-12-21 (Week 16 Christmas Day games close Thursday noon); 2027-01-04 (Week 18 has no Thursday tier).

4. Tuesday to Friday, when a tier closes today: for every request thread decide whether the recipient has replied with one team per entry named in the request. Look in the thread and in labels Pool-Survivor and Pool-Survivor-Done for anything from that address since the request went out. Count entries, not people: a two-entry recipient who named one team is a partial.
4a. Tuesday, Wednesday, Thursday: name the teams whose picks close today once at the top of the section, then one line per recipient with no reply or a partial: <name> - <k> of <n> entries picked.
4b. Friday: same, but every missing entry is an automatic loss at noon per CLAUDE.md, so lead the section with the count of entries at stake.
4c. Gmail is not the record, the app is. Say once: confirm on /admin/week/N before chasing.
4d. No tier closes today and it is not Monday: NO ACTION.

5. Never mark anything Paid. Never resolve who a sender is: a reply from an address that matches no request is one line with the address and the entry names it claims, and a question. This job is the Survivor pool only. Anything in the inbox that belongs to another pool or to anything else Anthony runs is out of scope: do not read it, report it or name it.

6. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine.
```

Expected on a quiet Wednesday: NO ACTION. Expected on Friday 09-11 with two
owners silent: a NEEDS ANTHONY section led by the number of entries at stake.

## 4. Deadline Close Check

Name: **Survivor Deadline Close Check**
Cron (America/New_York): `20 13 * * 2-5`
Cron as registered (UTC): `20 17 * * 2-5`
Trigger ID: see section 9d.

Why: three things become true the moment a tier closes and none of them
announce themselves. A pick that arrived after noon must have been refused.
The picks for that tier are due to Lynne. On Friday the whole week is locked
and the missed-pick sweep is a click, never automatic, and standings are
silently wrong until it runs.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. If the date is after 2027-01-12 the season is over: report NO ACTION and stop.

You are the Deadline Close Check for the Survivor sub-pool. Hyphens only, no emojis.

1. Work out the week and the tier from the repo, never from memory. Game days are in supabase/migrations/20260822000014_nfl_schedule.sql. Per CLAUDE.md a pick closes at noon ET the day before its game day, and Saturday, Sunday and Monday close together at Friday noon. The week N is the lowest week whose Friday noon had not passed at 11:59 this morning; if none, NO ACTION and stop. A tier closed at noon today only if week N has a game tomorrow: Tuesday closed Wednesday-game picks (Weeks 1 and 12 only), Wednesday closed Thursday-game picks (every week except 18), Thursday closed Friday-game picks (Weeks 12 and 16 only), Friday closed everything else. If nothing closed today: NO ACTION and stop.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread. Never trust a search preview. Never mark read, label, draft, send or forward. Never write to Lynne.

3. Late picks. In labels Pool-Survivor and Pool-Survivor-Done, and in replies on the Week N pick-request threads in Sent (subject beginning "Week N pick"), find any Week N pick received after noon today that names a team whose pick closed at noon today. On Friday that is any team. Per CLAUDE.md a pick is never accepted after its deadline, enforced by server timestamp. One line each: <name> - <entry> - <team> - received <time> - after the <tier> deadline - confirm it was refused on /admin/week/N.

4. Picks to Lynne. She echoes Thursday-game picks on Wednesday or Thursday and the full week on Friday or Saturday, so Anthony sends her each tier's picks after it closes. Search Sent since noon today for a message to Lynne carrying Week N picks: the NO./NAMES block or an attachment named DellaPia_WeekN_Picks.csv. Identify Lynne's address only from her own earlier messages under Pool-Survivor. Never guess it. If nothing is in Sent by now, one line: Week N <tier> picks to Lynne not found in Sent - sent another way, or still to do?

5. Friday only. Week N locked at noon and the missed-pick sweep is a click, never automatic. One line: Week N locked - run the sweep at /admin/deadline - Gmail shows <k> recipients with no reply: <names> (or: Gmail shows every recipient replied). Gmail is not the record, the app is; the sweep preview is.

6. Never mark anything Paid. Never resolve who a sender is: an unmatched address is one line with the address and the entry names it claims, and a question. This job is the Survivor pool only. Anything in the inbox that belongs to another pool or to anything else Anthony runs is out of scope: do not read it, report it or name it.

7. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine.
```

Expected on a Tuesday with no Wednesday game: NO ACTION. Expected every
Friday: at least the one sweep line.

## 5. Lynne Echo Check

Name: **Survivor Lynne Echo Check**
Cron (America/New_York): `5 15 * * 4,6`
Cron as registered (UTC): `5 19 * * 4,6`
Trigger ID: see section 9d.

Why: what Anthony sent and what Lynne recorded are two documents, and the
week she transcribes one wrong is the week an entry loses on a team it never
picked. Her echo lands before kickoff. Thursday 3:05 PM leaves five hours
before the Thursday game; Saturday 3:05 PM leaves the evening before the
Sunday slate. Variances are reported with both values and never resolved.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. If the date is after 2027-01-12 the season is over: report NO ACTION and stop.

You are the Lynne Echo Check for the Survivor sub-pool. Hyphens only, no emojis.

1. The week, from supabase/migrations/20260822000014_nfl_schedule.sql (kickoff_at is UTC; convert to ET): on Thursday it is the week with a Thursday game tonight; on Saturday it is the week whose Sunday games are tomorrow. If it is Thursday and no week has a Thursday game tonight (Week 18), or no week matches, report NO ACTION and stop. On Thursday this run is about the Thursday-game picks only; on Saturday it is about the full week.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread. Never trust a search preview. Never mark read, label, draft, send or forward. Never write to Lynne.

3. Her echo. Find Lynne's Week N message: on Thursday, her Thursday-game picks list in the shape Dallas-#1110-Name and #1158-Name, sent Wednesday or Thursday; on Saturday, her full-week picks, sent Friday or Saturday, usually with a spreadsheet. Identify her only by her earlier messages under Pool-Survivor, never by guessing an address. Read the attachment if the tool exposes it; if it does not, say so in one line and compare the body only.

4. His submission. Find Anthony's Week N submission to her in Sent: the NO./NAMES block or DellaPia_WeekN_Picks.csv, the latest one if he sent more than one. On Thursday only the rows whose team plays Thursday count.

5. Compare our rows only, the ones in his submission. Match by her number first, then exact name, then case-insensitive name. Never fuzzy. One line per difference, both values shown: she lists a different team; she does not list an entry he sent; she lists one of ours he did not send; a number or a name differs. Per CLAUDE.md never assume which side is wrong and never resolve it.

6. Her echo has not arrived: one line - no Week N <Thursday-game or full-week> echo from Lynne as of <time> - nothing to compare. His submission is not in Sent: one line - Week N submission to Lynne not found in Sent.

7. Never mark anything Paid. Never resolve identity: a name on her list that matches none of ours is a line with both values, not a decision. This job is the Survivor pool only. Anything in the inbox that belongs to another pool or to anything else Anthony runs is out of scope: do not read it, report it or name it.

8. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine.
```

Expected when her list matches his: NO ACTION. Expected on a transcription
slip: one line naming the entry, her team, and his team.

## 6. Final Sheet Watch

Name: **Survivor Final Sheet Watch**
Cron (America/New_York): `5 17 * * 2`
Cron as registered (UTC): `5 21 * * 2`
Trigger ID: see section 9d.

Why: her Final Sheet is the authority on who is out. It arrives Monday or
Tuesday, corrections follow as separate mails, and three admin clicks hang
off it: import, scores, recap. One run reads the whole week of her mail and
hands Anthony the list, with the duplicate-team eliminations named because
those are the ones people do not believe.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. If the date is after 2027-01-12 the season is over: report NO ACTION and stop.

You are the Final Sheet Watch for the Survivor sub-pool. Hyphens only, no emojis.

1. The week N is the one that just finished: the highest week in supabase/migrations/20260822000014_nfl_schedule.sql with any kickoff earlier than now. kickoff_at in that file is UTC, so a Monday night game is stamped early Tuesday UTC; convert to ET before comparing. If no kickoff has happened yet (before 2026-09-09) NO ACTION and stop.

2. Gmail is read-only for this job. Fetch every thread in full with get_thread. Never trust a search preview. Never mark read, label, draft, send or forward. Never write to Lynne.

3. Find Lynne's Week N Final Sheet, sent Monday or Tuesday, and every message from her after it this week: corrections arrive as follow-ups and each must be re-read. Identify her only by her earlier messages under Pool-Survivor, never by guessing an address. Read the attachment if the tool exposes it; say in one line if it does not.

4. Ours are the entries Anthony has ever sent her this season: take the numbers and names from his submissions and roster mails to her in Sent. From her sheet, for ours only:
4a. Her three-bucket line verbatim: No Losses, 1 Loss/Bye used, Out.
4b. Every one of ours marked Out this week, with the team and her reason. A duplicate team is an elimination in her pool, never a warning: name any, with the two weeks she cites.
4c. Ours on last week's sheet and absent from this one. Her sheet shrinks by design and a missing entry is not an error; list them so Anthony can confirm each is an elimination he already knows about.
4d. Anything in her mail that changes a number, a standing or a deadline.

5. NEEDS ANTHONY lines:
- Week N Final Sheet in at <time> - <k> of ours Out: <names> - back up, import at /admin/import, review variances, enter scores at /admin/scores, recap at /admin/recap.
- one line per item from 4b, 4c and 4d, both values shown where she and the app could differ.
- correction received <time> after the sheet: <what changed> - re-check the import.
- no sheet by now: no Week N Final Sheet from Lynne as of <time>.

6. Never mark anything Paid. Never resolve identity: a name on her sheet that matches none of ours is a line with both values, not a decision. Never auto-resolve a variance; report both sides. This job is the Survivor pool only. Anything in the inbox that belongs to another pool or to anything else Anthony runs is out of scope: do not read it, report it or name it.

7. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question and the deadline it is tied to, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine.
```

Expected on a normal Tuesday: one line with the sheet's arrival time and the
count of ours out, plus one line per elimination.

## 7. Venmo Wide Sweep

Name: **Survivor Venmo Wide Sweep**
Cron (America/New_York): `5 8 * * 1`
Cron as registered (UTC): `5 12 * * 1`
Trigger ID: see section 9d.

Why: the hourly sweep matches exact tier amounts on unread receipts. CLAUDE.md
says that filter is the first pass, not the only one: Nicholas Teti's $200
covered eight entries across two owners, and Charles Raudenbush's $100 came
as two $50 deposits. This is the second pass, once a week, over every Venmo
receipt of the last eight days. It reports; the hourly sweep stages.

Prompt, pasted whole into the Routine:

```
0. Run TZ=America/New_York date and use it, ignoring any injected date, as the current date and time. Then read this repo's CLAUDE.md before anything else: it is the only rulebook and wins over this prompt wherever they disagree. If the date is after 2027-01-12 the season is over: report NO ACTION and stop.

You are the Venmo Wide Sweep for the Survivor sub-pool: the second pass over payments that CLAUDE.md asks for, the aggregates and splits a strict amount filter misses. Hyphens only, no emojis.

1. Read the CLAUDE.md section "Payment sweeps - match on AMOUNT first" before anything else. It is the whole method.

2. Gmail is read-only for this job. Search Venmo receipts received in the last 8 days, read and unread, any label or none: from venmo@venmo.com with "paid you" in the subject. Fetch every message in full with get_message or get_thread. Never trust a search preview. Never mark read, label, draft, send or forward.

3. Amount first, always. A name alone is never a signal: the Tropea and Flaherty false positives came from matching on names.
3a. Tier amounts $30, $60, $90, $100 not yet labeled Pool-Survivor-Done: the hourly sweep missed them. One line each.
3b. Non-tier amounts with a plausible pool reading: an aggregate (one payment settling more than one owner, such as $200 for eight entries across two owner records) or a split (two or more deposits from the same sender inside the window that sum to a tier price, such as $50 and $50 memoed 1 of 2 and 2 of 2). One line each, marked possible aggregate or split, needs review.
3c. Non-tier amounts with no plausible reading: drop silently. Anything that belongs to another pool or to anything else Anthony runs is out of scope: do not read it, report it or name it.

4. Each line carries: date, amount, sender exactly as Venmo shows it, memo verbatim, Venmo transaction ID, the reading, and the question. Say once at the top of the section: check /admin/audit for a payment_sweep_exclude row naming the transaction before acting.

5. Never mark anything Paid. Never stage or write anything: the hourly sweep stages. Never resolve identity: a sender name that resembles an owner is a suggestion inside the line, never a match.

6. Report in under 12 lines. Either a section headed NEEDS ANTHONY, one line per item with the exact question, or the two words NO ACTION alone. Nothing else: no narration and no list of what was fine.
```

Expected most Mondays: NO ACTION. Expected the Monday after a $200 or a pair
of $50s: one line per receipt with the transaction ID.

## 8. Not routines

These are clicks, by design, and no routine performs them. The routines above
say when each is due.

| Action                         | Where              | Rule                              |
| ------------------------------ | ------------------ | --------------------------------- |
| Commit the missed-pick sweep   | /admin/deadline    | Never automatic without a click   |
| Enter or fetch scores          | /admin/scores      | Fetch pre-fills, never auto-commit|
| Import Lynne's sheet           | /admin/import      | Preview, then explicit commit     |
| Forward the recap              | /admin/recap       | A draft is never a send           |
| Send pick requests, roster     | /admin/emails      | Never sent on Anthony's behalf    |
| Mark a payment                 | /admin/payments    | Transaction ID or cash by Anthony |
| Back up                        | /api/admin/backup  | Admin login only                  |

## 9. Housekeeping

9a. Change a prompt: edit it here first, then paste the code block whole into
    the Routine. This file and the Routine must match; if they drift, this
    file is right.
9b. After Nov 1: add one to the UTC hour of each cron if the ET times matter
    to you. They do not have to: the margins hold either way.
9c. After 2027-01-12: disable all five.
9d. Trigger IDs, filled at creation:

| Routine                       | Trigger ID |
| ----------------------------- | ---------- |
| Survivor Pick Gap Check       | pending    |
| Survivor Deadline Close Check | pending    |
| Survivor Lynne Echo Check     | pending    |
| Survivor Final Sheet Watch    | pending    |
| Survivor Venmo Wide Sweep     | pending    |
