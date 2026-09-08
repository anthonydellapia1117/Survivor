// npm run notify -- "one line"
//
// Posts the line to ntfy.sh/<NTFY_TOPIC> when the topic is set, prints it
// otherwise. The other commands call the same function at the end of a run
// and whenever they stage a NEEDS ANTHONY row.

import { notify, ntfyTopic } from "../lib/notify";

async function main(): Promise<void> {
  const line = process.argv.slice(2).join(" ").trim();
  if (!line) throw new Error('Usage: npm run notify -- "one line"');
  const outcome = await notify(line);
  console.log(outcome === "posted" ? `posted to ntfy topic ${ntfyTopic()}` : "NTFY_TOPIC not set; printed only");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
