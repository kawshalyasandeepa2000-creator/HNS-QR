import { connect } from "cloudflare:sockets";

/** Helen & Sons QR referral API — existing mailbox SMTP thank-you emails.
 * Required bindings: DB (D1), CAMPAIGN_SLUG, SITE_ORIGIN,
 * ADMIN_TOKEN and VISITOR_SECRET (both secret variables).
 * Optional existing-mail SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_FROM, SMTP_PASSWORD (the last one MUST be a secret).
 */

const encoder = new TextEncoder();

const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");

const validId = /^[a-f0-9]{32}$/;

const CAMPAIGN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Additional trusted front-end origins (scheme + hostname only, no /docs/ path).
// SITE_ORIGIN remains the original origin configured in Cloudflare Worker settings.

const EXTRA_ALLOWED_ORIGINS = new Set([

  "https://hns-qr.pages.dev",

  "https://kawshalyasandeepa2000-creator.github.io"

]);

function getSiteOrigin(env) {

  try {

    const url = new URL(env.SITE_ORIGIN);

    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return null;

    return url.origin;

  } catch {

    return null;

  }

}

function headersFor(origin) {

  return {

    "Access-Control-Allow-Origin": origin,

    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",

    "Access-Control-Allow-Headers": "Content-Type, Authorization",

    "Access-Control-Max-Age": "600",

    "Vary": "Origin",

    "Cache-Control": "no-store",

    "X-Content-Type-Options": "nosniff",

    "Referrer-Policy": "no-referrer",

    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"

  };

}

function json(data, status, headers) {

  return new Response(JSON.stringify(data), {

    status,

    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }

  });

}

async function sha256(raw) {

  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));

}

async function isAdmin(request, env) {

  const expected = env.ADMIN_TOKEN;

  if (typeof expected !== "string" || expected.length < 32) return false;

  const supplied = request.headers.get("Authorization") || "";

  if (!supplied.startsWith("Bearer ") || supplied.length > 4096) return false;

  const token = supplied.substring("Bearer ".length);

  const [left, right] = await Promise.all([sha256(token), sha256(expected)]);

  let mismatch = 0;

  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];

  return mismatch === 0;

}

async function visitorHash(visitorId, secret) {

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`referral-visitor:${visitorId}`))));

}

function normalizedName(raw) {

  if (typeof raw !== "string") return null;

  const name = raw.normalize("NFC").trim().replace(/\s+/gu, " ");

  if (name.length < 2 || name.length > 100 || !/\p{L}/u.test(name) || /[<>\u0000-\u001f\u007f]/u.test(name)) return null;

  return name;

}

function normalizedPhone(raw) {

  if (typeof raw !== "string" || raw.length > 32) return null;

  let phone = raw.trim().replace(/[\s().-]/g, "");

  if (/^05\d{8}$/.test(phone)) phone = "+971" + phone.slice(1);

  else if (/^5\d{8}$/.test(phone)) phone = "+971" + phone;

  else if (/^971\d{9}$/.test(phone)) phone = "+" + phone;

  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;

}

function normalizedEmail(raw) {

  if (raw == null || raw === "") return null;

  if (typeof raw !== "string") return null;

  const email = raw.trim().toLowerCase();

  if (email.length > 254) return null;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;

}

function conflict() {

  return { error: "A registration already exists for this browser or mobile number. Contact Helen & Sons if you need help retrieving your code." };

}

function codeResult(campaign, row, reused) {

  return {

    campaign,

    code: row.code,

    createdAt: row.created_at,

    fullName: row.full_name,

    mobileNumber: row.mobile_number,

    email: row.email || "",

    reused

  };

}

async function issueCode(env, campaign, visitorId, fullName, mobileNumber, email, source) {

  const visitor = await visitorHash(visitorId, env.VISITOR_SECRET);

  const fetchExisting = () => env.DB.prepare(

    "SELECT id, code, created_at, full_name, mobile_number, email FROM referrals WHERE campaign_slug = ? AND visitor_hash = ?"

  ).bind(campaign, visitor).first();

  let existing = await fetchExisting();

  if (existing) {

    if (existing.full_name && existing.mobile_number) {

      if (existing.mobile_number !== mobileNumber || existing.full_name.toLocaleLowerCase() !== fullName.toLocaleLowerCase()) {

        return { conflict: true };

      }

      if (email && existing.email !== email) {

        await env.DB.prepare(

          "UPDATE referrals SET email = ? WHERE id = ?"

        ).bind(email, existing.id).run();

        existing = await fetchExisting();

      }

      return codeResult(campaign, existing, true);

    }

    await env.DB.prepare(

      "UPDATE OR IGNORE referrals SET full_name = ?, mobile_number = ?, email = ? WHERE id = ? AND (full_name IS NULL OR full_name = '') AND (mobile_number IS NULL OR mobile_number = '')"

    ).bind(fullName, mobileNumber, email, existing.id).run();

    existing = await fetchExisting();

    if (existing?.mobile_number === mobileNumber && existing?.full_name?.toLocaleLowerCase() === fullName.toLocaleLowerCase()) {

      return codeResult(campaign, existing, true);

    }

    return { conflict: true };

  }

  for (let attempt = 0; attempt < 5; attempt++) {

    const code = `REF-${hex(crypto.getRandomValues(new Uint8Array(8))).toUpperCase()}`;

    const createdAt = new Date().toISOString();

    const sourceReady = await hasRegistrationSource(env);
    const result = sourceReady
      ? await env.DB.prepare("INSERT OR IGNORE INTO referrals (campaign_slug, code, visitor_hash, created_at, full_name, mobile_number, email, registration_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(campaign, code, visitor, createdAt, fullName, mobileNumber, email, source).run()
      : await env.DB.prepare("INSERT OR IGNORE INTO referrals (campaign_slug, code, visitor_hash, created_at, full_name, mobile_number, email) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(campaign, code, visitor, createdAt, fullName, mobileNumber, email).run();

    const row = await fetchExisting();

    if (row) {

      if (row.mobile_number !== mobileNumber || row.full_name?.toLocaleLowerCase() !== fullName.toLocaleLowerCase()) return { conflict: true };

      return codeResult(campaign, row, Number(result.meta?.changes ?? 0) === 0);

    }

    const phoneClaimed = await env.DB.prepare(

      "SELECT id FROM referrals WHERE campaign_slug = ? AND mobile_number = ?"

    ).bind(campaign, mobileNumber).first();

    if (phoneClaimed) return { conflict: true };

  }

  throw new Error("Unable to issue a unique referral code.");

}
// Send an acknowledgement only for a newly issued referral code using existing company mailbox.
// All customer-provided content is escaped before insertion into HTML.
// Registration does not depend on the email provider being available.

function escapeHtml(value) {

  return String(value).replace(/[&<>"']/g, char => ({

    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"

  })[char]);

}
// Existing company mailbox via SMTP, using TLS and your own mail server.
// NOTE: Cloudflare blocked_destination (previously observed) is not fixed by
// adding References. An HTTPS relay is a separate deployment decision.
// No Resend account or new DNS configuration is necessary when the mailbox
// provider already permits authenticated SMTP submission over 465 / 587.
// These settings must be added to the Cloudflare Worker as variables/secrets.

const SMTP_ADDRESS = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const SMTP_HOSTNAME = /^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i;

function smtpSettings(env) {

  const host = String(env.SMTP_HOST || "").trim();

  const port = Number(env.SMTP_PORT || "465");

  const user = String(env.SMTP_USER || "").trim();

  const password = env.SMTP_PASSWORD;

  const from = String(env.SMTP_FROM || "").trim();

  if (!SMTP_HOSTNAME.test(host) || ![465, 587].includes(port) ||

      !SMTP_ADDRESS.test(user) || !SMTP_ADDRESS.test(from) ||

      typeof password !== "string" || password.length === 0) return null;
// Send from the same authenticated mailbox to avoid provider spoofing errors.

  if (from.toLowerCase() !== user.toLowerCase()) return null;

  return { host, port, user, password, from };

}

function smtpBase64(raw) {

  const bytes = encoder.encode(raw);

  let binary = "";
// Small values (email bodies and mailbox passwords); safe in Workers.

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);

}

function mimeBase64(raw) {

  const base64 = smtpBase64(raw);

  return (base64.match(/.{1,76}/g) || []).join("\r\n");

}

function makeThankYouMessage(result, from) {

  const safeCode = escapeHtml(result.code);

  const safeName = escapeHtml(result.fullName);

  const plain = `Hello ${result.fullName},\n\nThank you for registering with Helen & Sons Visa Consultancy.\n\nYour personal referral code: ${result.code}\n\nKeep your referral code for your records when referring someone.\n\nKind regards,\nHelen & Sons Visa Consultancy\n\nThis is a one-time registration confirmation.`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>

  <body style="margin:0;background:#f4f6fb;padding:22px;font-family:Arial,sans-serif;color:#0B2463">

  <main style="max-width:560px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #d7dfef">

    <header style="background:#0B2463;padding:26px 28px;color:#fff">

      <div style="font-size:20px;font-weight:800">HELEN &amp; SONS</div>

      <div style="font-size:12px;letter-spacing:1.5px;color:#F5E216">VISA CONSULTANCY</div>

    </header>

    <section style="padding:28px">

      <h1 style="font-size:24px;margin:0 0 12px;color:#0B2463">Thank you for registering!</h1>

      <p>Hello ${safeName},</p>

      <p>Thank you for joining our referral programme. We have received your registration.</p>

      <p style="margin:22px 0 8px;font-size:12px;font-weight:700">YOUR PERSONAL REFERRAL CODE</p>

      <div style="padding:18px;border-radius:10px;background:#fdf9d7;border:1px solid #C89116;text-align:center;font-size:22px;font-weight:800;word-break:break-word">${safeCode}</div>

      <p>Keep your code for your records and use it when referring someone.</p>

      <p style="margin-top:26px">Kind regards,<br><strong>Helen &amp; Sons Visa Consultancy</strong></p>

    </section>

    <footer style="padding:16px 28px;background:#f3f6fc;color:#43557c;font-size:11px">One-time registration confirmation · © 2026 Helen &amp; Sons</footer>

  </main></body></html>`;
// Base64 MIME prevents Unicode characters (including customer names) from
// being mangled by older SMTP servers without 8BITMIME support.

  const boundary = `hns${crypto.randomUUID().replaceAll("-", "")}`;

  const message = [

    `From: "Helen & Sons Visa Consultancy" <${from}>`,

    `To: <${result.email}>`,

    `Subject: Thank you for registering | Helen & Sons`,

    `Date: ${new Date().toUTCString()}`,

    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,

    `MIME-Version: 1.0`,

    `X-Auto-Response-Suppress: All`,

    `Content-Type: multipart/alternative; boundary="${boundary}"`,

    ``,

    `--${boundary}`,

    `Content-Type: text/plain; charset=UTF-8`,

    `Content-Transfer-Encoding: base64`,

    ``,

    mimeBase64(plain.replace(/\n/g, "\r\n")),

    `--${boundary}`,

    `Content-Type: text/html; charset=UTF-8`,

    `Content-Transfer-Encoding: base64`,

    ``,

    mimeBase64(html),

    `--${boundary}--`,

    ``

  ].join("\r\n");
// Defend SMTP DATA from dot-terminated lines; content is base64 already.

  return message.replace(/(^|\r\n)\./g, "$1..");

}
// Incremental SMTP response parser (supports multi-line replies and TCP chunks).

function smtpSession(socket) {

  const reader = socket.readable.getReader();

  const writer = socket.writable.getWriter();

  const decoder = new TextDecoder();

  let buffer = "";

  async function nextLine() {

    for (;;) {

      const separator = buffer.indexOf("\r\n");

      if (separator !== -1) {

        const line = buffer.slice(0, separator);

        buffer = buffer.slice(separator + 2);

        return line;

      }

      const chunk = await reader.read();

      if (chunk.done) throw new Error("SMTP connection closed unexpectedly");

      buffer += decoder.decode(chunk.value, { stream: true });

      if (buffer.length > 32768) throw new Error("SMTP response too large");

    }

  }

  async function reply(expected) {

    let code = 0;

    let extension = "";

    for (let i = 0; i < 60; i++) {

      const line = await nextLine();

      const m = /^(\d{3})([ -])/.exec(line);

      if (!m) throw new Error("Malformed SMTP response");

      if (!code) code = Number(m[1]);

      else if (Number(m[1]) !== code) throw new Error("Unexpected SMTP response");

      extension += line + "\n";

      if (m[2] === " ") {

        if (!expected.includes(code)) {

          const error = new Error(`SMTP server returned ${code}`);

          error.smtpCode = code;

          throw error;

        }

        return extension;

      }

    }

    throw new Error("SMTP response too long");

  }

  async function command(text, expected) {

    await writer.write(encoder.encode(text + "\r\n"));

    return reply(expected);

  }

  function release() {

    reader.releaseLock();

    writer.releaseLock();

  }

  return { reply, command, release, writer };

}
// The previous version logged only `Error` and hid the failed SMTP step.
// Record a safe stage and numeric reply code, NEVER raw SMTP replies or credentials.

function smtpFailureClass(error, timedOut) {

  if (timedOut) return "timeout";

  const code = error?.smtpCode;

  if (Number.isInteger(code) && code >= 400 && code <= 599) return "smtp_rejected";

  const message = String(error?.message || "").toLowerCase();

  if (/proxy request failed|disallowed|tcp loop|cloudflare ip|blocked/.test(message)) return "blocked_destination";

  if (/does not advertise starttls/.test(message)) return "starttls_not_offered";

  if (/auth plain|auth login|auth unavailable/.test(message)) return "auth_not_supported";

  if (/tls|ssl|certificate|cert |handshake|x509/.test(message)) return "tls_error";

  if (/dns|enotfound|resolve|name or service not known/.test(message)) return "dns_error";

  if (/timeout|timed out/.test(message)) return "timeout";

  if (/connect|socket|unreachable|refused|reset|econn|network/.test(message)) return "network_error";

  return "unknown_error";

}

async function smtpDeliver(settings, recipient, message) {

  let socket;

  let watchdog;

  let client;

  let stage = "connect";

  let timedOut = false;

  try {

    socket = connect({ hostname: settings.host, port: settings.port }, {

      secureTransport: settings.port === 465 ? "on" : "starttls"

    });
// Close stalled SMTP submissions without waiting on email delivery.

    watchdog = setTimeout(() => {

      timedOut = true;

      try { void socket.close().catch(() => {}); } catch {}

    }, 18000);
// Separately observe TLS/TCP establishment before reading the SMTP banner.
// The prior diagnostic reported all socket failures as "server_greeting".

    stage = "tls_socket_open";

    await socket.opened;

    console.log("HNS SMTP TLS SOCKET OPENED");

    client = smtpSession(socket);

    stage = "server_greeting";

    await client.reply([220]);

    console.log("HNS SMTP GREETING RECEIVED");

    stage = "ehlo";

    let ehlo = await client.command("EHLO hns-qr.pages.dev", [250]);

    if (settings.port === 587) {

      stage = "starttls_check";
// Never send credentials in plaintext. Fail closed if STARTTLS absent.

      if (!/(^|\n)250[ -]STARTTLS(?:\s|\n)/i.test(ehlo))

        throw new Error("SMTP host does not advertise STARTTLS");

      stage = "starttls_upgrade";

      await client.command("STARTTLS", [220]);

      client.release();

      socket = socket.startTls();

      client = smtpSession(socket);

      stage = "ehlo_after_tls";

      ehlo = await client.command("EHLO hns-qr.pages.dev", [250]);

    }

    stage = "authentication";

    const upper = ehlo.toUpperCase();

    if (/\bAUTH\s[^\n]*\bPLAIN\b/.test(upper)) {

      await client.command(`AUTH PLAIN ${smtpBase64("\0" + settings.user + "\0" + settings.password)}`, [235]);

    } else if (/\bAUTH\s[^\n]*\bLOGIN\b/.test(upper)) {

      await client.command("AUTH LOGIN", [334]);

      await client.command(smtpBase64(settings.user), [334]);

      await client.command(smtpBase64(settings.password), [235]);

    } else {

      throw new Error("SMTP AUTH PLAIN/LOGIN unavailable");

    }

    stage = "mail_from";

    await client.command(`MAIL FROM:<${settings.from}>`, [250]);

    stage = "recipient";

    await client.command(`RCPT TO:<${recipient}>`, [250, 251]);

    stage = "data_command";

    await client.command("DATA", [354]);

    stage = "message_upload";

    await client.writer.write(encoder.encode(message + "\r\n.\r\n"));

    stage = "server_acceptance";

    await client.reply([250]);
// Once accepted, treat QUIT failures as harmless, not a failed send.

    stage = "quit";

    try { await client.command("QUIT", [221]); } catch {}

  } catch (error) {
// Only fixed labels and 3-digit reply codes are emitted; no private mail,
// credential, referral code, raw SMTP line or customer PII is logged.

    const smtpCode = Number.isInteger(error?.smtpCode) ? error.smtpCode : null;
// At the connection/greeting stages no credentials or customer details have
// been transmitted, so a short sanitized runtime error helps diagnosis.
// Never log raw SMTP replies or any AUTH / MAIL data.

    const safeEarlyStage = stage === "connect" || stage === "tls_socket_open" || stage === "server_greeting";

    const rawEarlyError = safeEarlyStage ? String(error?.message || "(no error message)") : "";

    const safeDetail = rawEarlyError

      .replace(/[\r\n\t]+/g, " ")

      .replace(/[^a-zA-Z0-9 _.:,;()/\\-]/g, "?")

      .slice(0, 180);

    console.error("HNS SMTP DIAGNOSTIC", JSON.stringify({

      step: stage,

      reason: smtpFailureClass(error, timedOut),

      smtpCode,

      errorType: typeof error?.name === "string" ? error.name.slice(0, 40) : "unknown",

      ...(safeEarlyStage ? { connectionDetail: safeDetail } : {})

    }));

    throw new Error("SMTP delivery attempt failed");

  } finally {

    if (watchdog !== undefined) clearTimeout(watchdog);

    if (socket) { try { void socket.close().catch(() => {}); } catch {} }

  }

}

async function sendThankYouEmail(env, result) {

  const settings = smtpSettings(env);

  if (!settings) {

    console.warn("HNS thank-you SMTP skipped: check SMTP variables and secrets");

    return;

  }

  if (!SMTP_ADDRESS.test(result.email)) return;

  await smtpDeliver(settings, result.email, makeThankYouMessage(result, settings.from));
// Do not log customer email, personal code, mailbox password or message data.

  console.log("HNS thank-you email accepted by company SMTP server");

}

function csvCell(value) {

  let str = String(value ?? "");

  if (/^[=+@\-\t\r]/.test(str)) str = "'" + str;

  return `"${str.replaceAll('"', '""')}"`;

}

function exportCsv(env, campaign, corsHeaders, qrOnly = false, sourceReady = true) {

  let cursor = Number.MAX_SAFE_INTEGER;

  const stream = new ReadableStream({

    start(controller) {

      controller.enqueue(encoder.encode("\uFEFFcode,full_name,mobile_number,email,campaign,created_at\r\n"));

    },

    async pull(controller) {

      try {

        // Legacy records must never be presented as proven QR registrations.
        if (qrOnly && !sourceReady) { controller.close(); return; }
        const query = qrOnly
          ? "SELECT id, code, full_name, mobile_number, email, campaign_slug, created_at FROM referrals WHERE campaign_slug = ? AND registration_source = 'qr' AND id < ? ORDER BY id DESC LIMIT 500"
          : "SELECT id, code, full_name, mobile_number, email, campaign_slug, created_at FROM referrals WHERE campaign_slug = ? AND id < ? ORDER BY id DESC LIMIT 500";
        const result = await env.DB.prepare(query).bind(campaign, cursor).all();

        const rows = result.results ?? [];

        if (!rows.length) {

          controller.close();

          return;

        }

        cursor = rows[rows.length - 1].id;

        controller.enqueue(encoder.encode(rows.map(row =>

          [row.code, row.full_name, row.mobile_number, row.email, row.campaign_slug, row.created_at].map(csvCell).join(",") + "\r\n"

        ).join("")));

      } catch (error) {

        controller.error(error);

      }

    }

  });

  return new Response(stream, {

    status: 200,

    headers: {

      ...corsHeaders,

      "Content-Type": "text/csv; charset=utf-8",

      "Content-Disposition": `attachment; filename="referrals-${campaign}.csv"`

    }

  });

}
// Business-card leads live in a separate D1 table. The existing referrals table,
// referral-code generator, email sender and campaign slug are not modified.


// Single-event Cloudflare D1 compatibility. Existing RIZE 17 data is not migrated.
const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function eventSlugFrom(url, env) {
  const slug = url.searchParams.get("event") ?? env.CAMPAIGN_SLUG;
  if (!EVENT_SLUG_PATTERN.test(slug) || slug.length > 80) {
    throw { status: 400, message: "Invalid event slug." };
  }
  return slug;
}
async function requireValidEvent(env, slug) {
  if (slug !== env.CAMPAIGN_SLUG) {
    throw { status: 404, message: "Event not found. Use the RIZE 17 QR link." };
  }
  return { slug, name: "RISE 17 - 2026" };
}
async function scopedEventSlug(env, request) {
  const slug = eventSlugFrom(new URL(request.url), env);
  await requireValidEvent(env, slug);
  return slug;
}
// PRAGMA is read-only. This allows old D1 databases to keep working before the
// optional registration_source column is added in the Cloudflare Console.
async function hasRegistrationSource(env) {
  const info = await env.DB.prepare("PRAGMA table_info(referrals)").all();
  return (info.results || []).some(row => row.name === "registration_source");
}
async function eventAdminStats(env, campaign, cors) {
  const sourceReady = await hasRegistrationSource(env);
  const [summary, latest] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ?").bind(campaign).first(),
    env.DB.prepare("SELECT code, full_name AS fullName, mobile_number AS mobileNumber, email, created_at AS createdAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 100").bind(campaign).all()
  ]);
  const total = Number(summary?.total || 0);
  const recent = latest.results || [];
  if (!sourceReady) {
    return json({ campaign, total, recent, totalQr: 0, totalLegacy: total,
      recentQr: [], recentLegacy: recent, sourceTrackingReady: false }, 200, cors);
  }
  const [qr, other, qrRecent, otherRecent] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ? AND registration_source = 'qr'").bind(campaign).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ? AND (registration_source IS NULL OR registration_source != 'qr')").bind(campaign).first(),
    env.DB.prepare("SELECT code, full_name AS fullName, mobile_number AS mobileNumber, email, created_at AS createdAt FROM referrals WHERE campaign_slug = ? AND registration_source = 'qr' ORDER BY id DESC LIMIT 100").bind(campaign).all(),
    env.DB.prepare("SELECT code, full_name AS fullName, mobile_number AS mobileNumber, email, created_at AS createdAt FROM referrals WHERE campaign_slug = ? AND (registration_source IS NULL OR registration_source != 'qr') ORDER BY id DESC LIMIT 100").bind(campaign).all()
  ]);
  return json({ campaign, total, recent, totalQr: Number(qr?.total || 0),
    totalLegacy: Number(other?.total || 0), recentQr: qrRecent.results || [],
    recentLegacy: otherRecent.results || [], sourceTrackingReady: true }, 200, cors);
}

const LEAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureBusinessLeadsTable(env) {
// Idempotent, scoped to a separately named table, and run only for authorized admins.

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS business_card_leads (

    id TEXT PRIMARY KEY NOT NULL,

    campaign_slug TEXT NOT NULL,

    person_name TEXT NOT NULL DEFAULT '',

    company_name TEXT NOT NULL DEFAULT '',

    email TEXT NOT NULL DEFAULT '',

    phone TEXT NOT NULL DEFAULT '',

    job_title TEXT NOT NULL DEFAULT '',

    website TEXT NOT NULL DEFAULT '',

    event_name TEXT NOT NULL DEFAULT '',

    notes TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL,

    updated_at TEXT NOT NULL

  )`).run();

  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_business_leads_campaign_created ON business_card_leads (campaign_slug, created_at DESC)").run();

}

function cleanLeadValue(data, field, length, multiline = false) {

  const raw = data[field] ?? '';

  if (typeof raw !== 'string') throw new Error(`${field} must be text.`);

  const value = raw.normalize('NFC').trim().replace(/\r\n?/g, '\n');

  if (value.length > length) throw new Error(`${field} is too long.`);

  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) throw new Error(`${field} contains unsupported characters.`);

  return multiline ? value : value.replace(/\s+/g, ' ');

}

function validateBusinessLead(data) {

  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Contact details are required.');

  const result = {

    personName: cleanLeadValue(data,'personName',120),

    companyName: cleanLeadValue(data,'companyName',160),

    email: cleanLeadValue(data,'email',254).toLowerCase(),

    phone: cleanLeadValue(data,'phone',40),

    jobTitle: cleanLeadValue(data,'jobTitle',120),

    website: cleanLeadValue(data,'website',200),

    eventName: cleanLeadValue(data,'eventName',120) || 'RISE 17 - 2026',

    notes: cleanLeadValue(data,'notes',500,true)

  };

  if (!result.personName && !result.companyName) throw new Error('Enter a person name or company name.');

  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Email address is not valid.');

  if (result.phone && !/^[+\d][\d\s()./\-]{6,39}$/.test(result.phone)) throw new Error('Phone number is not valid.');

  if (result.website && !/^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d{2,5})?(?:\/[^\s]*)?$/i.test(result.website)) throw new Error('Website address is not valid.');

  return result;

}

async function readBusinessLeadBody(request, cors) {

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return {errorResponse:json({error:'JSON required.'},415,cors)};

  if (Number(request.headers.get('Content-Length')||0)>7000) return {errorResponse:json({error:'Body too large.'},413,cors)};

  const raw=await request.text();

  if (raw.length>7000) return {errorResponse:json({error:'Body too large.'},413,cors)};

  try{return {data:validateBusinessLead(JSON.parse(raw))};}

  catch(error){return {errorResponse:json({error:error.message||'Invalid contact details.'},400,cors)};}

}

function mapBusinessLead(row) {

  return {

    id:row.id, personName:row.person_name, companyName:row.company_name,

    email:row.email,phone:row.phone,jobTitle:row.job_title,

    website:row.website,eventName:row.event_name,notes:row.notes,

    createdAt:row.created_at,updatedAt:row.updated_at

  };

}

function exportBusinessLeadCsv(env,campaign,cors) {

  let offset=0;

  const cols=['person_name','company_name','email','phone','job_title','website','event_name','notes','created_at','updated_at'];

  const stream = new ReadableStream({

    start(controller){controller.enqueue(encoder.encode('\ufeff'+cols.join(',')+'\r\n'));},

    async pull(controller){

      try {

        const result=await env.DB.prepare(`SELECT ${cols.join(',')} FROM business_card_leads WHERE campaign_slug = ? ORDER BY created_at DESC,id DESC LIMIT 250 OFFSET ?`)

          .bind(campaign,offset).all();

        const rows=result.results||[];

        if (!rows.length){controller.close();return;}

        offset+=rows.length;

        controller.enqueue(encoder.encode(rows.map(row=>cols.map(col=>csvCell(row[col])).join(',')+'\r\n').join('')));

      }catch(error){controller.error(error);}

    }

  });

  return new Response(stream,{status:200,headers:{...cors,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="business-card-leads-${campaign}.csv"`}});

}

async function handleBusinessCardApi(request,env,cors,pathname) {

  if (!await isAdmin(request,env)) return json({error:'Invalid admin token.'},401,cors);

  const pathPrefix='/api/admin/business-cards';

  const pathRest=pathname.slice(pathPrefix.length);

  const id=pathRest.startsWith('/')?pathRest.slice(1):'';

  const isExport=id==='export.csv';

  if (id && !isExport && !LEAD_ID_PATTERN.test(id)) return json({error:'Invalid contact ID.'},400,cors);

  await ensureBusinessLeadsTable(env);

  const campaign=await scopedEventSlug(env,request);

  if (!id && request.method==='GET') {

    const [count,rows]=await Promise.all([

      env.DB.prepare('SELECT COUNT(*) AS total FROM business_card_leads WHERE campaign_slug=?').bind(campaign).first(),

      env.DB.prepare('SELECT * FROM business_card_leads WHERE campaign_slug=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(campaign).all()

    ]);

    return json({total:Number(count?.total||0),items:(rows.results||[]).map(mapBusinessLead)},200,cors);

  }

  if (isExport && request.method==='GET') return exportBusinessLeadCsv(env,campaign,cors);

  if (!id && request.method==='POST') {

    const {data,errorResponse}=await readBusinessLeadBody(request,cors);

    if (errorResponse) return errorResponse;

    const id=crypto.randomUUID();const now=new Date().toISOString();

    await env.DB.prepare(`INSERT INTO business_card_leads

      (id,campaign_slug,person_name,company_name,email,phone,job_title,website,event_name,notes,created_at,updated_at)

      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,campaign,data.personName,data.companyName,data.email,data.phone,data.jobTitle,data.website,data.eventName,data.notes,now,now).run();

    return json({ok:true,id},201,cors);

  }

  if (id && !isExport && request.method==='PATCH') {

    const {data,errorResponse}=await readBusinessLeadBody(request,cors);

    if (errorResponse) return errorResponse;

    const now=new Date().toISOString();

    const result=await env.DB.prepare(`UPDATE business_card_leads

      SET person_name=?,company_name=?,email=?,phone=?,job_title=?,website=?,event_name=?,notes=?,updated_at=?

      WHERE id=? AND campaign_slug=?`).bind(data.personName,data.companyName,data.email,data.phone,data.jobTitle,data.website,data.eventName,data.notes,now,id,campaign).run();

    if (Number(result.meta?.changes||0)===0) return json({error:'Business contact not found.'},404,cors);

    return json({ok:true},200,cors);

  }

  if (id && !isExport && request.method==='DELETE') {

    const result=await env.DB.prepare('DELETE FROM business_card_leads WHERE id=? AND campaign_slug=?').bind(id,campaign).run();

    if (Number(result.meta?.changes||0)===0) return json({error:'Business contact not found.'},404,cors);

    return json({ok:true},200,cors);

  }

  return json({error:'Method not allowed.'},405,cors);

}

/** RISE 17 - private CSV References. Independently stored in D1.
 * Does not touch referrals, their counts, business cards, or email sender.
 */

const REF_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REF_NUM_RE = /^[A-Z0-9][A-Z0-9._-]{0,59}$/;

async function ensureCsvReferencesTable(env) {

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS csv_reference_contacts (

    id TEXT PRIMARY KEY NOT NULL,

    campaign_slug TEXT NOT NULL,

    reference_no TEXT NOT NULL,

    person_name TEXT NOT NULL DEFAULT '',

    company_name TEXT NOT NULL DEFAULT '',

    email TEXT NOT NULL DEFAULT '',

    phone TEXT NOT NULL DEFAULT '',

    job_title TEXT NOT NULL DEFAULT '',

    website TEXT NOT NULL DEFAULT '',

    notes TEXT NOT NULL DEFAULT '',

    source_file TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL,

    updated_at TEXT NOT NULL,

    UNIQUE(campaign_slug, reference_no)

  )`).run();

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_csv_refs_campaign_created ON csv_reference_contacts(campaign_slug, created_at DESC)').run();

}

function cleanCsvRefField(input, key, max, multiline=false) {

  const raw=input?.[key]??'';

  if (typeof raw!=='string') throw new Error(`${key} must be text.`);

  const cleaned=raw.normalize('NFC').trim();

  if(cleaned.length>max||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(cleaned))throw new Error(`${key} has invalid content or is too long.`);

  return multiline?cleaned.replace(/\r\n?/g,'\n'):cleaned.replace(/\s+/g,' ');

}

function parseCsvReferenceInput(payload) {

  if (!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Contact data is required.');

  const rec={

    referenceNo:cleanCsvRefField(payload,'referenceNo',60).toUpperCase(),

    personName:cleanCsvRefField(payload,'personName',120),

    companyName:cleanCsvRefField(payload,'companyName',160),

    email:cleanCsvRefField(payload,'email',254).toLowerCase(),

    phone:cleanCsvRefField(payload,'phone',40),

    jobTitle:cleanCsvRefField(payload,'jobTitle',120),

    website:cleanCsvRefField(payload,'website',200),

    notes:cleanCsvRefField(payload,'notes',500,true),

    sourceFile:cleanCsvRefField(payload,'sourceFile',100)

  };

  if(!REF_NUM_RE.test(rec.referenceNo))throw new Error('Reference number must be 1–60 characters (A-Z, 0-9, dot, dash or underscore).');

  if(!rec.personName&&!rec.companyName)throw new Error('Person name or company name is required.');

  if(rec.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email))throw new Error('Invalid email address.');

  if(rec.phone&&!/^[+\d][\d\s()./\-]{6,39}$/.test(rec.phone))throw new Error('Invalid phone number.');

  if(rec.website&&!/^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d{2,5})?(?:\/[^\s]*)?$/i.test(rec.website))throw new Error('Invalid website URL.');

  return rec;

}

async function csvReferenceBody(request, cors) {

  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return {err:json({error:'JSON required.'},415,cors)};

  if(Number(request.headers.get('Content-Length')||0)>7000)return {err:json({error:'Request too large.'},413,cors)};

  const raw=await request.text();

  if(raw.length>7000)return {err:json({error:'Request too large.'},413,cors)};

  try{return {rec:parseCsvReferenceInput(JSON.parse(raw))};}

  catch(error){return {err:json({error:error.message||'Invalid reference contact.'},400,cors)};}

}

function mapCsvReference(row){return {

  id:row.id,referenceNo:row.reference_no,personName:row.person_name,

  companyName:row.company_name,email:row.email,phone:row.phone,

  jobTitle:row.job_title,website:row.website,notes:row.notes,

  sourceFile:row.source_file,createdAt:row.created_at,updatedAt:row.updated_at

};}

function exportCsvReferences(env,campaign,cors) {

  const cols=['reference_no','person_name','company_name','email','phone','job_title','website','notes','source_file','created_at'];

  let offset=0;

  const stream=new ReadableStream({

    start(controller){controller.enqueue(encoder.encode('\ufeff'+cols.join(',')+'\r\n'));},

    async pull(controller){

      try{

        const result=await env.DB.prepare(`SELECT ${cols.join(',')} FROM csv_reference_contacts WHERE campaign_slug=? ORDER BY created_at DESC,id DESC LIMIT 200 OFFSET ?`).bind(campaign,offset).all();

        const rows=result.results||[];

        if(!rows.length){controller.close();return;}

        offset+=rows.length;

        controller.enqueue(encoder.encode(rows.map(row=>cols.map(col=>csvCell(row[col])).join(',')+'\r\n').join('')));

      }catch(err){controller.error(err);}

    }

  });

  return new Response(stream,{status:200,headers:{...cors,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="references-${campaign}.csv"`}});

}

async function handleCsvReferenceApi(request,env,cors,pathname) {

  if(!await isAdmin(request,env))return json({error:'Invalid admin token.'},401,cors);

  const prefix='/api/admin/references';

  const extra=pathname.slice(prefix.length);

  const id=extra.startsWith('/')?extra.slice(1):'';

  const exportRequested=id==='export.csv';

  if(id&&!exportRequested&&!REF_ID_RE.test(id))return json({error:'Invalid reference contact ID.'},400,cors);

  await ensureCsvReferencesTable(env);

  const campaign=await scopedEventSlug(env,request);

  if(!id&&request.method==='GET'){

    const [count,found]=await Promise.all([

      env.DB.prepare('SELECT COUNT(*) AS total FROM csv_reference_contacts WHERE campaign_slug=?').bind(campaign).first(),

      env.DB.prepare('SELECT * FROM csv_reference_contacts WHERE campaign_slug=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(campaign).all()

    ]);

    return json({total:Number(count?.total||0),items:(found.results||[]).map(mapCsvReference)},200,cors);

  }

  if(exportRequested&&request.method==='GET')return exportCsvReferences(env,campaign,cors);

  if(!id&&request.method==='POST'){

    const {rec,err}=await csvReferenceBody(request,cors);if(err)return err;

    const now=new Date().toISOString();const uid=crypto.randomUUID();

    try{

      await env.DB.prepare(`INSERT INTO csv_reference_contacts

        (id,campaign_slug,reference_no,person_name,company_name,email,phone,job_title,website,notes,source_file,created_at,updated_at)

        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uid,campaign,rec.referenceNo,rec.personName,rec.companyName,rec.email,rec.phone,rec.jobTitle,rec.website,rec.notes,rec.sourceFile,now,now).run();

    }catch(error){
// A duplicate ref must not overwrite a previous reference or its contact.

      if(/unique|constraint/i.test(String(error?.message||'')))return json({error:'Reference number already exists.'},409,cors);

      throw error;

    }

    return json({ok:true,id:uid,referenceNo:rec.referenceNo},201,cors);

  }

  if(id&&!exportRequested&&request.method==='DELETE'){

    const result=await env.DB.prepare('DELETE FROM csv_reference_contacts WHERE id=? AND campaign_slug=?').bind(id,campaign).run();

    if(Number(result.meta?.changes||0)===0)return json({error:'Reference not found.'},404,cors);

    return json({ok:true},200,cors);

  }

  return json({error:'Method not allowed.'},405,cors);

}

export default {

  async fetch(request, env, ctx) {

    const siteOrigin = getSiteOrigin(env);

    if (!siteOrigin || !CAMPAIGN_PATTERN.test(env.CAMPAIGN_SLUG || "")) {

      return json({ error: "Worker configuration incomplete: update SITE_ORIGIN and CAMPAIGN_SLUG." }, 503, { "Cache-Control": "no-store" });

    }

    const requestOrigin = request.headers.get("Origin");

    const originAllowed = requestOrigin === siteOrigin || EXTRA_ALLOWED_ORIGINS.has(requestOrigin);
// Echo only a trusted request origin. Do not use wildcard CORS for admin endpoints.

    const cors = headersFor(originAllowed ? requestOrigin : siteOrigin);

    const url = new URL(request.url);

    const pathname = url.pathname.replace(/\/$/, "") || "/";

    if (pathname === "/api/health" && request.method === "GET") {

      return json({ ok: true, service: "qr-referral-api" }, 200, cors);

    }

    if (!originAllowed) {

      return json({ error: "Origin not allowed." }, 403, { "Cache-Control": "no-store" });

    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (!env.DB) return json({ error: "D1 database not configured." }, 503, cors);

    try {
// Read-only public activity: issue dates and totals only, no identifying information.
// A pass issued is not proof that an offer was redeemed.

      if (pathname === "/api/public/event" && request.method === "GET") {
        const slug = eventSlugFrom(url, env);
        const event = await requireValidEvent(env, slug);
        return json({ slug: event.slug, name: event.name }, 200, cors);
      }
      if (pathname === "/api/public/activity" && request.method === "GET") {
        const campaign = eventSlugFrom(url, env);
        await requireValidEvent(env, campaign);
        const [count, rows] = await Promise.all([

          env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ?").bind(campaign).first(),

          env.DB.prepare("SELECT created_at AS issuedAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 6").bind(campaign).all()

        ]);

        return json({ total: Number(count?.total || 0), recent: (rows.results || []).map(row => ({ issuedAt: row.issuedAt })) }, 200, cors);

      }

      if (pathname === "/api/referrals" && request.method === "POST") {

        if (typeof env.VISITOR_SECRET !== "string" || env.VISITOR_SECRET.length < 32) {

          return json({ error: "Visitor secret is not configured." }, 503, cors);

        }

        if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {

          return json({ error: "JSON body required." }, 415, cors);

        }

        if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "Request too large." }, 413, cors);

        const raw = await request.text();

        if (raw.length > 4096) return json({ error: "Request too large." }, 413, cors);

        let data;

        try {

          data = JSON.parse(raw);

        } catch {

          return json({ error: "Invalid JSON." }, 400, cors);

        }

        if (!validId.test(data?.visitorId || "") ||
            typeof data?.campaign !== "string" || !EVENT_SLUG_PATTERN.test(data.campaign) || data.campaign.length > 80) {
          return json({ error: "Invalid campaign or visitor ID." }, 400, cors);
        }
        // Never silently fall back to the original event for invalid/new QR links.
        const campaign = data.campaign;
        await requireValidEvent(env, campaign);
        const registrationSource = data?.source === "qr" ? "qr" : "direct";

        const fullName = normalizedName(data?.fullName);

        const mobileNumber = normalizedPhone(data?.mobileNumber);

        const email = normalizedEmail(data?.email);

        if (!fullName) return json({ error: "Please enter your full name (2–100 characters)." }, 400, cors);

        if (!mobileNumber) return json({ error: "Enter a valid mobile number, such as 0501234567 or +971501234567." }, 400, cors);

        if (email === null) return json({ error: "Email address is required. Please enter a valid email address." }, 400, cors);

        if (data?.consent !== true) return json({ error: "Please agree to the referral contact and data terms." }, 400, cors);

        const result = await issueCode(env, campaign, data.visitorId, fullName, mobileNumber, email, registrationSource);

        if (result.conflict) return json(conflict(), 409, cors);
// Return the referral code immediately. Email is sent separately in
// the Cloudflare Worker background and cannot delay registration.

        if (!result.reused && typeof result.email === "string" && result.email) {

          ctx.waitUntil(sendThankYouEmail(env, result).catch(error => {
// The code is already issued; email failures must not change it.

            console.error("HNS thank-you email delivery request failed", error?.name || "Error");

          }));

        }

        return json(result, result.reused ? 200 : 201, cors);

      }
// Private business cards: camera OCR only runs in the admin browser;
// this endpoint receives contact details after an admin reviews them.
// Private CSV-imported references are stored in their own D1 table.

      if (pathname === "/api/admin/references" || pathname.startsWith("/api/admin/references/")) {

        return await handleCsvReferenceApi(request, env, cors, pathname);

      }

      if (pathname === "/api/admin/business-cards" || pathname.startsWith("/api/admin/business-cards/")) {

        return await handleBusinessCardApi(request, env, cors, pathname);

      }

      if (pathname.startsWith("/api/admin/") && request.method === "GET") {

        if (!await isAdmin(request, env)) return json({ error: "Invalid admin token." }, 401, cors);

        if (pathname === "/api/admin/stats") {
          const campaign = await scopedEventSlug(env, request);
          return await eventAdminStats(env, campaign, cors);
        }

        if (pathname === "/api/admin/export.csv") {

          const campaign = await scopedEventSlug(env, request);
          return exportCsv(env, campaign, cors, url.searchParams.get("source") === "qr", await hasRegistrationSource(env));

        }

      }

      return json({ error: "Not found." }, 404, cors);

    } catch (error) {
      if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
        return json({ error: error.message || "Invalid request." }, error.status, cors);
      }
      console.error("Referral API error:", error?.message || "Unknown error");

      return json({ error: "Unexpected server or database error." }, 500, cors);

    }

  }

};
