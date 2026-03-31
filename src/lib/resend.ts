export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

export const sendEmail = async (options: EmailOptions) => {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to send email');
      }
      return data;
    } else {
      const text = await response.text();
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (error: any) {
    console.error('Email failed:', error);
    throw error;
  }
};
