"use strict";

// Which Wyze Cam Plus plan, if any, covers a camera. Wyze lists no features for a plan, so this is only the facts the
// account does give: who has a plan, until when, and whether it is live. What that means for a camera is seen in
// its events: with a plan they come with video and AI labels; without one, about one picture every 5 minutes.
const SOON_MS = 14 * 24 * 3600 * 1000;

// One lookup per account, shared by every camera of the plugin. A failed lookup is remembered as null, so a camera
// that cannot be told its plan simply shows none rather than the lookup being retried by each camera.
function plansOnce(plugin) {
  if (!plugin._camPlusPlans) {
    plugin._camPlusPlans = (async () => {
      try {
        if (typeof plugin.client?.getCamPlusPlans !== "function") return null;
        const plans = await plugin.client.getCamPlusPlans();
        return Array.isArray(plans) ? plans : null;
      } catch (_) {
        return null;
      }
    })();
  }
  return plugin._camPlusPlans;
}

/**
 * The plan state of one camera: { state: "active" | "expired" | "none", name, expires } or null when it is not known.
 * "active" is a live plan with this camera on it; "expired" a plan this camera was on that has lapsed; "none" no plan
 * names it.
 */
function summarize(plans, mac, now = Date.now()) {
  if (!Array.isArray(plans)) return null;
  const mine = plans.filter((plan) => Array.isArray(plan.macs) && plan.macs.includes(mac));
  const live = mine.filter((plan) => plan.active).sort((a, b) => (b.expires || 0) - (a.expires || 0))[0];
  if (live) return { state: "active", name: live.name, expires: live.expires ?? null };
  const lapsed = mine.sort((a, b) => (b.expires || 0) - (a.expires || 0))[0];
  if (lapsed) return { state: "expired", name: lapsed.name, expires: lapsed.expires ?? null };
  return { state: "none", name: "", expires: null };
}

/** A line for the log, or "" when there is nothing to say. */
function warning(plan, now = Date.now()) {
  if (!plan) return "";
  if (plan.state === "none") return "has no Cam Plus plan: Wyze lists about one event per 5 minutes, so its Motion and Sound sensors can lag or skip";
  if (plan.state === "expired") return `its Cam Plus plan (${plan.name}) has expired`;
  if (plan.state === "active" && plan.expires && plan.expires - now <= SOON_MS) return `its Cam Plus plan (${plan.name}) ends ${new Date(plan.expires).toISOString().slice(0, 10)}`;
  return "";
}

module.exports = { plansOnce, summarize, warning, SOON_MS };
