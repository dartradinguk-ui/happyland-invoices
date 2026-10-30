import { Api } from './api.js';
import { createInvoiceDoc, downloadInvoicePdf, getInvoicePdfBase64, getInvoicePdfFile, generateFilename } from './pdf.js';

// --- APPLICATION CONSTANTS & HELPERS ---
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
const DAY_FULL_NAMES = {
  mon: 'Monday',
  tues: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
};

function getTodayDayKey() {
  const dayOfWeek = new Date().getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const map = { 0: 'sun', 1: 'mon', 2: 'tues', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
  return map[dayOfWeek] || 'mon';
}

function getYesterdayDayKey(dayKey) {
  const idx = DAYS.indexOf(dayKey);
  if (idx <= 0) return DAYS[DAYS.length - 1]; // mon -> sun
  return DAYS[idx - 1];
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

function getWeekRangeText(weekEndingDateStr) {
  if (!weekEndingDateStr) return 'This Week';
  const parts = weekEndingDateStr.split('-');
  if (parts.length !== 3) return weekEndingDateStr;
  const sunday = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() - 6);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monStr = `Mon ${monday.getDate()} ${months[monday.getMonth()]}`;
  const sunStr = `Sun ${sunday.getDate()} ${months[sunday.getMonth()]}`;
  return `${monStr} – ${sunStr}`;
}

// --- APPLICATION STATE ---
const state = {
  role: 'staff',
  settings: {},
  customers: [],
  items: [],
  orders: [],               // Cloud-synced open customer orders
  activeTab: 'invoice',     // Deliveries / Orders tab
  activeView: 'home',       // 'home' (Customer Cards list) or 'entry' (Single Customer Today)
  activeCustomerId: null,
  activeDay: getTodayDayKey(),
  activeWeekEnding: getDefaultWeekEnding(),
  isDirty: false,
  isSaving: false,
  saveTimeoutId: null,
  sendCountdown: null,
  sendTimeoutId: null,
  gmailUnlocked: sessionStorage.getItem('gmailUnlocked') === 'true'
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initServiceWorker();
  initTabs();
  initDayPills();
  initModals();
  initActionButtons();
  initWeekPicker();

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
  initAutoSync();
}

async function syncLatestData(silent = true) {
  try {
    const data = await Api.bootstrap();
    state.settings = data.settings || {};
    state.customers = data.customers || [];
    state.items = data.items || [];

    // Avoid overwriting local order in progress if user is actively typing
    if (!state.isSaving && !state.isDirty) {
      state.orders = data.orders || [];
    }

    updateRoleBadge();
    renderItemsTab();
    renderCustomersTab();
    renderSettingsTab();

    if (state.activeTab === 'invoice') {
      if (state.activeView === 'home') {
        renderDeliveriesHome();
      } else {
        renderInvoiceItemCards();
        updateEntrySummary();
        updateDayPillBadges();
      }
    }
  } catch (err) {
    if (!silent) {
      console.warn('Sync error:', err);
      showToast('Operating in offline mode.', 'info');
    }
  }
}

function initAutoSync() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLatestData(true);
    }
  });

  window.addEventListener('focus', () => {
    syncLatestData(true);
  });

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

// --- WEEK PICKER INITIALIZER ---
function initWeekPicker() {
  const dateInput = document.getElementById('weekEndingInput');
  const toggleBtn = document.getElementById('btnToggleWeekPicker');
  const collapse = document.getElementById('weekPickerCollapse');

  if (dateInput) {
    dateInput.value = state.activeWeekEnding;
    dateInput.addEventListener('change', () => {
      state.activeWeekEnding = dateInput.value;
      renderDeliveriesHome();
    });
  }

  if (toggleBtn && collapse) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = collapse.style.display === 'none' || !collapse.style.display;
      collapse.style.display = isHidden ? 'block' : 'none';
      toggleBtn.textContent = isHidden ? 'Hide Week ▴' : 'Change Week ▾';
    });
  }
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

  // Sticky bottom action bar only shows on 'invoice' home view
  const bottomBar = document.getElementById('stickyBottomBar');
  if (bottomBar) {
    bottomBar.style.display = (tabName === 'invoice' && state.activeView === 'home') ? 'block' : 'none';
  }

  syncLatestData(true);
  if (tabName === 'invoice') renderDeliveriesHome();
  if (tabName === 'history') loadHistoryTab();
  if (tabName === 'customers') renderCustomersTab();
  if (tabName === 'items') renderItemsTab();
  if (tabName === 'settings') renderSettingsTab();
}

// --- ORDER DATA HELPERS ---
function getCustomerOrder(customerId, createIfMissing = false) {
  state.orders = state.orders || [];
  let order = state.orders.find(o => o.customerId === customerId && o.weekEnding === state.activeWeekEnding && o.status === 'open');
  if (!order && createIfMissing) {
    const cust = state.customers.find(c => c.id === customerId);
    order = {
      id: 'order_' + customerId + '_' + state.activeWeekEnding.replace(/-/g, '') + '_' + Date.now().toString(36),
      customerId,
      company: cust?.name || '',
      customerEmail: cust?.email || '',
      customerCcEmail: cust?.ccEmail || '',
      customerAddress: cust?.address || '',
      weekEnding: state.activeWeekEnding,
      weekEndingFormatted: formatDateDisplay(state.activeWeekEnding),
      status: 'open',
      quantities: {},
      grandTotal: 0,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.orders.push(order);
  }
  return order;
}

function calculateOrderTotals(order) {
  if (!order) return { grandTotal: 0, dayTotals: {}, dayTotalPrices: {}, weekTotalUnits: 0, lineItems: [] };
  let grandTotal = 0;
  let weekTotalUnits = 0;
  const dayTotals = { mon: 0, tues: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
  const dayTotalPrices = { mon: 0, tues: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };

  const quantities = order.quantities || {};

  const lineItems = (state.items || []).map(item => {
    const q = quantities[item.id] || {};
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
    weekTotalUnits += total;

    dayTotals.mon += mon;
    dayTotals.tues += tues;
    dayTotals.wed += wed;
    dayTotals.thu += thu;
    dayTotals.fri += fri;
    dayTotals.sat += sat;
    dayTotals.sun += sun;

    dayTotalPrices.mon += mon * item.price;
    dayTotalPrices.tues += tues * item.price;
    dayTotalPrices.wed += wed * item.price;
    dayTotalPrices.thu += thu * item.price;
    dayTotalPrices.fri += fri * item.price;
    dayTotalPrices.sat += sat * item.price;
    dayTotalPrices.sun += sun * item.price;

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

  grandTotal = parseFloat(grandTotal.toFixed(2));
  return { grandTotal, dayTotals, dayTotalPrices, weekTotalUnits, lineItems };
}

function calculateCurrentInvoiceData(targetOrder = null) {
  const order = targetOrder || getCustomerOrder(state.activeCustomerId, true);
  const cust = state.customers.find(c => c.id === order.customerId) || {};
  const totals = calculateOrderTotals(order);

  return {
    settings: state.settings,
    company: order.company || cust.name || 'Valued Customer',
    customerEmail: cust.email || order.customerEmail || '',
    customerCcEmail: cust.ccEmail || order.customerCcEmail || '',
    customerAddress: cust.address || order.customerAddress || '',
    weekEnding: order.weekEnding || state.activeWeekEnding,
    weekEndingFormatted: order.weekEndingFormatted || formatDateDisplay(state.activeWeekEnding),
    items: totals.lineItems,
    grandTotal: totals.grandTotal,
    weekTotalUnits: totals.weekTotalUnits
  };
}

// --- SCREEN 1: DELIVERIES HOME (CUSTOMER CARDS) ---
function renderDeliveriesHome() {
  const container = document.getElementById('deliveriesCustomerCards');
  const weekLabel = document.getElementById('homeWeekRangeLabel');
  const banner = document.getElementById('endOfWeekBanner');
  const bannerSub = document.getElementById('endOfWeekBannerSub');
  const grandTotalDisplay = document.getElementById('grandTotalDisplay');
  const searchInput = document.getElementById('homeCustomerSearchInput');

  if (weekLabel) {
    weekLabel.textContent = `This Week: ${getWeekRangeText(state.activeWeekEnding)}`;
  }

  const query = (searchInput?.value || '').toLowerCase().trim();
  const todayKey = getTodayDayKey();

  let customers = (state.customers || []).filter(c => !c.archived);
  if (query) {
    customers = customers.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.email && c.email.toLowerCase().includes(query)) ||
      (c.address && c.address.toLowerCase().includes(query))
    );
  }

  // Calculate order stats per customer
  const customerCardsData = customers.map(cust => {
    const order = getCustomerOrder(cust.id);
    const totals = calculateOrderTotals(order);
    const todayUnits = totals.dayTotals[todayKey] || 0;
    const hasTodayDelivery = todayUnits > 0;
    return {
      cust,
      order,
      totals,
      todayUnits,
      hasTodayDelivery
    };
  });

  // Sort: Customers not yet done today first, then completed ones
  customerCardsData.sort((a, b) => {
    if (a.hasTodayDelivery === b.hasTodayDelivery) {
      return a.cust.name.localeCompare(b.cust.name);
    }
    return a.hasTodayDelivery ? 1 : -1;
  });

  // Calculate overall totals
  let allCustomersWeekTotal = 0;
  let readyToSendCount = 0;
  customerCardsData.forEach(item => {
    allCustomersWeekTotal += item.totals.grandTotal;
    if (item.totals.grandTotal > 0) {
      readyToSendCount++;
    }
  });

  if (grandTotalDisplay) {
    grandTotalDisplay.textContent = `£${allCustomersWeekTotal.toFixed(2)}`;
  }

  // End-of-week reminder banner
  if (banner && bannerSub) {
    if (readyToSendCount > 0) {
      banner.style.display = 'flex';
      bannerSub.textContent = `${readyToSendCount} customer invoice${readyToSendCount === 1 ? '' : 's'} ready to send`;
    } else {
      banner.style.display = 'none';
    }
  }

  if (!container) return;

  if (customerCardsData.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align:center; color:var(--text-muted); padding:30px;">
        No customers found. Tap "+ Add New Customer" below to start.
      </div>
    `;
    return;
  }

  container.innerHTML = customerCardsData.map(({ cust, totals, todayUnits, hasTodayDelivery }) => {
    const dayDotsHtml = DAYS.map(d => {
      const dayUnits = totals.dayTotals[d] || 0;
      const isFilled = dayUnits > 0;
      const isToday = d === todayKey;
      return `
        <div class="day-dot-item ${isToday ? 'is-today' : ''}" title="${DAY_FULL_NAMES[d]}: ${dayUnits} pcs">
          <div class="day-dot-label">${DAY_LABELS[d]}</div>
          <div class="day-dot-bubble ${isFilled ? 'filled' : ''}">
            ${isFilled ? (dayUnits > 99 ? '99+' : dayUnits) : '·'}
          </div>
        </div>
      `;
    }).join('');

    const missingEmail = !cust.email;
    let badgeHtml = '';
    if (missingEmail) {
      badgeHtml = `<span class="card-status-badge warning" title="Customer has no email address">⚠️ No email</span>`;
    } else if (hasTodayDelivery) {
      badgeHtml = `<span class="card-status-badge done-today">✅ Today done (${todayUnits} pcs)</span>`;
    } else {
      badgeHtml = `<span class="card-status-badge need-today">➕ Add today's delivery</span>`;
    }

    return `
      <div class="customer-delivery-card" data-customer-id="${cust.id}">
        <div class="customer-card-header">
          <div>
            <div class="customer-card-name">${cust.name}</div>
            ${cust.address ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">📍 ${cust.address}</div>` : ''}
          </div>
          <div class="customer-card-total">£${totals.grandTotal.toFixed(2)}</div>
        </div>

        <div class="day-dots-row">
          ${dayDotsHtml}
        </div>

        <div class="customer-card-footer">
          <div>${badgeHtml}</div>
          <div style="font-size:12px; font-weight:700; color:var(--primary-dark);">
            ${totals.weekTotalUnits} pcs this week →
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.customer-delivery-card').forEach(card => {
    card.addEventListener('click', () => {
      const custId = card.dataset.customerId;
      if (custId) openCustomerDelivery(custId);
    });
  });
}

// --- SCREEN 2: TODAY'S DELIVERY ENTRY ---
function openCustomerDelivery(customerId, dayKey = null) {
  state.activeCustomerId = customerId;
  state.activeDay = dayKey || getTodayDayKey();
  state.activeView = 'entry';

  const cust = state.customers.find(c => c.id === customerId);
  const order = getCustomerOrder(customerId, true);

  const homeView = document.getElementById('viewDeliveriesHome');
  const entryView = document.getElementById('viewDeliveriesEntry');
  const stickyBar = document.getElementById('stickyBottomBar');

  if (homeView) homeView.style.display = 'none';
  if (entryView) entryView.style.display = 'block';
  if (stickyBar) stickyBar.style.display = 'none';

  const titleEl = document.getElementById('entryCustomerTitle');
  if (titleEl) titleEl.textContent = cust?.name || 'Customer';

  updateEntryCustomerBadge(cust);
  updateEntryActiveDayLabel();
  checkYesterdayDelivery(order);

  renderInvoiceItemCards();
  updateDayPillBadges();
  updateEntrySummary();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function returnToDeliveriesHome() {
  state.activeView = 'home';
  const homeView = document.getElementById('viewDeliveriesHome');
  const entryView = document.getElementById('viewDeliveriesEntry');
  const stickyBar = document.getElementById('stickyBottomBar');

  if (entryView) entryView.style.display = 'none';
  if (homeView) homeView.style.display = 'block';
  if (stickyBar && state.activeTab === 'invoice') stickyBar.style.display = 'block';

  renderDeliveriesHome();
}

function updateEntryCustomerBadge(cust) {
  const badge = document.getElementById('entryCustomerBadge');
  if (!badge) return;
  if (!cust) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'block';
  const emailText = cust.email ? `✉️ ${cust.email}` : `<span style="color:#dc2626; font-weight:700;">⚠️ No email address (cannot one-tap send)</span>`;
  const addrText = cust.address ? ` · 📍 ${cust.address}` : '';
  badge.innerHTML = `<div>${emailText}${addrText}</div>`;
}

function updateEntryActiveDayLabel() {
  const labelEl = document.getElementById('entryActiveDayLabel');
  if (!labelEl) return;
  const isToday = state.activeDay === getTodayDayKey();
  const dayName = DAY_FULL_NAMES[state.activeDay];
  labelEl.textContent = isToday ? `Today: ${dayName}` : `${dayName}`;
}

function checkYesterdayDelivery(order) {
  const btn = document.getElementById('btnSameAsYesterday');
  const summaryEl = document.getElementById('yesterdayQtySummary');
  if (!btn || !order) return;

  const yesterdayKey = getYesterdayDayKey(state.activeDay);
  const totals = calculateOrderTotals(order);
  const yesterdayUnits = totals.dayTotals[yesterdayKey] || 0;

  if (yesterdayUnits > 0) {
    btn.style.display = 'flex';
    if (summaryEl) summaryEl.textContent = `${DAY_LABELS[yesterdayKey]}: ${yesterdayUnits} pcs`;
  } else {
    btn.style.display = 'none';
  }
}

function copyYesterdayDelivery() {
  if (!state.activeCustomerId) return;
  const order = getCustomerOrder(state.activeCustomerId, true);
  const yesterdayKey = getYesterdayDayKey(state.activeDay);

  order.quantities = order.quantities || {};
  let copiedCount = 0;
  state.items.forEach(item => {
    order.quantities[item.id] = order.quantities[item.id] || {};
    const yQty = parseInt(order.quantities[item.id][yesterdayKey] || 0, 10);
    order.quantities[item.id][state.activeDay] = yQty;
    copiedCount += yQty;
  });

  renderInvoiceItemCards();
  updateDayPillBadges();
  updateEntrySummary();
  scheduleAutoSave();
  showToast(`Copied ${DAY_LABELS[yesterdayKey]}'s delivery (${copiedCount} pcs) ✓`, 'success');
}

// --- CLOUD AUTO-SAVE ---
async function saveActiveOrder(immediate = false) {
  if (state.saveTimeoutId) {
    clearTimeout(state.saveTimeoutId);
    state.saveTimeoutId = null;
  }

  if (!state.activeCustomerId) return;
  const order = getCustomerOrder(state.activeCustomerId);
  if (!order) return;

  const totals = calculateOrderTotals(order);
  order.grandTotal = totals.grandTotal;
  order.items = totals.lineItems;
  order.updatedAt = new Date().toISOString();

  const indicator = document.getElementById('orderSaveIndicator');
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.className = 'save-status-pill saving';
  }

  state.isSaving = true;
  try {
    const res = await Api.saveOrder(order);
    if (res.order) {
      Object.assign(order, res.order);
      const idx = state.orders.findIndex(o => o.id === res.order.id || (o.customerId === res.order.customerId && o.weekEnding === res.order.weekEnding));
      if (idx !== -1) {
        state.orders[idx] = res.order;
      } else {
        state.orders.push(res.order);
      }
    }
    state.isDirty = false;
    if (indicator) {
      indicator.textContent = 'Saved ✓';
      indicator.className = 'save-status-pill saved';
    }
  } catch (err) {
    console.warn('Auto-save error:', err);
    if (indicator) {
      indicator.textContent = 'Offline (cached)';
      indicator.className = 'save-status-pill unsaved';
    }
  } finally {
    state.isSaving = false;
  }
}

function scheduleAutoSave() {
  state.isDirty = true;
  const indicator = document.getElementById('orderSaveIndicator');
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.className = 'save-status-pill saving';
  }

  if (state.saveTimeoutId) clearTimeout(state.saveTimeoutId);
  state.saveTimeoutId = setTimeout(() => {
    saveActiveOrder(false);
  }, 500);
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

    updateEntryActiveDayLabel();
    const order = getCustomerOrder(state.activeCustomerId);
    checkYesterdayDelivery(order);
    renderInvoiceItemCards();
    updateEntrySummary();
  });
}

function updateDayPillBadges() {
  const order = getCustomerOrder(state.activeCustomerId);
  DAYS.forEach(day => {
    let dayTotalUnits = 0;
    if (order && order.quantities) {
      (state.items || []).forEach(item => {
        const itemQtys = order.quantities[item.id] || {};
        dayTotalUnits += parseInt(itemQtys[day] || 0, 10);
      });
    }
    const badge = document.querySelector(`.day-pill[data-day="${day}"] .day-qty-count`);
    if (badge) {
      badge.textContent = dayTotalUnits > 0 ? `${dayTotalUnits}` : '—';
    }
  });
}

// --- ITEM CARDS RENDERING (TODAY'S SCREEN) ---
function renderInvoiceItemCards() {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;

  const currentDay = state.activeDay;
  const order = getCustomerOrder(state.activeCustomerId, true);

  if (!state.items || state.items.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center; color: var(--text-muted); padding:30px;">No items configured yet.</div>`;
    return;
  }

  container.innerHTML = state.items.map(item => {
    const itemQtys = order.quantities[item.id] || {};
    const dayQty = parseInt(itemQtys[currentDay] || 0, 10);
    const dayTotal = (dayQty * item.price).toFixed(2);

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

  container.querySelectorAll('.btn-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      adjustItemQty(btn.dataset.id, -1);
    });
  });

  container.querySelectorAll('.btn-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      adjustItemQty(btn.dataset.id, 1);
    });
  });

  container.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', () => {
      const val = Math.max(0, parseInt(input.value, 10) || 0);
      setItemQty(input.dataset.id, val);
    });
  });

  updateDayPillBadges();
}

function adjustItemQty(itemId, delta) {
  const order = getCustomerOrder(state.activeCustomerId, true);
  order.quantities = order.quantities || {};
  order.quantities[itemId] = order.quantities[itemId] || {};
  const current = parseInt(order.quantities[itemId][state.activeDay] || 0, 10);
  const updated = Math.max(0, current + delta);
  order.quantities[itemId][state.activeDay] = updated;

  renderInvoiceItemCards();
  updateDayPillBadges();
  updateEntrySummary();
  scheduleAutoSave();
}

function setItemQty(itemId, value) {
  const order = getCustomerOrder(state.activeCustomerId, true);
  order.quantities = order.quantities || {};
  order.quantities[itemId] = order.quantities[itemId] || {};
  order.quantities[itemId][state.activeDay] = value;

  updateEntrySummary();
  updateDayPillBadges();
  scheduleAutoSave();

  const card = document.querySelector(`.item-entry-card[data-item-id="${itemId}"]`);
  if (card) {
    const item = state.items.find(i => i.id === itemId);
    if (item) {
      const dayTotal = (value * item.price).toFixed(2);
      const weekUnits = DAYS.reduce((sum, d) => sum + parseInt(order.quantities[itemId][d] || 0, 10), 0);
      const weekPrice = (weekUnits * item.price).toFixed(2);
      card.querySelector('.item-day-total').textContent = `£${dayTotal}`;
      card.querySelector('.item-week-summary').textContent = `Week: ${weekUnits} pcs (£${weekPrice})`;
    }
  }
}

function updateEntrySummary() {
  const order = getCustomerOrder(state.activeCustomerId);
  const totals = calculateOrderTotals(order);
  const dayPrice = totals.dayTotalPrices[state.activeDay] || 0;

  const dayTotalEl = document.getElementById('entryDayTotal');
  const weekTotalEl = document.getElementById('entryWeekTotal');
  if (dayTotalEl) dayTotalEl.textContent = `£${dayPrice.toFixed(2)}`;
  if (weekTotalEl) weekTotalEl.textContent = `£${totals.grandTotal.toFixed(2)}`;
}

// --- REVIEW & SEND END-OF-WEEK MODAL ---
function openReviewSendModal() {
  const modal = document.getElementById('reviewSendModal');
  const subTitle = document.getElementById('reviewSendModalWeekSub');
  const body = document.getElementById('reviewSendModalBody');
  const totalDisplay = document.getElementById('reviewSelectedTotalDisplay');
  const progressBox = document.getElementById('reviewSendProgressBox');

  if (!modal || !body) return;
  if (progressBox) progressBox.style.display = 'none';

  if (subTitle) {
    subTitle.textContent = `Week ending ${formatDateDisplay(state.activeWeekEnding)} (${getWeekRangeText(state.activeWeekEnding)})`;
  }

  const openOrdersWithTotals = [];
  (state.customers || []).filter(c => !c.archived).forEach(cust => {
    const order = getCustomerOrder(cust.id);
    const totals = calculateOrderTotals(order);
    if (totals.grandTotal > 0) {
      openOrdersWithTotals.push({ cust, order, totals });
    }
  });

  if (openOrdersWithTotals.length === 0) {
    showToast('No customer deliveries recorded for this week yet.', 'info');
    return;
  }

  body.innerHTML = openOrdersWithTotals.map(({ cust, order, totals }) => {
    const hasEmail = Boolean(cust.email);
    return `
      <div class="review-send-card" data-order-id="${order.id}">
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <input type="checkbox" class="review-send-checkbox" data-order-id="${order.id}" checked />
          <div>
            <div style="font-weight:700; font-size:15px; color:var(--text);">${cust.name}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:1px;">
              ${hasEmail ? `✉️ ${cust.email}` : '<span style="color:#dc2626; font-weight:700;">⚠️ No email address</span>'}
              · ${totals.weekTotalUnits} pcs
            </div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:15px; font-weight:800; color:var(--primary-dark);">£${totals.grandTotal.toFixed(2)}</div>
          <div style="display:flex; gap:6px; margin-top:4px; justify-content:flex-end;">
            <button type="button" class="btn-table-icon btn-preview-order" data-order-id="${order.id}" title="Preview Invoice">👁️</button>
            <button type="button" class="btn-table-icon btn-share-order" data-order-id="${order.id}" title="Share via WhatsApp / Mail">📲</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  function updateSelectedTotal() {
    let selTotal = 0;
    body.querySelectorAll('.review-send-checkbox:checked').forEach(cb => {
      const orderId = cb.dataset.orderId;
      const item = openOrdersWithTotals.find(x => x.order.id === orderId);
      if (item) selTotal += item.totals.grandTotal;
    });
    if (totalDisplay) totalDisplay.textContent = `£${selTotal.toFixed(2)}`;
  }
  updateSelectedTotal();

  body.querySelectorAll('.review-send-checkbox').forEach(cb => {
    cb.addEventListener('change', updateSelectedTotal);
  });

  body.querySelectorAll('.btn-preview-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      const item = openOrdersWithTotals.find(x => x.order.id === orderId);
      if (item) {
        showInvoicePreviewModal(item.order);
      }
    });
  });

  body.querySelectorAll('.btn-share-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      const item = openOrdersWithTotals.find(x => x.order.id === orderId);
      if (item) {
        shareOrderViaPhoneSheet(item.order);
      }
    });
  });

  modal.style.display = 'flex';
}

async function executeBatchSend() {
  const modal = document.getElementById('reviewSendModal');
  const body = document.getElementById('reviewSendModalBody');
  const progressBox = document.getElementById('reviewSendProgressBox');
  const progressText = document.getElementById('reviewSendProgressText');
  const sendBtn = document.getElementById('btnExecuteBatchSend');

  const checkedBoxes = Array.from(body.querySelectorAll('.review-send-checkbox:checked'));
  if (checkedBoxes.length === 0) {
    alert('Please select at least one customer to send an invoice.');
    return;
  }

  if (!state.settings.hasGmailConfigured) {
    modal.style.display = 'none';
    setRoleMode('admin');
    switchTab('settings');
    showToast('Please configure your Bakery Gmail & 16-character App Password first.', 'info');
    return;
  }

  const missingEmailNames = [];
  const selectedOrders = [];
  checkedBoxes.forEach(cb => {
    const orderId = cb.dataset.orderId;
    const order = state.orders.find(o => o.id === orderId);
    if (order) {
      const cust = state.customers.find(c => c.id === order.customerId);
      const email = (cust?.email || order.customerEmail || '').trim();
      if (!email) {
        missingEmailNames.push(cust?.name || order.company);
      } else {
        selectedOrders.push({ order, cust, email });
      }
    }
  });

  if (missingEmailNames.length > 0) {
    alert(`The following customer(s) have no email address:\n• ${missingEmailNames.join('\n• ')}\n\nPlease add their email addresses before sending, or use 📲 Share.`);
    if (selectedOrders.length === 0) return;
  }

  if (!confirm(`Send ${selectedOrders.length} invoice(s) now via Gmail directly to customer emails?`)) {
    return;
  }

  if (progressBox) progressBox.style.display = 'block';
  if (sendBtn) sendBtn.disabled = true;

  let successCount = 0;
  for (let i = 0; i < selectedOrders.length; i++) {
    const { order, cust, email } = selectedOrders[i];
    if (progressText) {
      progressText.textContent = `Sending ${i + 1} of ${selectedOrders.length}: ${cust?.name || order.company}...`;
    }

    try {
      const invoiceData = calculateCurrentInvoiceData(order);
      const nextNo = state.settings.nextInvoiceNo || 1001;
      invoiceData.invoiceNo = nextNo;
      const pdfBase64 = getInvoicePdfBase64(invoiceData);

      const res = await Api.sendOrder(order.id, {
        mode: 'gmail',
        toEmail: email,
        ccEmail: cust?.ccEmail || order.customerCcEmail,
        company: cust?.name || order.company,
        customerAddress: cust?.address || order.customerAddress,
        grandTotal: invoiceData.grandTotal,
        weekEndingFormatted: invoiceData.weekEndingFormatted,
        items: invoiceData.items,
        pdfBase64
      });

      const invNo = res.invoiceNo || nextNo;
      state.settings.nextInvoiceNo = invNo + 1;

      const cardEl = body.querySelector(`.review-send-card[data-order-id="${order.id}"]`);
      if (cardEl) {
        cardEl.style.background = '#f0fdf4';
        cardEl.innerHTML = `
          <div style="color:#065f46; font-weight:700;">✅ ${cust?.name || order.company}</div>
          <div style="color:#065f46; font-size:12px;">Invoice #${invNo} emailed to ${email}</div>
        `;
      }

      state.orders = state.orders.filter(o => o.id !== order.id);
      successCount++;
    } catch (err) {
      console.error('Batch send error for order:', order.id, err);
      const cardEl = body.querySelector(`.review-send-card[data-order-id="${order.id}"]`);
      if (cardEl) {
        cardEl.style.background = '#fff1f2';
        cardEl.innerHTML = `
          <div style="color:#be123c; font-weight:700;">❌ ${cust?.name || order.company}</div>
          <div style="color:#be123c; font-size:12px;">Failed: ${err.message}</div>
        `;
      }
    }
  }

  if (progressText) {
    progressText.textContent = `✅ Complete! ${successCount} invoice(s) sent.`;
  }
  if (sendBtn) sendBtn.disabled = false;

  showToast(`✅ Successfully sent ${successCount} invoice(s)!`, 'success');
  renderDeliveriesHome();

  setTimeout(() => {
    modal.style.display = 'none';
  }, 1800);
}

// --- FULL WEEK BREAKDOWN MODAL ---
function showWeekBreakdownModal() {
  const modal = document.getElementById('weekBreakdownModal');
  const body = document.getElementById('weekBreakdownModalBody');
  const title = document.getElementById('breakdownModalTitle');
  const sub = document.getElementById('breakdownModalSub');
  const dlBtn = document.getElementById('btnBreakdownDownloadPdf');

  if (!modal || !body) return;
  const order = getCustomerOrder(state.activeCustomerId);
  if (!order) return;

  const data = calculateCurrentInvoiceData(order);
  if (title) title.textContent = `7-Day Breakdown: ${data.company}`;
  if (sub) sub.textContent = `Week Ending: ${data.weekEndingFormatted} · Total: £${data.grandTotal.toFixed(2)}`;

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
            <td colspan="10" style="text-align:right; font-weight:bold;">Grand Total:</td>
            <td style="font-weight:bold; color: #92400e;">£${data.grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  if (dlBtn) {
    dlBtn.onclick = () => {
      data.invoiceNo = 'DRAFT';
      downloadInvoicePdf(data);
    };
  }

  modal.style.display = 'flex';
}

// --- PHONE SHARE SHEET (WHATSAPP / MAIL) ---
async function shareOrderViaPhoneSheet(targetOrder = null) {
  const order = targetOrder || getCustomerOrder(state.activeCustomerId);
  if (!order) return;
  const data = calculateCurrentInvoiceData(order);
  const nextNo = state.settings.nextInvoiceNo || 1001;
  data.invoiceNo = nextNo;

  const pdfFile = getInvoicePdfFile(data);
  const pdfBase64 = getInvoicePdfBase64(data);
  data.pdfBase64 = pdfBase64;

  const subject = `Invoice #${nextNo} – Happyland Bakery – Week ending ${data.weekEndingFormatted}`;
  const bodyText = `Dear ${data.company},

Please find attached your invoice #${nextNo} for the week ending ${data.weekEndingFormatted}.

Total due: £${data.grandTotal.toFixed(2)}

Payment Details:
Bank: ${state.settings.businessName || 'Happyland Bakery Ltd'}
Account Number: ${state.settings.accountNumber || '30623245'}
Sort Code: ${state.settings.sortCode || '20-92-60'}

Thank you for your business,
${state.settings.businessName || 'Happyland Bakery Ltd'}`;

  try {
    if (data.customerEmail && navigator.clipboard) {
      navigator.clipboard.writeText(data.customerEmail).catch(() => {});
    }

    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        files: [pdfFile],
        title: subject,
        text: bodyText
      });
    } else {
      downloadInvoicePdf(data);
      const mailtoUrl = `mailto:${encodeURIComponent(data.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      window.location.href = mailtoUrl;
    }

    const res = await Api.sendOrder(order.id, {
      mode: 'share',
      toEmail: data.customerEmail,
      company: data.company,
      grandTotal: data.grandTotal,
      weekEndingFormatted: data.weekEndingFormatted,
      items: data.items,
      pdfBase64
    });

    const invNo = res.invoiceNo || nextNo;
    state.settings.nextInvoiceNo = invNo + 1;
    state.orders = state.orders.filter(o => o.id !== order.id);

    showToast(`Invoice #${invNo} shared & saved!`, 'success');
    returnToDeliveriesHome();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast(`Share error: ${err.message}`, 'danger');
    }
  }
}

// --- ACTION BUTTONS INITIALIZER ---
function initActionButtons() {
  document.getElementById('btnBackToHome')?.addEventListener('click', () => {
    saveActiveOrder(true);
    returnToDeliveriesHome();
  });

  document.getElementById('btnDoneSaveToday')?.addEventListener('click', async () => {
    await saveActiveOrder(true);
    const cust = state.customers.find(c => c.id === state.activeCustomerId);
    showToast(`✅ Saved ${cust?.name || 'delivery'} – ${DAY_LABELS[state.activeDay]}!`, 'success');
    returnToDeliveriesHome();
  });

  document.getElementById('btnSameAsYesterday')?.addEventListener('click', () => {
    copyYesterdayDelivery();
  });

  document.getElementById('btnToggleDayPills')?.addEventListener('click', () => {
    const wrapper = document.getElementById('dayPillsWrapper');
    const btn = document.getElementById('btnToggleDayPills');
    if (!wrapper) return;
    const isHidden = wrapper.style.display === 'none' || !wrapper.style.display;
    wrapper.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.textContent = isHidden ? 'Hide Day ▴' : 'Change Day ▾';
  });

  document.getElementById('btnViewFullWeek')?.addEventListener('click', () => {
    showWeekBreakdownModal();
  });

  document.getElementById('btnShareSingleCustomer')?.addEventListener('click', () => {
    shareOrderViaPhoneSheet();
  });

  document.getElementById('btnBannerReviewSend')?.addEventListener('click', () => {
    openReviewSendModal();
  });

  document.getElementById('btnStickyReviewSend')?.addEventListener('click', () => {
    openReviewSendModal();
  });

  document.getElementById('btnExecuteBatchSend')?.addEventListener('click', () => {
    executeBatchSend();
  });

  document.getElementById('homeCustomerSearchInput')?.addEventListener('input', () => {
    renderDeliveriesHome();
  });
}

function showInvoicePreviewModal(targetOrder = null) {
  const data = calculateCurrentInvoiceData(targetOrder);
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
          renderDeliveriesHome();
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

    const btnClearAll = document.getElementById('btnClearHistory');
    if (btnClearAll) {
      btnClearAll.style.display = (state.role === 'admin' && invoices.length > 0) ? 'block' : 'none';
    }

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
            <button class="btn-action btn-action-secondary btn-history-download" data-no="${inv.invoiceNo}" style="height:36px; font-size:13px; flex:1;">
              📄 Download PDF
            </button>
            <button class="btn-action btn-action-primary btn-history-resend" data-no="${inv.invoiceNo}" style="height:36px; font-size:13px; flex:1;">
              ✉️ Re-send
            </button>
            <button class="btn-action btn-history-delete" data-no="${inv.invoiceNo}" data-company="${inv.company}" style="height:36px; width:40px; padding:0; font-size:15px; background:#fff1f2; color:#be123c; border:1px solid #fecdd3; border-radius:var(--radius-sm);" title="Delete Invoice #${inv.invoiceNo}">
              🗑️
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
        const origHtml = btn.innerHTML;
        try {
          btn.disabled = true;
          btn.innerHTML = `⏳ Sending...`;
          const detail = await Api.getInvoice(invNo);
          const inv = detail.invoice;
          if (!inv) return;
          if (!inv.customerEmail) {
            alert('This invoice has no saved customer email address.');
            return;
          }

          if (state.settings.hasGmailConfigured) {
            const pdfBase64 = getInvoicePdfBase64(inv);
            await Api.sendInvoiceEmail(invNo, {
              mode: 'gmail',
              customerEmail: inv.customerEmail,
              ccEmail: inv.ccEmail,
              pdfBase64
            });
            showToast(`✅ Invoice #${invNo} sent via Gmail to ${inv.customerEmail}!`, 'success');
            loadHistoryTab();
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
              text: bodyText
            });
            showToast(`Invoice #${invNo} opened in Share Sheet!`, 'success');
          } else {
            downloadInvoicePdf(inv);
            window.location.href = `mailto:${encodeURIComponent(inv.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
            showToast(`Invoice #${invNo} PDF downloaded & Mail opened`, 'success');
          }
        } catch (e) {
          if (e.name !== 'AbortError') showToast(e.message, 'danger');
        } finally {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      });
    });

    container.querySelectorAll('.btn-history-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invNo = parseInt(btn.dataset.no, 10);
        const company = btn.dataset.company || 'Customer';
        if (confirm(`Are you sure you want to delete Invoice #${invNo} (${company}) from history?`)) {
          try {
            await Api.deleteInvoice(invNo);
            showToast(`Invoice #${invNo} deleted`, 'success');
            await loadHistoryTab();
          } catch (e) {
            showToast(e.message, 'danger');
          }
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

  const gmailUserEl = document.getElementById('setGmailUser');
  const gmailPassEl = document.getElementById('setGmailAppPassword');
  const gmailBadgeEl = document.getElementById('gmailStatusBadge');

  if (gmailUserEl) gmailUserEl.value = s.gmailUser || '';
  if (gmailPassEl) {
    gmailPassEl.value = '';
    gmailPassEl.placeholder = s.hasGmailConfigured
      ? '•••••••••••••••• (Saved — leave blank to keep)'
      : 'xxxx xxxx xxxx xxxx';
  }
  if (gmailBadgeEl) {
    if (s.hasGmailConfigured) {
      gmailBadgeEl.textContent = `✅ Connected (${s.gmailUser})`;
      gmailBadgeEl.style.background = '#d1fae5';
      gmailBadgeEl.style.color = '#065f46';
    } else {
      gmailBadgeEl.textContent = '⚠️ Setup Needed';
      gmailBadgeEl.style.background = '#fef3c7';
      gmailBadgeEl.style.color = '#92400e';
    }
  }

  const lockedView = document.getElementById('gmailLockedView');
  const unlockedView = document.getElementById('gmailUnlockedView');
  if (lockedView && unlockedView) {
    if (state.gmailUnlocked) {
      lockedView.style.display = 'none';
      unlockedView.style.display = 'block';
    } else {
      lockedView.style.display = 'block';
      unlockedView.style.display = 'none';
    }
  }

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
      }

      renderDeliveriesHome();
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

  // Unlock Gmail PIN Wall (4124)
  async function handleUnlockGmail() {
    const pinInput = document.getElementById('gmailPinInput');
    const errEl = document.getElementById('gmailPinError');
    const pin = pinInput?.value.trim() || '';
    if (!pin) {
      if (errEl) {
        errEl.textContent = 'Please enter PIN';
        errEl.style.display = 'block';
      }
      return;
    }
    try {
      await Api.unlockGmail(pin);
      state.gmailUnlocked = true;
      sessionStorage.setItem('gmailUnlocked', 'true');
      if (errEl) errEl.style.display = 'none';
      if (pinInput) pinInput.value = '';
      renderSettingsTab();
      showToast('Gmail settings unlocked 🔓', 'success');
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Incorrect PIN';
        errEl.style.display = 'block';
      }
    }
  }

  document.getElementById('btnUnlockGmail')?.addEventListener('click', handleUnlockGmail);
  document.getElementById('gmailPinInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUnlockGmail();
    }
  });

  // Re-lock Gmail PIN Wall
  document.getElementById('btnLockGmail')?.addEventListener('click', () => {
    state.gmailUnlocked = false;
    sessionStorage.removeItem('gmailUnlocked');
    Api.setGmailPin('');
    renderSettingsTab();
    showToast('Gmail settings locked 🔒', 'info');
  });

  // Test & Save Gmail Connection button
  document.getElementById('btnTestGmail')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnTestGmail');
    const gmailUser = document.getElementById('setGmailUser')?.value.trim() || '';
    const gmailAppPassword = document.getElementById('setGmailAppPassword')?.value.trim() || '';

    if (!gmailUser) {
      showToast('Please enter your Bakery Gmail address first.', 'danger');
      return;
    }

    const origText = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.innerHTML = '⏳ Verifying with Gmail...';
      const res = await Api.testGmail({ gmailUser, gmailAppPassword });
      state.settings = res.settings;
      renderSettingsTab();
      showToast(res.message || '✅ Gmail connected & saved!', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  // Settings Save (Admin Only)
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.role !== 'admin') {
      alert('Switch to Admin mode at the top right to update settings.');
      return;
    }

    const updated = {
      businessName: document.getElementById('setBusinessName').value.trim(),
      accountNumber: document.getElementById('setAccountNo').value.trim(),
      sortCode: document.getElementById('setSortCode').value.trim(),
      bccEmail: document.getElementById('setBccEmail').value.trim(),
      nextInvoiceNo: parseInt(document.getElementById('setNextNo').value, 10) || 1001
    };

    // Only submit Gmail credentials if the Gmail PIN wall is unlocked
    if (state.gmailUnlocked) {
      const gmailUser = document.getElementById('setGmailUser')?.value.trim() || '';
      const gmailAppPassword = document.getElementById('setGmailAppPassword')?.value.trim() || '';
      updated.gmailUser = gmailUser;
      if (gmailAppPassword) {
        updated.gmailAppPassword = gmailAppPassword;
      }
    }

    try {
      const res = await Api.saveSettings(updated);
      state.settings = res.settings;
      renderSettingsTab();
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

  // Clear All Invoice History (Admin)
  document.getElementById('btnClearHistory')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL past invoices? This will wipe the history list and cannot be undone.')) {
      try {
        await Api.clearInvoiceHistory();
        showToast('All invoice history cleared', 'success');
        await loadHistoryTab();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    }
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
  const btnClearAll = document.getElementById('btnClearHistory');
  if (btnClearAll) {
    btnClearAll.style.display = (newRole === 'admin') ? 'block' : 'none';
  }
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
