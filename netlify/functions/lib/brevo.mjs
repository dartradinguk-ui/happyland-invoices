/**
 * Brevo (formerly Sendinblue) Transactional Email Client
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 */

export async function sendInvoiceEmail({
  apiKey,
  senderName,
  senderEmail,
  toEmail,
  toName,
  ccEmail,
  bccEmail,
  subject,
  htmlContent,
  textContent,
  attachmentName,
  attachmentBase64
}) {
  if (!apiKey || apiKey === 'demo' || apiKey === 'placeholder') {
    return {
      success: true,
      simulated: true,
      message: 'Email simulated (BREVO_API_KEY is not configured yet in Netlify). In production, configure BREVO_API_KEY in Netlify settings.'
    };
  }

  const payload = {
    sender: {
      name: senderName || 'Happyland Bakery Ltd',
      email: senderEmail
    },
    to: [
      {
        email: toEmail,
        name: toName || toEmail
      }
    ],
    subject: subject,
    htmlContent: htmlContent,
    textContent: textContent
  };

  if (ccEmail && ccEmail.trim()) {
    payload.cc = [{ email: ccEmail.trim() }];
  }

  if (bccEmail && bccEmail.trim()) {
    payload.bcc = [{ email: bccEmail.trim() }];
  }

  if (attachmentBase64 && attachmentName) {
    // Brevo requires clean base64 string without data URI prefix
    const cleanBase64 = attachmentBase64.replace(/^data:application\/pdf;base64,/, '');
    payload.attachment = [
      {
        name: attachmentName,
        content: cleanBase64
      }
    ];
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = responseData.message || responseData.code || response.statusText || 'Failed to send email';
    const error = new Error(`Brevo API error (${response.status}): ${errorMsg}`);
    error.status = response.status;
    error.details = responseData;
    throw error;
  }

  return {
    success: true,
    messageId: responseData.messageId,
    simulated: false
  };
}
