import { getStore } from '@netlify/blobs';
import { sendInvoiceEmail } from './lib/brevo.mjs';
import fs from 'node:fs';
import path from 'node:path';

// --- CONFIGURATION & ENV ---
const STAFF_PIN = process.env.STAFF_PIN || '1234';
const ADMIN_PIN = process.env.ADMIN_PIN || '9999';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'invoices@happylandbakery.co.uk';
const SENDER_NAME = process.env.SENDER_NAME || 'Happyland Bakery Ltd';
const BCC_EMAIL = process.env.BCC_EMAIL || '';

// --- SEED DEFAULTS ---
const DEFAULT_SETTINGS = {
  businessName: 'Happyland Bakery Ltd',
  accountNumber: '30623245',
  sortCode: '20-92-60',
  senderEmail: SENDER_EMAIL,
  senderName: SENDER_NAME,
  bccEmail: BCC_EMAIL,
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

// --- AUTH HELPER ---
function verifyAuth(req) {
  const pin = req.headers.get('x-pin') || '';
  if (pin === ADMIN_PIN) return { authenticated: true, role: 'admin' };
  if (pin === STAFF_PIN) return { authenticated: true, role: 'staff' };
  return { authenticated: false, role: null };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
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

  // 1. LOGIN ROUTE (no pin header required)
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

  // Auth check for all other routes
  const auth = verifyAuth(req);
  if (!auth.authenticated) {
    return jsonResponse({ error: 'Unauthorized: Invalid or missing PIN' }, 401);
  }

  const storeWrapper = await getStoreData();
  const db = storeWrapper.data;

  // 2. BOOTSTRAP (fetches everything needed for app startup)
  if (pathname === '/bootstrap' && req.method === 'GET') {
    return jsonResponse({
      role: auth.role,
      settings: db.settings || DEFAULT_SETTINGS,
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
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Admin PIN required to delete customers' }, 403);
      }
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
        return jsonResponse({ error: 'Admin PIN required to add items' }, 403);
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
        return jsonResponse({ error: 'Admin PIN required to amend item prices or names' }, 403);
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
        return jsonResponse({ error: 'Admin PIN required to delete items' }, 403);
      }
      db.items[index].archived = true;
      db.items[index].archivedAt = new Date().toISOString();
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, message: 'Item archived' });
    }
  }

  // 5. SETTINGS
  if (pathname === '/settings') {
    if (req.method === 'GET') {
      return jsonResponse({ settings: db.settings || DEFAULT_SETTINGS });
    }
    if (req.method === 'PUT') {
      if (auth.role !== 'admin') {
        return jsonResponse({ error: 'Admin PIN required to update settings' }, 403);
      }
      const body = await req.json().catch(() => ({}));
      db.settings = {
        ...DEFAULT_SETTINGS,
        ...(db.settings || {}),
        ...body,
        updatedAt: new Date().toISOString()
      };
      await saveStoreData(storeWrapper, db);
      return jsonResponse({ success: true, settings: db.settings });
    }
  }

  // 6. INVOICES
  if (pathname === '/invoices') {
    if (req.method === 'GET') {
      // List invoices (without heavy base64 pdf data for speed)
      const list = (db.invoices || []).map(inv => ({
        invoiceNo: inv.invoiceNo,
        company: inv.company,
        customerEmail: inv.customerEmail,
        weekEnding: inv.weekEnding,
        grandTotal: inv.grandTotal,
        createdAt: inv.createdAt,
        sentAt: inv.sentAt,
        sentStatus: inv.sentStatus
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
        items: body.items, // snapshot of item names, unit prices, daily qtys, and row totals
        grandTotal: parseFloat(body.grandTotal || 0),
        pdfBase64: body.pdfBase64 || null,
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

  // Single Invoice GET
  const invMatch = pathname.match(/^\/invoices\/(\d+)$/);
  if (invMatch && req.method === 'GET') {
    const invNo = parseInt(invMatch[1], 10);
    const invoice = (db.invoices || []).find(i => i.invoiceNo === invNo);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    return jsonResponse({ invoice });
  }

  // 7. ONE-TAP SEND EMAIL FOR AN INVOICE
  const sendMatch = pathname.match(/^\/invoices\/(\d+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    const invNo = parseInt(sendMatch[1], 10);
    const body = await req.json().catch(() => ({}));

    // Find invoice or use provided payload
    const invoiceIndex = (db.invoices || []).findIndex(i => i.invoiceNo === invNo);
    let invoice = invoiceIndex !== -1 ? db.invoices[invoiceIndex] : null;

    const toEmail = body.toEmail || invoice?.customerEmail;
    if (!toEmail || !toEmail.trim()) {
      return jsonResponse({ error: 'Customer email address is required to send invoice.' }, 400);
    }

    const pdfBase64 = body.pdfBase64 || invoice?.pdfBase64;
    if (!pdfBase64) {
      return jsonResponse({ error: 'PDF data is missing. Please generate invoice PDF first.' }, 400);
    }

    const company = body.company || invoice?.company || 'Valued Customer';
    const weekEnding = body.weekEndingFormatted || invoice?.weekEndingFormatted || '';
    const total = (body.grandTotal !== undefined ? body.grandTotal : invoice?.grandTotal || 0).toFixed(2);

    // Prepare template variables
    const settings = db.settings || DEFAULT_SETTINGS;
    const subject = (settings.emailSubject || DEFAULT_SETTINGS.emailSubject)
      .replace(/{invoiceNo}/g, invNo)
      .replace(/{customer}/g, company)
      .replace(/{weekEnding}/g, weekEnding)
      .replace(/{total}/g, total);

    const bodyText = (settings.emailBody || DEFAULT_SETTINGS.emailBody)
      .replace(/{invoiceNo}/g, invNo)
      .replace(/{customer}/g, company)
      .replace(/{weekEnding}/g, weekEnding)
      .replace(/{total}/g, total);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #222; max-width: 600px; line-height: 1.6;">
        <h2 style="color: #4a2c11; margin-bottom: 8px;">Happyland Bakery Ltd</h2>
        <p style="white-space: pre-line; margin-top: 0;">${bodyText.replace(/\n/g, '<br/>')}</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777;">
          This is an automated invoice sent by Happyland Bakery Ltd.<br/>
          Attached file: Happyland_Bakery_Invoice_${invNo}.pdf
        </p>
      </div>
    `;

    try {
      const result = await sendInvoiceEmail({
        apiKey: BREVO_API_KEY,
        senderName: settings.senderName || SENDER_NAME,
        senderEmail: settings.senderEmail || SENDER_EMAIL,
        toEmail: toEmail.trim(),
        toName: company,
        ccEmail: body.ccEmail || invoice?.customerCcEmail,
        bccEmail: settings.bccEmail || BCC_EMAIL,
        subject,
        htmlContent,
        textContent: bodyText,
        attachmentName: `Happyland_Bakery_Invoice_${invNo}.pdf`,
        attachmentBase64: pdfBase64
      });

      // Update invoice sent status
      if (invoiceIndex !== -1) {
        db.invoices[invoiceIndex].sentAt = new Date().toISOString();
        db.invoices[invoiceIndex].sentStatus = result.simulated ? 'simulated' : 'sent';
        db.invoices[invoiceIndex].sentTo = toEmail.trim();
        if (pdfBase64) db.invoices[invoiceIndex].pdfBase64 = pdfBase64;
        await saveStoreData(storeWrapper, db);
      }

      return jsonResponse({
        success: true,
        invoiceNo: invNo,
        sentTo: toEmail.trim(),
        simulated: result.simulated,
        message: result.simulated ? result.message : `Invoice #${invNo} successfully sent to ${toEmail.trim()}`
      });
    } catch (sendErr) {
      console.error('Email send error:', sendErr);
      return jsonResponse({
        error: `Email delivery failed: ${sendErr.message}`,
        details: sendErr.details || null
      }, 500);
    }
  }

  // 8. BACKUP EXPORT & IMPORT (ADMIN ONLY)
  if (pathname === '/backup/export' && req.method === 'GET') {
    if (auth.role !== 'admin') return jsonResponse({ error: 'Admin PIN required' }, 403);
    return jsonResponse({
      exportedAt: new Date().toISOString(),
      database: db
    });
  }

  if (pathname === '/backup/import' && req.method === 'POST') {
    if (auth.role !== 'admin') return jsonResponse({ error: 'Admin PIN required' }, 403);
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
