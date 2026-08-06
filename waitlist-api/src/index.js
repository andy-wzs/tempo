/**
 * Tempo Waitlist API — Cloudflare Worker
 *
 * Proxies waitlist signups to the Resend API so the API key
 * is never exposed to the browser.
 *
 * Environment / Secrets (set via wrangler.toml + `wrangler secret put`):
 *   RESEND_API_KEY   — Resend API key (secret)
 *   ALLOWED_ORIGIN   — e.g. https://tempohabit.app (var)
 *   FROM_EMAIL       — sender address (var)
 */

export default {
  async fetch(request, env) {
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

    // ── Send welcome email via Resend ──
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
          html: welcomeEmailHtml(),
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function welcomeEmailHtml() {
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
    </div>
  `;
}
