/** Helen & Sons QR referral API — Pages and GitHub CORS login fix.
 * Required bindings: DB (D1), CAMPAIGN_SLUG, SITE_ORIGIN,
 * ADMIN_TOKEN and VISITOR_SECRET (both secret variables).
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function issueCode(env, campaign, visitorId, fullName, mobileNumber, email) {
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
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO referrals (campaign_slug, code, visitor_hash, created_at, full_name, mobile_number, email) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(campaign, code, visitor, createdAt, fullName, mobileNumber, email).run();

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

function csvCell(value) {
  let str = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(str)) str = "'" + str;
  return `"${str.replaceAll('"', '""')}"`;
}

function exportCsv(env, campaign, corsHeaders) {
  let cursor = Number.MAX_SAFE_INTEGER;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("\uFEFFcode,full_name,mobile_number,email,campaign,created_at\r\n"));
    },
    async pull(controller) {
      try {
        const result = await env.DB.prepare(
          "SELECT id, code, full_name, mobile_number, email, campaign_slug, created_at FROM referrals WHERE campaign_slug = ? AND id < ? ORDER BY id DESC LIMIT 500"
        ).bind(campaign, cursor).all();
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

export default {
  async fetch(request, env) {
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
      if (pathname === "/api/public/activity" && request.method === "GET") {
        const [count, rows] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ?").bind(env.CAMPAIGN_SLUG).first(),
          env.DB.prepare("SELECT created_at AS issuedAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 6").bind(env.CAMPAIGN_SLUG).all()
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

        if (data?.campaign !== env.CAMPAIGN_SLUG || !validId.test(data?.visitorId || "")) {
          return json({ error: "Invalid campaign or visitor ID." }, 400, cors);
        }

        const fullName = normalizedName(data?.fullName);
        const mobileNumber = normalizedPhone(data?.mobileNumber);
        const email = normalizedEmail(data?.email);
        if (!fullName) return json({ error: "Please enter your full name (2–100 characters)." }, 400, cors);
        if (!mobileNumber) return json({ error: "Enter a valid mobile number, such as 0501234567 or +971501234567." }, 400, cors);
        if (email === null) return json({ error: "Email address is required. Please enter a valid email address." }, 400, cors);
        if (data?.consent !== true) return json({ error: "Please agree to the referral contact and data terms." }, 400, cors);

        const result = await issueCode(env, env.CAMPAIGN_SLUG, data.visitorId, fullName, mobileNumber, email);
        if (result.conflict) return json(conflict(), 409, cors);
        return json(result, result.reused ? 200 : 201, cors);
      }

      if (pathname.startsWith("/api/admin/") && request.method === "GET") {
        if (!await isAdmin(request, env)) return json({ error: "Invalid admin token." }, 401, cors);

        if (pathname === "/api/admin/stats") {
          const totalResult = await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE campaign_slug = ?")
            .bind(env.CAMPAIGN_SLUG).first();
          const recentResult = await env.DB.prepare(
            "SELECT code, full_name AS fullName, mobile_number AS mobileNumber, email, created_at AS createdAt FROM referrals WHERE campaign_slug = ? ORDER BY id DESC LIMIT 100"
          ).bind(env.CAMPAIGN_SLUG).all();
          return json({ campaign: env.CAMPAIGN_SLUG, total: Number(totalResult?.total ?? 0), recent: recentResult.results ?? [] }, 200, cors);
        }

        if (pathname === "/api/admin/export.csv") {
          return exportCsv(env, env.CAMPAIGN_SLUG, cors);
        }
      }

      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      console.error("Referral API error:", error?.message || "Unknown error");
      return json({ error: "Unexpected server or database error." }, 500, cors);
    }
  }
};
