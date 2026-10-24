import { getStore } from '@netlify/blobs';
import { sendInvoiceViaGmail, verifyGmailCredentials } from './lib/gmail.mjs';
import fs from 'node:fs';
import path from 'node:path';

// --- CONFIGURATION & ENV ---
const STAFF_PIN = process.env.STAFF_PIN || '1234';
const ADMIN_PIN = process.env.ADMIN_PIN || '9999';
const ENV_GMAIL_USER = process.env.GMAIL_USER || process.env.SMTP_USER || '';
const ENV_GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';

// --- SEED DEFAULTS ---
const DEFAULT_SETTINGS = {
  businessName: 'Happyland Bakery Ltd',
  accountNumber: '30623245',
  sortCode: '20-92-60',
  gmailUser: ENV_GMAIL_USER,
  gmailAppPassword: '',
  bccEmail: '',
  emailSubject: 'Invoice #{invoiceNo} – Happyland Bakery – Week ending {weekEnding}',
  emailBody: `Dear {customer},

Please find attached your invoice #{invoiceNo} for the week ending {weekEnding}.

Total due: £{total}

Payment Details:
Bank: Happyland Bakery Ltd
Account Number: 30623245
Sort Code: 20-92-60

Thank you for your business,
Happyland Bakery Ltd`,
  nextInvoiceNo: 1001
};

const DEFAULT_CUSTOMERS = [
  { id: 'cust_1', name: 'Mayyil 1 - Knightsbridge', email: '', ccEmail: '', address: 'Knightsbridge, London', archived: false },
  { id: 'cust_2', name: 'Mayyil 2 - Notting Hill Gate', email: '', ccEmail: '', address: 'Notting Hill Gate, London', archived: false },
  { id: 'cust_3', name: 'Mayyil on the Wheel - Park Royal', email: '', ccEmail: '', address: 'Park Royal, London', archived: false },
  { id: 'cust_4', name: 'Beit El Zaytoun Park Royal', email: '', ccEmail: '', address: 'Park Royal, London', archived: false }
];

const DEFAULT_ITEMS = [
  { id: 'item_1', name: 'Baguette', price: 0.55, order: 1, active: true, archived: false },
  { id: 'item_2', name: 'Burger Bun', price: 0.55, order: 2, active: true, archived: false },
  { id: 'item_3', name: 'Lebanese Bread Small', price: 0.30, order: 3, active: true, archived: false },
  { id: 'item_4', name: 'Lebanese Bread Large', price: 0.50, order: 4, active: true, archived: false }
];

// --- GMAIL CONFIG HELPER ---
function getGmailConfig(settings = {}) {
  const gmailUser = (settings.gmailUser || ENV_GMAIL_USER || '').trim();
  const gmailAppPassword = (settings.gmailAppPassword || ENV_GMAIL_PASS || '').replace(/\s+/g, '');
  return {
    gmailUser,
    gmailAppPassword,
    hasGmailConfigured: Boolean(gmailUser && gmailAppPassword)
  };
}

function sanitizeSettingsForClient(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const { gmailUser, hasGmailConfigured } = getGmailConfig(merged);
  const { gmailAppPassword, ...safeSettings } = merged;
  return {
    ...safeSettings,
    gmailUser,
    hasGmailConfigured
  };
}

function cleanPdfBase64(str) {
  if (!str) return null;
  let s = str;
  const commaIdx = s.indexOf(',');
  if (s.startsWith('data:') && commaIdx !== -1) {
    s = s.slice(commaIdx + 1);
  }
  return s.replace(/\s+/g, '');
}

// --- STORAGE ADAPTER (Netlify Blobs with Local File/Memory Fallback) ---
let localStoreCache = null;
const LOCAL_DATA_FILE = path.join(process.cwd(), '.data', 'store.json');

function getLocalData() {
  if (localStoreCache) return localStoreCache;
  try {
    if (fs.existsSync(LOCAL_DATA_FILE)) {
      const raw = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
      localStoreCache = JSON.parse(raw);
      return localStoreCache;
    }
  } catch (e) {
    console.warn('Could not read local data file:', e.message);
  }
  localStoreCache = {
    settings: { ...DEFAULT_SETTINGS },
    customers: [...DEFAULT_CUSTOMERS],
    items: [...DEFAULT_ITEMS],
    invoices: []
  };
  return localStoreCache;
}

function saveLocalData(data) {
  localStoreCache = data;
  try {
    const dir = path.dirname(LOCAL_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save local data file:', e.message);
  }
}

async function getStoreData() {
  try {
    // Try Netlify Blobs first
    const store = getStore({ name: 'happyland', consistency: 'strong' });
    const remoteData = await store.get('database', { type: 'json' });
    if (remoteData) return { store, data: remoteData, isRemote: true };
    
    // First time initializing remote store
    const initial = {
      settings: { ...DEFAULT_SETTINGS },
      customers: [...DEFAULT_CUSTOMERS],
      items: [...DEFAULT_ITEMS],
      invoices: []
    };
    await store.setJSON('database', initial);
    return { store, data: initial, isRemote: true };
  } catch (err) {
    // Fallback to local store when Netlify Blobs environment is unavailable
    const localData = getLocalData();
    return { store: null, data: localData, isRemote: false };
  }
}

async function saveStoreData(storeWrapper, data) {
  if (storeWrapper && storeWrapper.isRemote && storeWrapper.store) {
    await storeWrapper.store.setJSON('database', data);
  } else {
    saveLocalData(data);
  }
}

// --- AUTH HELPER (PIN-free / easy role toggle) ---
function verifyAuth(req) {
  const pin = req.headers.get('x-pin') || '';
  const roleHeader = req.headers.get('x-role') || '';
  if (roleHeader === 'admin' || pin === ADMIN_PIN || pin === 'admin') {
    return { authenticated: true, role: 'admin' };
  }
  if (roleHeader === 'staff' || pin === STAFF_PIN || pin === 'staff') {
    return { authenticated: true, role: 'staff' };
  }
  return { authenticated: true, role: 'admin' };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pin, X-Role',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  });
}

// --- MAIN REQUEST HANDLER ---
export default async (req, context) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }

  const url = new URL(req.url);
  // Match path after /api/ or /.netlify/functions/api/
  let pathname = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '');
  if (!pathname.startsWith('/')) pathname = '/' + pathname;

  // 1. LOGIN ROUTE
  if (pathname === '/login' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const pin = (body.pin || '').toString().trim();
    if (pin === ADMIN_PIN) {
      return jsonResponse({ success: true, role: 'admin', message: 'Welcome Admin' });
    }
    if (pin === STAFF_PIN) {
      return jsonResponse({ success: true, role: 'staff', message: 'Welcome Staff' });
    }
    return jsonResponse({ success: false, error: 'Invalid PIN. Please check and try again.' }, 401);
  }

  // Auth check
  const auth = verifyAuth(req);
  if (!auth.authenticated) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const storeWrapper = await getStoreData();
  const db = storeWrapper.data;

  // 2. BOOTSTRAP (fetches everything needed for app startup)
  if (pathname === '/bootstrap' && req.method === 'GET') {
    return jsonResponse({
      role: auth.role,
      settings: sanitizeSettingsForClient(db.settings),
      customers: (db.customers || []).filter(c => !c.archived),
      items: (db.items || []).filter(i => !i.archived).sort((a, b) => (a.order || 0) - (b.order || 0)),
      serverTime: new Date().toISOString()
    });
  }

  // 3. CUSTOMERS
  if (pathname === '/customers') {
    if (req.method === 'GET') {
      return jsonResponse({ customers: (db.customers || []).filter(c => !c.archived) });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.name || !body.name.trim()) {
        return jsonResponse({ error: 'Customer name is required' }, 400);
      }
      const newCust = {
        id: 'cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: body.name.trim(),
        email: (body.email || '').trim(),
        ccEmail: (body.ccEmail || '').trim(),
        address: (body.address || '').trim(),
        archived: false,
        createdAt: new Date().toISOString()
      };
      db.customers = db.customers || [];
      db.customers.push(newCust);
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, customer: newCust });
    }
  }

  const custMatch = pathname.match(/^\/customers\/([^\/]+)$/);
  if (custMatch) {
    const custId = custMatch[1];
    const index = (db.customers || []).findIndex(c => c.id === custId);
    if (index === -1) return jsonResponse({ error: 'Customer not found' }, 404);

    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}));
      if (!body.name || !body.name.trim()) {
        return jsonResponse({ error: 'Customer name is required' }, 400);
      }
      db.customers[index] = {
        ...db.customers[index],
        name: body.name.trim(),
        email: (body.email || '').trim(),
        ccEmail: (body.ccEmail || '').trim(),
        address: (body.address || '').trim(),
        updatedAt: new Date().toISOString()
      };
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, customer: db.customers[index] });
    }

    if (req.method === 'DELETE') {
      // Soft delete
      db.customers[index].archived = true;
      db.customers[index].archivedAt = new Date().toISOString();
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, message: 'Customer archived' });
    }
  }

  // 4. ITEMS & PRICES
  if (pathname === '/items') {
    if (req.method === 'GET') {
      return jsonResponse({
        items: (db.items || []).filter(i => !i.archived).sort((a, b) => (a.order || 0) - (b.order || 0))
      });
    }
    if (req.method === 'POST') {
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Switch to Admin mode to add items' }, 403);
      }
      const body = await req.json().catch(() => ({}));
      if (!body.name || !body.name.trim()) return jsonResponse({ error: 'Item name is required' }, 400);
      const price = parseFloat(body.price);
      if (isNaN(price) || price < 0) return jsonResponse({ error: 'Valid price is required' }, 400);

      const maxOrder = (db.items || []).reduce((max, i) => Math.max(max, i.order || 0), 0);
      const newItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: body.name.trim(),
        price: parseFloat(price.toFixed(2)),
        order: maxOrder + 1,
        active: body.active !== false,
        archived: false,
        createdAt: new Date().toISOString()
      };
      db.items = db.items || [];
      db.items.push(newItem);
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, item: newItem });
    }
  }

  const itemMatch = pathname.match(/^\/items\/([^\/]+)$/);
  if (itemMatch) {
    const itemId = itemMatch[1];
    const index = (db.items || []).findIndex(i => i.id === itemId);
    if (index === -1) return jsonResponse({ error: 'Item not found' }, 404);

    if (req.method === 'PUT') {
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Switch to Admin mode to amend item prices or names' }, 403);
      }
      const body = await req.json().catch(() => ({}));
      const updated = { ...db.items[index] };
      if (body.name && body.name.trim()) updated.name = body.name.trim();
      if (body.price !== undefined) {
        const p = parseFloat(body.price);
        if (!isNaN(p) && p >= 0) updated.price = parseFloat(p.toFixed(2));
      }
      if (body.order !== undefined) updated.order = parseInt(body.order, 10);
      if (body.active !== undefined) updated.active = Boolean(body.active);
      updated.updatedAt = new Date().toISOString();

      db.items[index] = updated;
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, item: updated });
    }

    if (req.method === 'DELETE') {
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Switch to Admin mode to delete items' }, 403);
      }
      db.items[index].archived = true;
      db.items[index].archivedAt = new Date().toISOString();
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, message: 'Item archived' });
    }
  }

  // 5. SETTINGS & GMAIL VERIFICATION
  if (pathname === '/settings') {
    if (req.method === 'GET') {
      return jsonResponse({ settings: sanitizeSettingsForClient(db.settings) });
    }
    if (req.method === 'PUT') {
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Switch to Admin mode to update settings' }, 403);
      }
      const body = await req.json().catch(() => ({}));
      const currentSettings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };

      // Preserve existing App Password unless a new one is explicitly provided
      let updatedAppPassword = currentSettings.gmailAppPassword || '';
      if (body.clearGmailPassword) {
        updatedAppPassword = '';
      } else if (
        typeof body.gmailAppPassword === 'string' &&
        body.gmailAppPassword.trim() !== '' &&
        !body.gmailAppPassword.includes('•')
      ) {
        updatedAppPassword = body.gmailAppPassword.replace(/\s+/g, '');
      }

      db.settings = {
        ...currentSettings,
        businessName: body.businessName !== undefined ? body.businessName : currentSettings.businessName,
        accountNumber: body.accountNumber !== undefined ? body.accountNumber : currentSettings.accountNumber,
        sortCode: body.sortCode !== undefined ? body.sortCode : currentSettings.sortCode,
        bccEmail: body.bccEmail !== undefined ? body.bccEmail : currentSettings.bccEmail,
        nextInvoiceNo: body.nextInvoiceNo !== undefined ? body.nextInvoiceNo : currentSettings.nextInvoiceNo,
        gmailUser: body.gmailUser !== undefined ? body.gmailUser.trim() : currentSettings.gmailUser,
        gmailAppPassword: updatedAppPassword,
        updatedAt: new Date().toISOString()
      };

      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, settings: sanitizeSettingsForClient(db.settings) });
    }
  }

  if (pathname === '/settings/test-gmail' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const currentSettings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    const gmailUser = (body.gmailUser || currentSettings.gmailUser || ENV_GMAIL_USER || '').trim();
    const rawPass =
      body.gmailAppPassword && !body.gmailAppPassword.includes('•')
        ? body.gmailAppPassword
        : currentSettings.gmailAppPassword || ENV_GMAIL_PASS || '';
    const gmailAppPassword = rawPass.replace(/\s+/g, '');

    try {
      const res = await verifyGmailCredentials({ gmailUser, gmailAppPassword });
      // Save working credentials automatically
      db.settings = {
        ...currentSettings,
        gmailUser,
        gmailAppPassword,
        updatedAt: new Date().toISOString()
      };
      await saveStoreData(storeWrapper, db);
      return jsonResponse({
        success: true,
        message: res.message,
        settings: sanitizeSettingsForClient(db.settings)
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 400);
    }
  }

  // 6. INVOICES
  if (pathname === '/invoices') {
    if (req.method === 'GET') {
      const list = (db.invoices || []).map(inv => ({
        invoiceNo: inv.invoiceNo,
        company: inv.company,
        customerEmail: inv.customerEmail,
        weekEnding: inv.weekEnding,
        grandTotal: inv.grandTotal,
        createdAt: inv.createdAt,
        sentAt: inv.sentAt,
        sentStatus: inv.sentStatus,
        sentTo: inv.sentTo
      })).reverse();
      return jsonResponse({ invoices: list });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.company || !body.weekEnding || !Array.isArray(body.items)) {
        return jsonResponse({ error: 'Missing required invoice fields (company, weekEnding, items)' }, 400);
      }

      // Sequential atomic counter
      db.settings = db.settings || { ...DEFAULT_SETTINGS };
      const nextNo = db.settings.nextInvoiceNo || 1001;
      db.settings.nextInvoiceNo = nextNo + 1;

      const invoiceRecord = {
        invoiceNo: nextNo,
        company: body.company,
        customerEmail: body.customerEmail || '',
        customerCcEmail: body.customerCcEmail || '',
        customerAddress: body.customerAddress || '',
        weekEnding: body.weekEnding,
        weekEndingFormatted: body.weekEndingFormatted,
        items: body.items,
        grandTotal: parseFloat(body.grandTotal || 0),
        pdfBase64: cleanPdfBase64(body.pdfBase64),
        createdAt: new Date().toISOString(),
        createdBy: auth.role,
        sentAt: null,
        sentStatus: 'saved'
      };

      db.invoices = db.invoices || [];
      db.invoices.push(invoiceRecord);
      await saveStoreData(storeWrapper, db);

      return jsonResponse({ success: true, invoiceNo: nextNo, invoice: invoiceRecord });
    }
  }

  // Clear All Invoice History
  if (pathname === '/invoices/clear' && req.method === 'POST') {
    db.invoices = [];
    await saveStoreData(storeWrapper, db);
    return jsonResponse({ success: true, message: 'All invoice history cleared' });
  }

  // Single Invoice GET & DELETE
  const invMatch = pathname.match(/^\/invoices\/(\d+)$/);
  if (invMatch) {
    const invNo = parseInt(invMatch[1], 10);
    const invoiceIndex = (db.invoices || []).findIndex(i => i.invoiceNo === invNo);

    if (req.method === 'GET') {
      if (invoiceIndex === -1) return jsonResponse({ error: 'Invoice not found' }, 404);
      return jsonResponse({ invoice: db.invoices[invoiceIndex] });
    }

    if (req.method === 'DELETE') {
      if (invoiceIndex === -1) return jsonResponse({ error: 'Invoice not found' }, 404);
      db.invoices.splice(invoiceIndex, 1);
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, message: `Invoice #${invNo} deleted` });
    }
  }

  // 7. SEND INVOICE (1-TAP AUTOMATIC VIA GMAIL OR SHARE SHEET RECORDING)
  const sendMatch = pathname.match(/^\/invoices\/(\d+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    const invNo = parseInt(sendMatch[1], 10);
    const body = await req.json().catch(() => ({}));
    const invoiceIndex = (db.invoices || []).findIndex(i => i.invoiceNo === invNo);
    const invoice = invoiceIndex !== -1 ? db.invoices[invoiceIndex] : null;

    // Mode A: Phone Share Sheet recording only
    if (body.mode === 'share') {
      if (invoiceIndex !== -1) {
        db.invoices[invoiceIndex].sentAt = new Date().toISOString();
        db.invoices[invoiceIndex].sentStatus = 'shared';
        db.invoices[invoiceIndex].sentTo = (body.toEmail || invoice?.customerEmail || '').trim();
        if (body.pdfBase64) db.invoices[invoiceIndex].pdfBase64 = cleanPdfBase64(body.pdfBase64);
        await saveStoreData(storeWrapper, db);
      }
      return jsonResponse({
        success: true,
        invoiceNo: invNo,
        message: `Invoice #${invNo} recorded as shared`
      });
    }

    // Mode B: 1-Tap Direct Send via Bakery's Gmail Account
    const settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    const { gmailUser, gmailAppPassword, hasGmailConfigured } = getGmailConfig(settings);

    if (!hasGmailConfigured) {
      return jsonResponse(
        {
          error: 'Gmail is not configured yet. Please open Settings ⚙️ and enter your Bakery Gmail address and 16-character Google App Password.',
          code: 'GMAIL_NOT_CONFIGURED'
        },
        400
      );
    }

    const toEmail = (body.toEmail || invoice?.customerEmail || '').trim();
    if (!toEmail) {
      return jsonResponse({ error: 'Customer email address (To:) is missing.' }, 400);
    }

    const rawPdfBase64 = body.pdfBase64 || invoice?.pdfBase64;
    const pdfBase64 = cleanPdfBase64(rawPdfBase64);
    if (!pdfBase64) {
      return jsonResponse({ error: 'PDF attachment data is missing.' }, 400);
    }

    const company = body.company || invoice?.company || 'Valued Customer';
    const weekEnding = body.weekEndingFormatted || invoice?.weekEndingFormatted || '';
    const total = Number(body.grandTotal !== undefined ? body.grandTotal : invoice?.grandTotal || 0).toFixed(2);

    const subject = (settings.emailSubject || DEFAULT_SETTINGS.emailSubject)
      .replace(/{invoiceNo}/g, invNo)
      .replace(/{customer}/g, company)
      .replace(/{weekEnding}/g, weekEnding)
      .replace(/{total}/g, total);

    const bodyText = `Dear ${company},

Please find attached your invoice #${invNo} for the week ending ${weekEnding}.

Total due: £${total}

Payment Details:
Bank: ${settings.businessName || 'Happyland Bakery Ltd'}
Account Number: ${settings.accountNumber || '30623245'}
Sort Code: ${settings.sortCode || '20-92-60'}

Thank you for your business,
${settings.businessName || 'Happyland Bakery Ltd'}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; line-height: 1.6;">
        <h2 style="color: #92400e; margin-bottom: 8px;">${settings.businessName || 'Happyland Bakery Ltd'}</h2>
        <p style="white-space: pre-line; margin-top: 0;">${bodyText.replace(/\n/g, '<br/>')}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">
          Invoice #${invNo} attached as PDF: Happyland_Bakery_Invoice_${invNo}.pdf
        </p>
      </div>
    `;

    try {
      await sendInvoiceViaGmail({
        gmailUser,
        gmailAppPassword,
        senderName: settings.businessName || 'Happyland Bakery Ltd',
        toEmail,
        toName: company,
        ccEmail: body.ccEmail || invoice?.customerCcEmail || '',
        bccEmail: settings.bccEmail || '',
        subject,
        textContent: bodyText,
        htmlContent,
        attachmentName: `Happyland_Bakery_Invoice_${invNo}.pdf`,
        attachmentBase64: pdfBase64
      });

      if (invoiceIndex !== -1) {
        db.invoices[invoiceIndex].sentAt = new Date().toISOString();
        db.invoices[invoiceIndex].sentStatus = 'sent';
        db.invoices[invoiceIndex].sentTo = toEmail;
        if (pdfBase64) db.invoices[invoiceIndex].pdfBase64 = pdfBase64;
        await saveStoreData(storeWrapper, db);
      }

      return jsonResponse({
        success: true,
        invoiceNo: invNo,
        sentTo: toEmail,
        from: gmailUser,
        message: `✅ Invoice #${invNo} emailed to ${toEmail}!`
      });
    } catch (err) {
      console.error('Gmail send error:', err);
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // 8. BACKUP EXPORT & IMPORT (ADMIN ONLY)
  if (pathname === '/backup/export' && req.method === 'GET') {
    if (auth.role !== 'admin') return jsonResponse({ error: 'Switch to Admin mode to export backup' }, 403);
    return jsonResponse({
      exportedAt: new Date().toISOString(),
      database: db
    });
  }

  if (pathname === '/backup/import' && req.method === 'POST') {
    if (auth.role !== 'admin') return jsonResponse({ error: 'Switch to Admin mode to import backup' }, 403);
    const body = await req.json().catch(() => ({}));
    if (!body.database) return jsonResponse({ error: 'Invalid backup file payload' }, 400);

    const imported = body.database;
    db.settings = imported.settings || db.settings;
    db.customers = imported.customers || db.customers;
    db.items = imported.items || db.items;
    db.invoices = imported.invoices || db.invoices;

    await saveStoreData(storeWrapper, db);
    return jsonResponse({ success: true, message: 'Backup restored successfully' });
  }

  return jsonResponse({ error: `Route not found: ${pathname}` }, 404);
};
