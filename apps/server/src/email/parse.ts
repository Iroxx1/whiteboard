import { type Attachment, type ParsedMail, simpleParser } from 'mailparser'

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])
const MAX_ADDRESS = 254

/**
 * Sender address for the allow list (PLAN.md 5.8, step 4): lower case; Gmail ignores dots and
 * "+suffix" in the local part, so those are removed there. Returns null for invalid addresses.
 */
export function normalizeSender(address: string): string | null {
  const value = address.trim().toLowerCase()
  if (value.length > MAX_ADDRESS) return null
  const match = /^([^\s@<>()",;:]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(value)
  if (!match) return null
  let [, local = '', domain = ''] = match
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split('+')[0]?.replaceAll('.', '') ?? ''
    domain = 'gmail.com'
    if (!local) return null
  }
  return `${local}@${domain}`
}

/** "Fwd:", "Re:", "WG:", "AW:" … at the start of a subject, also repeated. */
export function cleanSubject(subject: string | undefined): string {
  return (subject ?? '').replace(/^(\s*(re|aw|fwd?|wg|wtr|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').trim()
}

const QUOTE_INTRO = [
  /^Am .{3,120} schrieb .{1,200}:\s*$/,
  /^On .{3,120} wrote:\s*$/,
  /^-{2,}\s*(Ursprüngliche Nachricht|Original Message)\s*-{2,}\s*$/i,
]
const FORWARD_MARKER = /^-{5,}\s*(Forwarded message|Weitergeleitete Nachricht)\s*-{5,}\s*$/i
const FORWARD_HEADER = /^(Von|From|Date|Datum|Subject|Betreff|To|An|Cc)\s*:/i

/**
 * Body text without signature and quoted replies (PLAN.md 5.8). For forwarded mails the forward
 * header ("Von:", "Datum:", …) is dropped and the forwarded text kept: that is the content.
 */
export function cleanBody(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inForwardHeader = false
  for (const line of lines) {
    if (line === '-- ' || line === '--') break
    if (QUOTE_INTRO.some((pattern) => pattern.test(line.trim()))) break
    if (FORWARD_MARKER.test(line.trim())) {
      inForwardHeader = true
      continue
    }
    if (inForwardHeader) {
      if (FORWARD_HEADER.test(line.trim())) continue
      if (line.trim() === '') {
        inForwardHeader = false
        continue
      }
      inForwardHeader = false
    }
    if (/^\s*>/.test(line)) continue
    out.push(line)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Signature logos, S/MIME signatures and calendar invitations are not content (PLAN.md 5.8). */
export function isIgnoredAttachment(attachment: Attachment): boolean {
  const type = attachment.contentType.toLowerCase()
  const name = (attachment.filename ?? '').toLowerCase()
  if (type === 'application/pkcs7-signature' || type === 'application/x-pkcs7-signature' || name === 'smime.p7s')
    return true
  if (type === 'text/calendar' || name.endsWith('.ics')) return true
  if (attachment.cid && attachment.related !== false && type.startsWith('image/') && attachment.size < 20 * 1024)
    return true
  return false
}

export type ParsedEmail = {
  messageId: string | null
  title: string | undefined
  text: string | undefined
  attachments: Attachment[]
}

export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  const parsed: ParsedMail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true })
  // mailparser derives `text` from HTML for HTML-only mails.
  const text = cleanBody(parsed.text ?? '')
  return {
    messageId: parsed.messageId ?? null,
    title: cleanSubject(parsed.subject) || undefined,
    text: text || undefined,
    attachments: parsed.attachments.filter((attachment) => !isIgnoredAttachment(attachment)),
  }
}
