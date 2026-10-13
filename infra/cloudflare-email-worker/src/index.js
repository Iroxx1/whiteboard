// Cloudflare Email Worker "whiteboard-email-ingest" (PLAN.md 5.8).
// Mail to board@<domain> → POST of the raw mail to the whiteboard server through the tunnel.
// If the server does not answer, the mail goes to FALLBACK_FORWARD, so nothing is lost.
//
// Variables (Worker → Settings → Variables and Secrets):
//   INGEST_URL        https://board.<domain>/api/ingest/email
//   INGEST_TOKEN      secret, identical to EMAIL_INGEST_TOKEN in the server's .env
//   FALLBACK_FORWARD  verified destination address in Email Routing (e.g. your Gmail address)
//
// Plain JavaScript on purpose: it can be pasted into the Cloudflare dashboard editor as is.

export default {
  async email(message, env) {
    // Read the mail once: forward() still works afterwards, the stream could not be read twice.
    const raw = await new Response(message.raw).arrayBuffer()
    let status = 0
    try {
      const response = await fetch(env.INGEST_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.INGEST_TOKEN}`,
          'Content-Type': 'message/rfc822',
          'X-Envelope-From': message.from,
          'X-Envelope-To': message.to,
        },
        body: raw,
      })
      status = response.status
    } catch {
      status = 0
    }
    if (status === 202) return
    // Unknown sender or failed DKIM check: refuse, the sender gets a bounce.
    if (status === 403) {
      message.setReject('Absender nicht berechtigt')
      return
    }
    // Server down, tunnel gone, wrong token, too large …: keep the mail.
    if (env.FALLBACK_FORWARD) {
      await message.forward(env.FALLBACK_FORWARD, new Headers({ 'X-Whiteboard-Ingest': `failed ${status}` }))
    } else {
      message.setReject('Whiteboard derzeit nicht erreichbar')
    }
  },
}
