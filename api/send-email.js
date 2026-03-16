const { Resend } = require('resend');

// Support both standard and VITE prefixed env vars for local/production consistency
const apiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
const resend = new Resend(apiKey);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!apiKey) {
    console.error("Missing Resend API Key");
    return res.status(500).json({ error: 'Email service configuration missing (API Key)' });
  }

  const { to, subject, html } = req.body;

  try {
    const data = await resend.emails.send({
      from: 'EduIntellect <onboarding@resend.dev>',
      to,
      subject,
      html,
    });

    res.status(200).json(data);
  } catch (error) {
    console.error("Resend Error:", error);
    res.status(500).json({ error: error.message });
  }
};
