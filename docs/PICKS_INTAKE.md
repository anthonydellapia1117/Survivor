# Picks intake and the list to Lynne

TLDR: two local commands replace hand entry and the self-emailed DECISION
loop. `npm run picks` turns unread player mail or pasted text into a proposed
table and writes only after you type y. `npm run lynne` prints the entries
that locked at a deadline in Lynne's numbering and leaves it as a Gmail draft
you send yourself.

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
The scope is gmail.modify: read, label and draft. Nothing in this repo
sends mail.

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
scopes bare lines and "for both" to that person's entries. `--file picks.txt`
reads a file instead of stdin. `--week N` overrides the open week.

2c. What you see: a table of entry, owner, team, deadline, on time or LATE,
and a note (new, OVERRIDE of the current pick, or already recorded). Under
it, every line it could not resolve, with the candidates it saw. Then:

```
Write 4 pick(s) and stage 1 pending row(s)? (y/N)
```

Only y or yes writes. Picks go through admin_submit_pick with source email or
text; a late one is stored with late = true, never refused and never hidden.
Unresolved lines become pending_actions rows (kind identity when the sender
is not a known address, player_question otherwise) carrying the Gmail message
id, for /admin/queue. Processed messages are marked read and filed under
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

## 4. Rules these commands keep

- Names are compared loosely and stored verbatim; nothing normalises a name.
- One entry, one team, or it is reported. No guess is ever written.
- Every write is an audited RPC as the admin. No service-role key exists.
- Drafts only. There is no send anywhere in scripts/.
- Nothing here touches money or identity resolution.
