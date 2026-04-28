import { Hono } from "hono";
import { billingRoute } from "./billing.js";
import { bridgeRoute } from "./bridge.js";
import { browserRoute } from "./browser.js";
import { capabilitiesRoute } from "./capabilities.js";
import { connectRoute } from "./connect.js";
import { discoverRoute } from "./discover.js";
import { draftRoute } from "./draft.js";
import { evaluateRoute } from "./evaluate.js";
import { expensesRoute } from "./expenses.js";
import { v1HealthRoute } from "./health.js";
import { keysRoute } from "./keys.js";
import { matchRoute } from "./match.js";
import { meRoute } from "./me.js";
import { notificationsRoute } from "./notifications.js";
import { ordersRoute } from "./orders.js";
import { repriceRoute } from "./reprice.js";
import { researchRoute } from "./research.js";
import { shipRoute } from "./ship.js";
import { takedownRoute } from "./takedown.js";
import { webhooksRoute } from "./webhooks.js";

export const v1Routes = new Hono();

v1Routes.route("/billing", billingRoute);
v1Routes.route("/bridge", bridgeRoute);
v1Routes.route("/browser", browserRoute);
v1Routes.route("/capabilities", capabilitiesRoute);
v1Routes.route("/connect", connectRoute);
v1Routes.route("/discover", discoverRoute);
v1Routes.route("/draft", draftRoute);
v1Routes.route("/evaluate", evaluateRoute);
v1Routes.route("/expenses", expensesRoute);
v1Routes.route("/health", v1HealthRoute);
v1Routes.route("/keys", keysRoute);
v1Routes.route("/match", matchRoute);
v1Routes.route("/me", meRoute);
v1Routes.route("/notifications", notificationsRoute);
// Bridge-driven /v1/orders. Preempts the eBay Order API passthrough at the
// same paths (which 501s until eBay grants tenant approval).
v1Routes.route("/orders", ordersRoute);
v1Routes.route("/reprice", repriceRoute);
v1Routes.route("/research", researchRoute);
v1Routes.route("/ship", shipRoute);
v1Routes.route("/takedown", takedownRoute);
v1Routes.route("/webhooks", webhooksRoute);
