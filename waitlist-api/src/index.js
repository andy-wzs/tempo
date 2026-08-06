/**
 * Tempo Waitlist API — Cloudflare Worker
 *
 * Proxies waitlist signups to the Resend API so the API key
 * is never exposed to the browser.
 *
 * Environment / Secrets (set via wrangler.toml + `wrangler secret put`):
 *   RESEND_API_KEY      — Resend API key, full access (secret)
 *   UNSUBSCRIBE_SECRET  — random string used to sign unsubscribe links (secret)
 *   ALLOWED_ORIGIN      — e.g. https://tempohabit.app (var)
 *   FROM_EMAIL          — sender address (var)
 *   RESEND_AUDIENCE_ID  — audience that stores signups (var)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Unsubscribe ──
    // GET  = the footer link a human clicks.
    // POST = Gmail/Apple one-click, via the List-Unsubscribe-Post header.
    if (url.pathname === '/unsubscribe') {
      return handleUnsubscribe(request, url, env);
    }

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    // ── Only accept POST ──
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, env);
    }

    // ── Parse body ──
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, env);
    }

    const email = (body.email || '').trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return json({ error: 'A valid email is required' }, 400, env);
    }

    // ── Save to the audience so we can email everyone at launch ──
    // Deliberately non-fatal: a failure here must not cost us the signup.
    if (env.RESEND_AUDIENCE_ID) {
      try {
        const contactRes = await fetch(
          `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, unsubscribed: false }),
          },
        );

        if (!contactRes.ok) {
          const data = await contactRes.json().catch(() => ({}));
          console.error('Audience add failed:', JSON.stringify(data));
        }
      } catch (err) {
        console.error('Audience add error:', err);
      }
    } else {
      console.error('RESEND_AUDIENCE_ID is not set — signup not stored!');
    }

    // ── Send welcome email via Resend ──
    const unsubUrl = await unsubscribeUrl(request, email, env);

    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Tempo <${env.FROM_EMAIL}>`,
          to: [email],
          subject: 'Welcome to the Tempo Waitlist! 🎉',
          html: welcomeEmailHtml(unsubUrl),
          // Lets Gmail/Apple render their native one-click unsubscribe.
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });

      if (!resendRes.ok) {
        const data = await resendRes.json().catch(() => ({}));
        console.error('Resend error:', JSON.stringify(data));
        return json(
          { error: data.message || 'Failed to send email' },
          resendRes.status >= 500 ? 502 : 422,
          env,
        );
      }

      return json({ success: true, message: "You're on the list!" }, 200, env);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal server error' }, 500, env);
    }
  },
};

// ── Helpers ──

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

// ── Unsubscribe ──

/**
 * Links are HMAC-signed so one person cannot unsubscribe another by
 * editing the address in the URL.
 */
async function signEmail(email, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.UNSUBSCRIBE_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function unsubscribeUrl(request, email, env) {
  const token = await signEmail(email, env);
  const base = new URL(request.url).origin;
  return `${base}/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

async function handleUnsubscribe(request, url, env) {
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  const token = url.searchParams.get('t') || '';

  if (!email || !token) return unsubscribePage('That link is missing information.');

  const expected = await signEmail(email, env);
  // Length-safe comparison; both sides are fixed-length hex digests.
  if (token !== expected) return unsubscribePage('That unsubscribe link is not valid.');

  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ unsubscribed: true }),
      },
    );

    if (!res.ok) {
      console.error('Unsubscribe failed:', JSON.stringify(await res.json().catch(() => ({}))));
      return unsubscribePage('Something went wrong. Please email andy@tempohabit.app.');
    }
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return unsubscribePage('Something went wrong. Please email andy@tempohabit.app.');
  }

  return unsubscribePage("You've been unsubscribed. You won't hear from Tempo again.");
}

function unsubscribePage(message) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
     <meta name="viewport" content="width=device-width, initial-scale=1" />
     <title>Tempo — Unsubscribe</title></head>
     <body style="margin:0;background:#0a0a0a;color:#f5f3f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
       <div style="text-align:center;padding:40px 24px;max-width:420px;">
         <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;">Tempo</h1>
         <p style="font-size:16px;line-height:1.6;color:#b8b2aa;margin:0;">${message}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function welcomeEmailHtml(unsubUrl) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px;">
      <h1 style="font-size: 28px; font-weight: 800; color: #1a1a1a; margin-bottom: 16px;">You're on the Tempo Waitlist!</h1>
      <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 20px;">
        Thanks for signing up! You'll be among the first to experience Tempo — a calm, beautiful habit tracker designed to help you build better habits.
      </p>
      <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 20px;">
        We're putting the finishing touches on Tempo. When it's ready, you'll get an exclusive early access link straight to your inbox.
      </p>
      <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 32px;">
        In the meantime, follow us on <a href="https://www.instagram.com/tempohabit.app/" style="color: #2563eb; text-decoration: none; font-weight: 600;">Instagram</a> and <a href="https://www.tiktok.com/@tempohabit.app" style="color: #2563eb; text-decoration: none; font-weight: 600;">TikTok</a> for sneak peeks and updates.
      </p>
      <p style="font-size: 14px; color: #999; line-height: 1.5;">
        — Andy, creator of Tempo
      </p>
      <p style="font-size: 12px; color: #aaa; line-height: 1.5; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
        You're receiving this because you joined the Tempo waitlist.
        <a href="${unsubUrl}" style="color: #888;">Unsubscribe</a>
      </p>
    </div>
  `;
}
