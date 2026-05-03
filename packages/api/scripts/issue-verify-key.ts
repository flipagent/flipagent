import { issueKey } from "../src/auth/keys.js";
const r = await issueKey({ tier: "free", ownerEmail: `verify-${Date.now()}@flipagent.dev` });
process.stdout.write(r.plaintext);
process.exit(0);
