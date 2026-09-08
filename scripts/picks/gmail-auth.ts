// npm run gmail:auth
// One-time browser consent for the intake and outbound commands.
import { authorizeInteractive } from "../lib/gmail";

authorizeInteractive().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
