import { handleTwilioWebhook } from "@/lib/workplace/runtime.server";

// Twilio "A message comes in" webhook (HTTP POST). Public, but every request must carry a
// valid X-Twilio-Signature for TWILIO_WEBHOOK_URL; anything else is rejected with 403.
export async function POST(request: Request) {
  return handleTwilioWebhook(request);
}
