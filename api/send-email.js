export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html } = req.body;
  const apiKey = process.env.VITE_RESEND_API_KEY || process.env.RESEND_API_KEY || "re_KgGiVQA2_Me1JyuWkb2bC2tcUzASqwz8u";

  if (!apiKey) {
    console.error("[PRODUCTION_EMAIL] Error: Missing Resend API Key");
    return res.status(500).json({ error: 'Email service configuration missing' });
  }

  try {
    console.log(`[PRODUCTION_EMAIL] Sending to: ${to} via edulent.dgion.com...`);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'EduIntellect <invite@edulent.dgion.com>',
        to,
        subject,
        html,
      }),
    });

    const data = await response.json();
    console.log("[PRODUCTION_EMAIL] Resend API Response:", response.status, data);

    if (response.ok) {
      return res.status(200).json(data);
    } else {
      return res.status(response.status).json({ error: data.message || 'Resend API Error' });
    }
  } catch (error) {
    console.error('[PRODUCTION_EMAIL] Fatal Exception:', error);
    return res.status(500).json({ error: error.message });
  }
}
