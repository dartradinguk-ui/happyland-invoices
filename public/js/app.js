import { Api } from './api.js';
import { createInvoiceDoc, downloadInvoicePdf, getInvoicePdfBase64, getInvoicePdfFile, generateFilename } from './pdf.js';

// --- APPLICATION STATE ---
const DAYS = ['mon', 'tues', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = {
  mon: 'Mon',
  tues: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};

const state = {
  role: 'staff',
  settings: {},
  customers: [],
  items: [],
  activeTab: 'invoice',
  activeDay: 'mon',
  draft: {
    customerId: '',
    weekEnding: '',
    quantities: {} // { [itemId]: { mon: 0, tues: 0, ... } }
  },
  sendCountdown: null,
  sendTimeoutId: null
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initServiceWorker();
  initTabs();
  initDayPills();
  initModals();
  initActionButtons();

  // Load directly without mandatory PIN prompt
  state.role = Api.getRole() || 'admin';
  await loadInitialData();
});

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW register error:', err);
    });
  }
}

// --- BOOTSTRAP & REAL-TIME SYNC ---
async function loadInitialData() {
  await syncLatestData(false);
  loadDraft();
  initAutoSync();
}

async function syncLatestData(silent = true) {
  try {
    const data = await Api.bootstrap();
    state.settings = data.settings || {};
    state.customers = data.customers || [];
    state.items = data.items || [];

    updateRoleBadge();
    renderCustomerSelect();
    renderItemsTab();
    renderCustomersTab();
    renderSettingsTab();
    renderInvoiceItemCards();
    updateGrandTotal();
  } catch (err) {
    if (!silent) {
      console.warn('Sync error:', err);
      showToast('Operating in offline cache mode.', 'info');
    }
  }
}

// Automatically sync across all staff phones
function initAutoSync() {
  // 1. Sync when user switches back to the tab or unlocks phone
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLatestData(true);
    }
  });

  window.addEventListener('focus', () => {
    syncLatestData(true);
  });

  // 2. Periodic sync every 25 seconds in background
  setInterval(() => {
    syncLatestData(true);
  }, 25000);
}

function updateRoleBadge() {
  const staffBtn = document.getElementById('btnRoleStaff');
  const adminBtn = document.getElementById('btnRoleAdmin');
  if (staffBtn && adminBtn) {
    staffBtn.classList.toggle('active', state.role === 'staff');
    adminBtn.classList.toggle('active', state.role === 'admin');
  }
}

// --- LOCAL DRAFT PERSISTENCE ---
const DRAFT_KEY = 'happyland_invoice_draft';

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft));
}

function loadDraft() {
  // Set default week ending date (next Sunday in local time)
  const defaultDate = getDefaultWeekEnding();
  
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      state.draft = JSON.parse(saved);
      if (!state.draft.weekEnding) state.draft.weekEnding = defaultDate;
    } else {
      state.draft = {
        customerId: state.customers[0]?.id || '',
        weekEnding: defaultDate,
        quantities: {}
      };
    }
  } catch (e) {
    state.draft = { customerId: state.customers[0]?.id || '', weekEnding: defaultDate, quantities: {} };
  }

  const dateInput = document.getElementById('weekEndingInput');
  if (dateInput) {
    dateInput.value = state.draft.weekEnding;
  }
}

function getDefaultWeekEnding() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 is Sunday
  const daysUntilNextSunday = (7 - dayOfWeek) % 7;
  const target = new Date(today);
  target.setDate(today.getDate() + daysUntilNextSunday);

  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const parts = yyyyMmDd.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return yyyyMmDd;
}

// --- TABS & NAVIGATION ---
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-item');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });

  // Sticky bottom action bar only shows on the 'invoice' tab
  const bottomBar = document.getElementById('stickyBottomBar');
  if (bottomBar) {
    bottomBar.style.display = tabName === 'invoice' ? 'block' : 'none';
  }

  // Auto-refresh tabs and sync cloud data when viewed
  syncLatestData(true);
  if (tabName === 'history') loadHistoryTab();
  if (tabName === 'customers') renderCustomersTab();
  if (tabName === 'items') renderItemsTab();
  if (tabName === 'settings') renderSettingsTab();
}

// --- DAY SELECTOR PILLS ---
function initDayPills() {
  const pillsContainer = document.getElementById('dayPills');
  if (!pillsContainer) return;

  pillsContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.day-pill');
    if (!pill) return;
    const day = pill.dataset.day;
    state.activeDay = day;

    document.querySelectorAll('.day-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.day === day);
    });

    renderInvoiceItemCards();
  });
}

function updateDayPillBadges() {
  DAYS.forEach(day => {
    let dayTotalUnits = 0;
    state.items.forEach(item => {
      const itemQtys = state.draft.quantities[item.id] || {};
      dayTotalUnits += parseInt(itemQtys[day] || 0, 10);
    });
    const badge = document.querySelector(`.day-pill[data-day="${day}"] .day-qty-count`);
    if (badge) {
      badge.textContent = dayTotalUnits > 0 ? `${dayTotalUnits}` : '—';
    }
  });
}

// --- INVOICE SCREEN: CUSTOMER SELECT & ITEM CARDS ---
function renderCustomerSelect() {
  const select = document.getElementById('customerSelect');
  if (!select) return;

  select.innerHTML = state.customers.map(c => `
    <option value="${c.id}" ${c.id === state.draft.customerId ? 'selected' : ''}>
      ${c.name}
    </option>
  `).join('');

  if (!state.draft.customerId && state.customers.length > 0) {
    state.draft.customerId = state.customers[0].id;
  }

  select.addEventListener('change', () => {
    state.draft.customerId = select.value;
    saveDraft();
    updateCustomerBadge();
  });

  updateCustomerBadge();

  // Week ending input listener
  const dateInput = document.getElementById('weekEndingInput');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      state.draft.weekEnding = dateInput.value;
      saveDraft();
    });
  }
}

function updateCustomerBadge() {
  const badge = document.getElementById('customerDetailsBadge');
  if (!badge) return;
  const current = state.customers.find(c => c.id === state.draft.customerId);
  if (!current) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';
  const emailText = current.email ? `✉️ ${current.email}` : `<span style="color:#dc2626; font-weight:600;">⚠️ No email address (cannot one-tap send)</span>`;
  const addrText = current.address ? `📍 ${current.address}` : '';
  badge.innerHTML = `<div>${emailText}</div>${addrText ? `<div>${addrText}</div>` : ''}`;
}

function renderInvoiceItemCards() {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;

  const currentDay = state.activeDay;

  if (state.items.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; color: var(--text-muted); padding:30px;">No items configured yet.</div>`;
    return;
  }

  container.innerHTML = state.items.map(item => {
    const itemQtys = state.draft.quantities[item.id] || {};
    const dayQty = parseInt(itemQtys[currentDay] || 0, 10);
    const dayTotal = (dayQty * item.price).toFixed(2);

    // Calculate weekly sum for this item
    const weekTotalUnits = DAYS.reduce((sum, d) => sum + parseInt(itemQtys[d] || 0, 10), 0);
    const weekTotalPrice = (weekTotalUnits * item.price).toFixed(2);

    return `
      <div class="item-entry-card" data-item-id="${item.id}">
        <div class="item-entry-header">
          <div class="item-name">${item.name}</div>
          <div class="item-price-tag">£${item.price.toFixed(2)} each</div>
        </div>

        <div class="item-controls-row">
          <div class="stepper-container">
            <button type="button" class="btn-stepper btn-minus" data-id="${item.id}">−</button>
            <input type="number" 
                   min="0" 
                   step="1"
                   inputmode="numeric" 
                   class="stepper-input qty-input" 
                   data-id="${item.id}" 
                   value="${dayQty || 0}" />
            <button type="button" class="btn-stepper btn-plus" data-id="${item.id}">+</button>
          </div>

          <div class="item-subtotal-display">
            <div class="item-day-total">£${dayTotal}</div>
            <div class="item-week-summary">Week: ${weekTotalUnits} pcs (£${weekTotalPrice})</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach Stepper Listeners
  container.querySelectorAll('.btn-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      adjustItemQty(id, -1);
    });
  });

  container.querySelectorAll('.btn-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      adjustItemQty(id, 1);
    });
  });

  container.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', () => {
      const id = input.dataset.id;
      const val = Math.max(0, parseInt(input.value, 10) || 0);
      setItemQty(id, val);
    });
  });

  updateDayPillBadges();
}

function adjustItemQty(itemId, delta) {
  state.draft.quantities[itemId] = state.draft.quantities[itemId] || {};
  const current = parseInt(state.draft.quantities[itemId][state.activeDay] || 0, 10);
  const updated = Math.max(0, current + delta);
  state.draft.quantities[itemId][state.activeDay] = updated;

  saveDraft();
  renderInvoiceItemCards();
  updateGrandTotal();
}

function setItemQty(itemId, value) {
  state.draft.quantities[itemId] = state.draft.quantities[itemId] || {};
  state.draft.quantities[itemId][state.activeDay] = value;

  saveDraft();
  updateGrandTotal();
  updateDayPillBadges();

  // Update card subtotal display directly without resetting focus
  const card = document.querySelector(`.item-entry-card[data-item-id="${itemId}"]`);
  if (card) {
    const item = state.items.find(i => i.id === itemId);
    if (item) {
      const dayTotal = (value * item.price).toFixed(2);
      const weekUnits = DAYS.reduce((sum, d) => sum + parseInt(state.draft.quantities[itemId][d] || 0, 10), 0);
      const weekPrice = (weekUnits * item.price).toFixed(2);
      card.querySelector('.item-day-total').textContent = `£${dayTotal}`;
      card.querySelector('.item-week-summary').textContent = `Week: ${weekUnits} pcs (£${weekPrice})`;
    }
  }
}

function calculateCurrentInvoiceData() {
  const customer = state.customers.find(c => c.id === state.draft.customerId) || {
    name: 'Customer',
    email: '',
    address: ''
  };

  let grandTotal = 0;
  const lineItems = state.items.map(item => {
    const q = state.draft.quantities[item.id] || {};
    const mon = parseInt(q.mon || 0, 10);
    const tues = parseInt(q.tues || 0, 10);
    const wed = parseInt(q.wed || 0, 10);
    const thu = parseInt(q.thu || 0, 10);
    const fri = parseInt(q.fri || 0, 10);
    const sat = parseInt(q.sat || 0, 10);
    const sun = parseInt(q.sun || 0, 10);

    const total = mon + tues + wed + thu + fri + sat + sun;
    const itemTotal = total * item.price;
    grandTotal += itemTotal;

    return {
      itemId: item.id,
      name: item.name,
      cost: item.price,
      mon,
      tues,
      wed,
      thu,
      fri,
      sat,
      sun,
      total,
      itemTotal
    };
  });

  return {
    settings: state.settings,
    company: customer.name,
    customerEmail: customer.email || '',
    customerCcEmail: customer.ccEmail || '',
    customerAddress: customer.address || '',
    weekEnding: state.draft.weekEnding,
    weekEndingFormatted: formatDateDisplay(state.draft.weekEnding),
    items: lineItems,
    grandTotal: parseFloat(grandTotal.toFixed(2))
  };
}

function updateGrandTotal() {
  const data = calculateCurrentInvoiceData();
  const totalDisplay = document.getElementById('grandTotalDisplay');
  if (totalDisplay) {
    totalDisplay.textContent = `£${data.grandTotal.toFixed(2)}`;
  }
}

// --- ACTION BUTTONS: PREVIEW, PDF, ONE-TAP SEND ---
function initActionButtons() {
  // Preview
  document.getElementById('btnPreview')?.addEventListener('click', () => {
    showInvoicePreviewModal();
  });

  // Download PDF
  document.getElementById('btnDownloadPdf')?.addEventListener('click', () => {
    const data = calculateCurrentInvoiceData();
    data.invoiceNo = state.settings.nextInvoiceNo || 1001;
    downloadInvoicePdf(data);
  });

  // One-Tap Send
  document.getElementById('btnOneTapSend')?.addEventListener('click', () => {
    startOneTapSendFlow();
  });

  // Undo button on Toast
  document.getElementById('btnUndoSend')?.addEventListener('click', () => {
    cancelOneTapSend();
  });

  // Add customer quick button from invoice header
  document.getElementById('btnQuickAddCustomer')?.addEventListener('click', () => {
    openCustomerModal();
  });
}

function showInvoicePreviewModal() {
  const data = calculateCurrentInvoiceData();
  const modal = document.getElementById('previewModal');
  const body = document.getElementById('previewModalBody');
  if (!modal || !body) return;

  const tableRows = data.items.map(i => `
    <tr>
      <td>${i.name}</td>
      <td>${i.mon || ''}</td>
      <td>${i.tues || ''}</td>
      <td>${i.wed || ''}</td>
      <td>${i.thu || ''}</td>
      <td>${i.fri || ''}</td>
      <td>${i.sat || ''}</td>
      <td>${i.sun || ''}</td>
      <td><strong>${i.total}</strong></td>
      <td>£${i.cost.toFixed(2)}</td>
      <td><strong>£${i.itemTotal.toFixed(2)}</strong></td>
    </tr>
  `).join('');

  body.innerHTML = `
    <div class="preview-invoice-container">
      <h3 style="color: #92400e; margin-bottom: 4px;">Happyland Bakery Ltd</h3>
      <p><strong>Invoice To:</strong> ${data.company}</p>
      ${data.customerAddress ? `<p style="color:#64748b;">${data.customerAddress}</p>` : ''}
      <p><strong>Week Ending:</strong> ${data.weekEndingFormatted}</p>

      <table class="preview-table">
        <thead>
          <tr>
            <th>Item</th><th>M</th><th>Tu</th><th>W</th><th>Th</th><th>F</th><th>Sa</th><th>Su</th>
            <th>Qty</th><th>Cost</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr style="background: #f8fafc;">
            <td colspan="10" style="text-align:right; font-weight:bold;">Sub Total:</td>
            <td style="font-weight:bold; color: #92400e;">£${data.grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div style="background: #f1f5f9; padding: 8px; border-radius: 6px; font-size: 11px;">
        <div><strong>Payment Details:</strong> Happyland Bakery Ltd</div>
        <div>Account: ${state.settings.accountNumber || '30623245'} | Sort Code: ${state.settings.sortCode || '20-92-60'}</div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

// --- SEND VIA LOCAL EMAIL / SHARE SHEET WITH ATTACHED PDF ---
async function startOneTapSendFlow() {
  const data = calculateCurrentInvoiceData();

  if (!data.customerEmail) {
    if (!confirm(`No email address is set for "${data.company}". Do you still want to prepare and send via Mail/WhatsApp?`)) {
      switchTab('customers');
      return;
    }
  }

  await executeSend(data);
}

async function executeSend(data) {
  showToast('Preparing PDF & opening Mail...', 'info');

  try {
    const nextNo = state.settings.nextInvoiceNo || 1001;
    data.invoiceNo = nextNo;
    const pdfFile = getInvoicePdfFile(data);
    const pdfBase64 = getInvoicePdfBase64(data);
    data.pdfBase64 = pdfBase64;

    // 1. Save invoice to backend (atomic sequential invoice number)
    const createRes = await Api.createInvoice(data);
    const invoiceNo = createRes.invoiceNo || nextNo;
    data.invoiceNo = invoiceNo;

    // 2. Prepare Email Subject and Body
    const subject = `Invoice #${invoiceNo} – Happyland Bakery – Week ending ${data.weekEndingFormatted}`;
    const bodyText = `Dear ${data.company},

Please find attached your invoice #${invoiceNo} for the week ending ${data.weekEndingFormatted}.

Total due: £${data.grandTotal.toFixed(2)}

Payment Details:
Bank: Happyland Bakery Ltd
Account Number: ${state.settings.accountNumber || '30623245'}
Sort Code: ${state.settings.sortCode || '20-92-60'}

Thank you for your business,
Happyland Bakery Ltd`;

    // 3. Web Share API Level 2 (iPhone Safari & Android Chrome)
    // Directly opens local Mail/Gmail compose with the PDF attached!
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      // Copy customer email to clipboard so user can paste into 'To:' in Mail with one tap
      if (data.customerEmail && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(data.customerEmail);
        } catch (e) {}
      }

      await navigator.share({
        files: [pdfFile],
        title: subject,
        text: data.customerEmail ? `To: ${data.customerEmail}\n\n${bodyText}` : bodyText
      });

      // Mark as sent on server
      await Api.sendInvoiceEmail(invoiceNo, {
        toEmail: data.customerEmail,
        pdfBase64
      });

      showToast(`Invoice #${invoiceNo} ready in your Mail app!`, 'success');
    } else {
      // Desktop / browser fallback: download PDF + trigger mailto
      downloadInvoicePdf(data);
      const mailtoUrl = `mailto:${encodeURIComponent(data.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      window.location.href = mailtoUrl;

      await Api.sendInvoiceEmail(invoiceNo, {
        toEmail: data.customerEmail,
        pdfBase64
      });

      showToast(`Invoice #${invoiceNo} PDF downloaded & Mail opened.`, 'success');
    }

    // 4. Update next invoice number locally
    state.settings.nextInvoiceNo = invoiceNo + 1;

    // 5. Clear draft quantities for fresh invoice
    state.draft.quantities = {};
    saveDraft();
    renderInvoiceItemCards();
    updateGrandTotal();
  } catch (err) {
    if (err.name === 'AbortError') {
      // User closed the share sheet without picking an app
      showToast(`Invoice #${data.invoiceNo} saved in History.`, 'info');
    } else {
      console.error('Send error:', err);
      showToast(`Error: ${err.message}`, 'danger');
    }
  }
}

// --- CUSTOMERS MANAGEMENT SCREEN ---
function renderCustomersTab() {
  const container = document.getElementById('customersListContainer');
  if (!container) return;

  const searchInput = document.getElementById('customerSearchInput');
  const query = (searchInput?.value || '').toLowerCase().trim();

  const filtered = state.customers.filter(c => 
    c.name.toLowerCase().includes(query) || 
    (c.email && c.email.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; color: var(--text-muted); padding:30px;">No customers found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(c => `
    <div class="list-item-card" data-id="${c.id}">
      <div class="list-item-main">
        <div class="list-item-title">${c.name}</div>
        <div class="list-item-sub">
          ${c.email ? `✉️ ${c.email}` : '<span style="color:#dc2626;">No email set</span>'}
          ${c.address ? ` · 📍 ${c.address}` : ''}
        </div>
      </div>
      <div class="list-item-actions">
        <button class="btn-table-icon btn-edit-customer" data-id="${c.id}" title="Edit">✏️</button>
        <button class="btn-table-icon delete btn-del-customer" data-id="${c.id}" title="Delete Customer">🗑</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-edit-customer').forEach(btn => {
    btn.addEventListener('click', () => {
      const cust = state.customers.find(c => c.id === btn.dataset.id);
      if (cust) openCustomerModal(cust);
    });
  });

  container.querySelectorAll('.btn-del-customer').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cust = state.customers.find(c => c.id === btn.dataset.id);
      if (!cust) return;
      if (confirm(`Are you sure you want to remove customer "${cust.name}"?`)) {
        try {
          await Api.deleteCustomer(cust.id);
          state.customers = state.customers.filter(c => c.id !== cust.id);
          renderCustomersTab();
          renderCustomerSelect();
          showToast(`Customer "${cust.name}" removed`, 'success');
        } catch (e) {
          showToast(e.message, 'danger');
        }
      }
    });
  });
}

function openCustomerModal(cust = null) {
  const modal = document.getElementById('customerModal');
  const title = document.getElementById('customerModalTitle');
  const nameInput = document.getElementById('custModalName');
  const emailInput = document.getElementById('custModalEmail');
  const ccInput = document.getElementById('custModalCc');
  const addrInput = document.getElementById('custModalAddr');
  const idInput = document.getElementById('custModalId');

  if (!modal) return;

  if (cust) {
    title.textContent = 'Edit Customer';
    idInput.value = cust.id;
    nameInput.value = cust.name;
    emailInput.value = cust.email || '';
    ccInput.value = cust.ccEmail || '';
    addrInput.value = cust.address || '';
  } else {
    title.textContent = 'Add New Customer';
    idInput.value = '';
    nameInput.value = '';
    emailInput.value = '';
    ccInput.value = '';
    addrInput.value = '';
  }

  modal.style.display = 'flex';
}

// --- ITEMS & PRICES MANAGEMENT SCREEN ---
function renderItemsTab() {
  const container = document.getElementById('itemsListContainer');
  const adminNotice = document.getElementById('itemsAdminNotice');
  const addBtn = document.getElementById('btnAddItem');

  if (!container) return;

  if (adminNotice) {
    adminNotice.style.display = state.role === 'admin' ? 'none' : 'block';
  }
  if (addBtn) {
    addBtn.style.display = state.role === 'admin' ? 'inline-flex' : 'none';
  }

  container.innerHTML = state.items.map(item => `
    <div class="list-item-card" data-id="${item.id}">
      <div class="list-item-main">
        <div class="list-item-title">${item.name}</div>
        <div class="list-item-sub">Price: <strong>£${item.price.toFixed(2)}</strong></div>
      </div>
      <div class="list-item-actions">
        ${state.role === 'admin' ? `
          <button class="btn-table-icon btn-edit-item" data-id="${item.id}" title="Edit Price / Name">✏️</button>
          <button class="btn-table-icon delete btn-del-item" data-id="${item.id}" title="Delete">🗑</button>
        ` : `
          <span style="font-size:12px; color:var(--text-muted); padding:4px 8px; background:#f1f5f9; border-radius:4px;">Fixed</span>
        `}
      </div>
    </div>
  `).join('');

  if (state.role === 'admin') {
    container.querySelectorAll('.btn-edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = state.items.find(i => i.id === btn.dataset.id);
        if (item) openItemModal(item);
      });
    });

    container.querySelectorAll('.btn-del-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = state.items.find(i => i.id === btn.dataset.id);
        if (!item) return;
        if (confirm(`Are you sure you want to remove item "${item.name}"?`)) {
          try {
            await Api.deleteItem(item.id);
            state.items = state.items.filter(i => i.id !== item.id);
            renderItemsTab();
            renderInvoiceItemCards();
            showToast(`Item "${item.name}" removed`, 'success');
          } catch (e) {
            showToast(e.message, 'danger');
          }
        }
      });
    });
  }
}

function openItemModal(item = null) {
  const modal = document.getElementById('itemModal');
  const title = document.getElementById('itemModalTitle');
  const nameInput = document.getElementById('itemModalName');
  const priceInput = document.getElementById('itemModalPrice');
  const idInput = document.getElementById('itemModalId');

  if (!modal) return;

  if (item) {
    title.textContent = 'Edit Item Price / Name';
    idInput.value = item.id;
    nameInput.value = item.name;
    priceInput.value = item.price.toFixed(2);
  } else {
    title.textContent = 'Add New Item';
    idInput.value = '';
    nameInput.value = '';
    priceInput.value = '0.50';
  }

  modal.style.display = 'flex';
}

// --- HISTORY SCREEN ---
async function loadHistoryTab() {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading past invoices...</div>`;

  try {
    const res = await Api.getInvoices();
    const invoices = res.invoices || [];

    if (invoices.length === 0) {
      container.innerHTML = `<div class="card" style="text-align:center; color: var(--text-muted); padding:30px;">No past invoices recorded yet.</div>`;
      return;
    }

    container.innerHTML = invoices.map(inv => {
      const isSent = inv.sentStatus === 'sent' || inv.sentStatus === 'simulated';
      const statusBadge = isSent 
        ? `<span style="background:#d1fae5; color:#065f46; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:600;">Sent</span>`
        : `<span style="background:#f1f5f9; color:#475569; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:600;">Saved</span>`;

      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div>
              <strong style="font-size:16px;">#${inv.invoiceNo}</strong> - ${inv.company}
            </div>
            <div>${statusBadge}</div>
          </div>
          <div style="font-size:13px; color:var(--text-muted); margin-bottom:8px;">
            Week Ending: ${inv.weekEnding} · Total: <strong style="color:var(--primary-dark);">£${(inv.grandTotal || 0).toFixed(2)}</strong>
            ${inv.sentTo ? `<br/>To: ${inv.sentTo}` : ''}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-action btn-action-secondary btn-history-download" data-no="${inv.invoiceNo}" style="height:36px; font-size:13px;">
              📄 Download PDF
            </button>
            <button class="btn-action btn-action-primary btn-history-resend" data-no="${inv.invoiceNo}" style="height:36px; font-size:13px;">
              ✉️ Re-send
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-history-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invNo = parseInt(btn.dataset.no, 10);
        try {
          const detail = await Api.getInvoice(invNo);
          if (detail.invoice) {
            downloadInvoicePdf(detail.invoice);
          }
        } catch (e) {
          showToast(e.message, 'danger');
        }
      });
    });

    container.querySelectorAll('.btn-history-resend').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invNo = parseInt(btn.dataset.no, 10);
        try {
          const detail = await Api.getInvoice(invNo);
          const inv = detail.invoice;
          if (!inv) return;
          if (!inv.customerEmail) {
            alert('This invoice has no saved customer email address.');
            return;
          }
          const pdfFile = getInvoicePdfFile(inv);
          const subject = `Invoice #${invNo} – Happyland Bakery – Week ending ${inv.weekEndingFormatted}`;
          const bodyText = `Dear ${inv.company},

Please find attached invoice #${invNo} for the week ending ${inv.weekEndingFormatted}.

Total due: £${(inv.grandTotal || 0).toFixed(2)}

Payment Details:
Bank: Happyland Bakery Ltd
Account Number: ${state.settings.accountNumber || '30623245'}
Sort Code: ${state.settings.sortCode || '20-92-60'}

Thank you for your business,
Happyland Bakery Ltd`;

          if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
            if (inv.customerEmail && navigator.clipboard) {
              try { await navigator.clipboard.writeText(inv.customerEmail); } catch (e) {}
            }
            await navigator.share({
              files: [pdfFile],
              title: subject,
              text: inv.customerEmail ? `To: ${inv.customerEmail}\n\n${bodyText}` : bodyText
            });
            showToast(`Invoice #${invNo} opened in Mail!`, 'success');
          } else {
            downloadInvoicePdf(inv);
            window.location.href = `mailto:${encodeURIComponent(inv.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
            showToast(`Invoice #${invNo} PDF downloaded & Mail opened`, 'success');
          }
        } catch (e) {
          if (e.name !== 'AbortError') showToast(e.message, 'danger');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger); padding:20px;">Could not load history: ${err.message}</div>`;
  }
}

// --- SETTINGS TAB ---
function renderSettingsTab() {
  const form = document.getElementById('settingsForm');
  if (!form) return;

  const s = state.settings;
  document.getElementById('setBusinessName').value = s.businessName || 'Happyland Bakery Ltd';
  document.getElementById('setAccountNo').value = s.accountNumber || '30623245';
  document.getElementById('setSortCode').value = s.sortCode || '20-92-60';
  document.getElementById('setBccEmail').value = s.bccEmail || '';
  document.getElementById('setNextNo').value = s.nextInvoiceNo || 1001;

  const adminOnlyFields = document.querySelectorAll('.admin-only-setting');
  adminOnlyFields.forEach(el => {
    el.style.display = state.role === 'admin' ? 'block' : 'none';
  });

  const staffNotice = document.getElementById('settingsStaffNotice');
  if (staffNotice) {
    staffNotice.style.display = state.role === 'admin' ? 'none' : 'block';
  }
}

// --- MODALS SETUP & HANDLERS ---
function initModals() {
  // Close modals
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal-overlay');
      if (modal) modal.style.display = 'none';
    });
  });

  // Customer Modal Save
  document.getElementById('customerModalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('custModalId').value;
    const name = document.getElementById('custModalName').value;
    const email = document.getElementById('custModalEmail').value;
    const ccEmail = document.getElementById('custModalCc').value;
    const address = document.getElementById('custModalAddr').value;

    try {
      const res = await Api.saveCustomer({ id, name, email, ccEmail, address });
      const savedCust = res.customer;

      if (id) {
        const idx = state.customers.findIndex(c => c.id === id);
        if (idx !== -1) state.customers[idx] = savedCust;
      } else {
        state.customers.push(savedCust);
        state.draft.customerId = savedCust.id;
      }

      saveDraft();
      renderCustomerSelect();
      renderCustomersTab();
      document.getElementById('customerModal').style.display = 'none';
      showToast('Customer saved successfully', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  // Item Modal Save (Admin Only)
  document.getElementById('itemModalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.role !== 'admin') {
      alert('Admin PIN required to modify items.');
      return;
    }

    const id = document.getElementById('itemModalId').value;
    const name = document.getElementById('itemModalName').value;
    const price = parseFloat(document.getElementById('itemModalPrice').value);

    try {
      const res = await Api.saveItem({ id, name, price });
      const savedItem = res.item;

      if (id) {
        const idx = state.items.findIndex(i => i.id === id);
        if (idx !== -1) state.items[idx] = savedItem;
      } else {
        state.items.push(savedItem);
      }

      renderItemsTab();
      renderInvoiceItemCards();
      updateGrandTotal();
      document.getElementById('itemModal').style.display = 'none';
      showToast('Item saved successfully', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  // Settings Save (Admin Only)
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.role !== 'admin') {
      alert('Admin PIN required to update settings.');
      return;
    }

    const updated = {
      businessName: document.getElementById('setBusinessName').value.trim(),
      accountNumber: document.getElementById('setAccountNo').value.trim(),
      sortCode: document.getElementById('setSortCode').value.trim(),
      bccEmail: document.getElementById('setBccEmail').value.trim(),
      nextInvoiceNo: parseInt(document.getElementById('setNextNo').value, 10) || 1001
    };

    try {
      const res = await Api.saveSettings(updated);
      state.settings = res.settings;
      showToast('Settings saved successfully', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  // PIN Login Modal
  document.getElementById('pinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('pinInput').value.trim();
    if (!pin) return;

    try {
      const res = await Api.login(pin);
      state.role = res.role;
      updateRoleBadge();
      document.getElementById('pinModal').style.display = 'none';
      document.getElementById('pinInput').value = '';
      showToast(res.message || `Logged in as ${state.role.toUpperCase()}`, 'success');
      await loadInitialData();
    } catch (err) {
      const pinErr = document.getElementById('pinError');
      if (pinErr) {
        pinErr.textContent = err.message || 'Invalid PIN';
        pinErr.style.display = 'block';
      }
    }
  });

  // Segmented Role Switcher buttons (Staff / Admin)
  document.getElementById('btnRoleStaff')?.addEventListener('click', () => {
    setRoleMode('staff');
  });

  document.getElementById('btnRoleAdmin')?.addEventListener('click', () => {
    setRoleMode('admin');
  });

  // Add Item button listener
  document.getElementById('btnAddItem')?.addEventListener('click', () => {
    openItemModal();
  });

  // Customer search filter listener
  document.getElementById('customerSearchInput')?.addEventListener('input', () => {
    renderCustomersTab();
  });

  // Backup Export
  document.getElementById('btnExportBackup')?.addEventListener('click', async () => {
    try {
      const backup = await Api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `happyland_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });
}

function setRoleMode(newRole) {
  if (state.role === newRole) return;
  state.role = newRole;
  Api.setRole(newRole);
  updateRoleBadge();
  renderItemsTab();
  renderCustomersTab();
  renderSettingsTab();
  showToast(`Switched to ${newRole.toUpperCase()} mode`, 'success');
}

function toggleRole() {
  const nextRole = state.role === 'admin' ? 'staff' : 'admin';
  setRoleMode(nextRole);
}

function showPinModal(isFirstTime = false) {
  toggleRole();
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.style.cssText = `
      position: fixed;
      top: 14px;
      left: 14px;
      right: 14px;
      max-width: 450px;
      margin: 0 auto;
      z-index: 300;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: opacity 0.2s ease;
      display: none;
    `;
    document.body.appendChild(toast);
  }

  const bgColors = {
    success: '#059669',
    danger: '#dc2626',
    info: '#1e293b'
  };

  toast.style.background = bgColors[type] || '#1e293b';
  toast.style.color = 'white';
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 200);
  }, 4000);
}
