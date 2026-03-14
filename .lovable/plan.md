

# Fix: Webhook registration failing on Evolution API

## Problem
The Evolution API is returning `instance requires property "webhook"` when trying to register the webhook. This means messages sent via WhatsApp never reach the `whatsapp-webhook` Edge Function — which is why `/relatorio` and any other command gets no response.

The `whatsapp-webhook` has **zero logs**, confirming no messages are being forwarded.

## Root Cause
The Evolution API version being used has a specific payload format for webhook registration that we haven't matched correctly. We've tried both with and without a `webhook` wrapper — neither worked.

## Plan

### 1. Add diagnostic endpoint to test webhook registration formats
Add a **debug mode** to `whatsapp-status` that tries multiple payload formats and logs which one succeeds:
- Format A: `{ url, events, webhook_by_events, webhook_base64 }` (flat)
- Format B: `{ webhook: { url, events, ... } }` (wrapped)
- Format C: `{ enabled: true, url, events, ... }` (with enabled flag)

### 2. Update `whatsapp-status/index.ts`
- Try all 3 formats sequentially, log responses from each
- Use the first format that succeeds
- Add detailed logging of the Evolution API response (status code + body) for each attempt

### 3. Update `whatsapp-connect/index.ts`
- Set the webhook **during instance creation** by including `webhook` config in the `instance/create` payload — some Evolution API versions support this
- Keep the separate `webhook/set` call as fallback with the correct format discovered above

### 4. Add a manual test button
- Add a "Test Webhook" button in Settings that calls `whatsapp-status` and shows the detailed result (which format worked, or all errors)

## Technical Details

The key change in `whatsapp-status/index.ts` will be:

```typescript
// Try multiple webhook registration formats
const formats = [
  // Format A: flat
  { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events },
  // Format B: wrapped
  { webhook: { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events } },
  // Format C: with enabled flag
  { enabled: true, url: webhookUrl, webhook_by_events: true, webhook_base64: false, events },
];

let webhookRegistered = false;
for (const [i, payload] of formats.entries()) {
  console.log(`Trying webhook format ${i + 1}:`, JSON.stringify(payload).substring(0, 200));
  const res = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    body: JSON.stringify(payload),
  });
  const resText = await res.text();
  console.log(`Format ${i + 1} response [${res.status}]:`, resText.substring(0, 300));
  if (res.ok) { webhookRegistered = true; break; }
}
```

The same multi-format approach will be applied to `whatsapp-connect/index.ts`.

## Files to modify
- `supabase/functions/whatsapp-status/index.ts` — multi-format webhook registration with logging
- `supabase/functions/whatsapp-connect/index.ts` — same multi-format approach

