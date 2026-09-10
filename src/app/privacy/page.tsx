import type { Metadata } from "next";

// The privacy policy Google's OAuth consent screen requires before the Gmail
// client can leave Testing status. Public and unauthenticated so Google can
// fetch it, and deliberately linked from nowhere: players do not need it.
// Every sentence here is a statement about what the pool actually does; a
// change to what it stores, shows or sends is a change to this page.

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="max-w-prose space-y-6 text-sm leading-6">
      <div>
        <h1 className="text-2xl">Privacy</h1>
        <p className="mt-1 text-muted-foreground">
          This site runs a private NFL survivor pool of about 120 entries.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-medium">What the pool keeps</h2>
        <p>
          For each person in the pool: a name, an email address, a phone number
          if one was given, and any notes the administrator adds.
        </p>
        <p>
          For each entry: its name, the email addresses that send its picks, and
          every pick with the time it arrived.
        </p>
        <p>
          For entry fees: the amount paid, the date, and the Venmo transaction
          reference when there is one.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">How picks are collected</h2>
        <p>
          Players send picks by email reply, by text, or by phone. To collect
          emailed picks, this app reads the pool administrator&apos;s own Gmail
          account: mail from pool members&apos; addresses, and mail whose
          subject mentions the pool or picks. The same account is used to email
          pool members about their picks. The app does not read anyone
          else&apos;s email.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Who sees what</h2>
        <p>
          Entry names, picks, and results appear on this site&apos;s public
          pages, and each entry&apos;s page shows its owner&apos;s name. Email
          addresses, phone numbers, and payment records are seen only by the
          administrator.
        </p>
        <p>
          This group plays inside a larger survivor pool, and entry names and
          picks are sent to that pool&apos;s organizer.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Services</h2>
        <p>
          The pool&apos;s records are stored with Supabase, and this site is
          hosted by Vercel. The administrator can also export the records to
          the administrator&apos;s own Google Sheets.
        </p>
        <p>
          Nothing here is sold or used for advertising, and nothing is shared
          beyond what this page describes.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Removal</h2>
        <p>
          To have your information removed, email{" "}
          <a className="underline" href="mailto:anthonydellapia@gmail.com">
            anthonydellapia@gmail.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
