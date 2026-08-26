// Firestore document shapes (server-write only; rules live in the lupi repo):
//   customers/{uid}          { stripeCustomerId, email, updatedAt }
//   entitlements/{uid}       { status, priceId, currentPeriodEnd, cancelAtPeriodEnd, updatedAt }
//   stripeEvents/{eventId}   { type, receivedAt }   (webhook idempotency marker)
//   usageEvents/{id}         stub for future usage-based billing (not read yet)

export function subscriptionToEntitlement(sub) {
  const item = sub.items?.data?.[0];
  return {
    status: sub.status,
    priceId: item?.price?.id || "",
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : (sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : ""),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function entitlementIsActive(ent) {
  return Boolean(ent && ACTIVE_STATUSES.has(ent.status));
}
