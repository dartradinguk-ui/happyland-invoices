import nodemailer from 'nodemailer';

/**
 * Helper to create a Nodemailer transporter for Gmail SMTP
 */
function createGmailTransporter(gmailUser, gmailAppPassword) {
  const cleanUser = (gmailUser || '').trim();
  // Google displays 16-character App Passwords with spaces (e.g. "abcd efgh ijkl mnop").
  // Strip any spaces so pasting directly from Google works seamlessly.
  const cleanPass = (gmailAppPassword || '').replace(/\s+/g, '');

  if (!cleanUser || !cleanPass) {
    const err = new Error('Gmail address and 16-character App Password are required.');
    err.code = 'GMAIL_NOT_CONFIGURED';
    throw err;
  }

  return {
    cleanUser,
    cleanPass,
    transporter: nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: cleanUser,
        pass: cleanPass
      }
    })
  };
}

/**
 * Verifies that the Gmail address and App Password can log in to smtp.gmail.com
 */
export async function verifyGmailCredentials({ gmailUser, gmailAppPassword }) {
  const { cleanUser, transporter } = createGmailTransporter(gmailUser, gmailAppPassword);
  try {
    await transporter.verify();
    return {
      success: true,
      user: cleanUser,
      message: `Connected to ${cleanUser} successfully!`
    };
  } catch (err) {
    const rawMsg = err.message || '';
    if (rawMsg.includes('535') || rawMsg.includes('Username and Password not accepted') || rawMsg.includes('Invalid login')) {
      throw new Error(
        'Gmail rejected the login. Please make sure 2-Step Verification is ON in your Google Account and you are using a 16-character Google "App Password" (not your regular Gmail password).'
      );
    }
    throw new Error(`Gmail connection failed: ${rawMsg}`);
  }
}

/**
 * Sends an invoice email with the PDF attached directly through the bakery's Gmail account.
 * Gmail automatically saves a copy in the account's "Sent" folder.
 */
export async function sendInvoiceViaGmail({
  gmailUser,
  gmailAppPassword,
  senderName,
  toEmail,
  toName,
  ccEmail,
  bccEmail,
  subject,
  textContent,
  htmlContent,
  attachmentName,
  attachmentBase64
}) {
  const { cleanUser, transporter } = createGmailTransporter(gmailUser, gmailAppPassword);

  const safeSenderName = (senderName || 'Happyland Bakery Ltd').replace(/"/g, '');
  const safeToName = (toName || '').replace(/"/g, '');
  const cleanTo = (toEmail || '').trim();

  if (!cleanTo) {
    throw new Error('Customer email address (To:) is required.');
  }

  const mailOptions = {
    from: `"${safeSenderName}" <${cleanUser}>`,
    to: safeToName ? `"${safeToName}" <${cleanTo}>` : cleanTo,
    subject: subject,
    text: textContent,
    html: htmlContent
  };

  if (ccEmail && ccEmail.trim()) {
    mailOptions.cc = ccEmail.trim();
  }

  if (bccEmail && bccEmail.trim()) {
    mailOptions.bcc = bccEmail.trim();
  }

  if (attachmentBase64 && attachmentName) {
    const cleanBase64 = attachmentBase64.replace(/^data:application\/pdf;base64,/, '');
    mailOptions.attachments = [
      {
        filename: attachmentName,
        content: cleanBase64,
        encoding: 'base64',
        contentType: 'application/pdf'
      }
    ];
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      from: cleanUser,
      to: cleanTo
    };
  } catch (err) {
    const rawMsg = err.message || '';
    if (rawMsg.includes('535') || rawMsg.includes('Username and Password not accepted') || rawMsg.includes('Invalid login')) {
      throw new Error(
        'Gmail rejected the login. Please check your Gmail address and 16-character Google App Password in Settings ⚙️.'
      );
    }
    throw new Error(`Gmail failed to send: ${rawMsg}`);
  }
}
