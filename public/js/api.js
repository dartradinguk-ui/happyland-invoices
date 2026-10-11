/**
 * Happyland Bakery - API Client
 * Manages communication with backend /api/* and offline caching
 */

const PIN_STORAGE_KEY = 'happyland_pin';
const ROLE_STORAGE_KEY = 'happyland_role';
const CACHE_STORAGE_KEY = 'happyland_offline_cache';

export const Api = {
  getPin() {
    return localStorage.getItem(PIN_STORAGE_KEY) || '';
  },

  getRole() {
    return localStorage.getItem(ROLE_STORAGE_KEY) || 'admin';
  },

  setRole(role) {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
  },

  setAuth(pin, role) {
    localStorage.setItem(PIN_STORAGE_KEY, pin || '');
    localStorage.setItem(ROLE_STORAGE_KEY, role || 'admin');
  },

  clearAuth() {
    localStorage.removeItem(PIN_STORAGE_KEY);
    localStorage.removeItem(ROLE_STORAGE_KEY);
  },

  async request(path, options = {}) {
    const pin = this.getPin();
    const role = this.getRole();
    const headers = {
      'Content-Type': 'application/json',
      'X-Role': role,
      ...(options.headers || {})
    };

    if (pin) {
      headers['X-Pin'] = pin;
    }

    try {
      const response = await fetch('/api' + path, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(data.error || response.statusText || 'Request failed');
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      // If server unreachable or 404 (e.g. running purely as static file without function), check offline cache
      if (err.name === 'TypeError' || err.status === 404 || err.status === 502) {
        console.warn('API network error, checking offline store fallback:', err.message);
        return this.offlineFallback(path, options, err);
      }
      throw err;
    }
  },

  // Offline / standalone fallback simulation
  offlineFallback(path, options, originalError) {
    let cache = null;
    try {
      cache = JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY));
    } catch (e) {}

    if (!cache) {
      cache = {
        role: this.getRole() || 'staff',
        settings: {
          businessName: 'Happyland Bakery Ltd',
          accountNumber: '30623245',
          sortCode: '20-92-60',
          nextInvoiceNo: 1001,
          emailSubject: 'Invoice #{invoiceNo} – Happyland Bakery – Week ending {weekEnding}',
          emailBody: 'Dear {customer},\n\nPlease find attached invoice #{invoiceNo} for week ending {weekEnding}.\nTotal: £{total}\nBank: Happyland Bakery Ltd, Acc: 30623245, Sort: 20-92-60'
        },
        customers: [
          { id: 'cust_1', name: 'Mayyil 1 - Knightsbridge', email: '', address: 'Knightsbridge' },
          { id: 'cust_2', name: 'Mayyil 2 - Notting Hill Gate', email: '', address: 'Notting Hill Gate' },
          { id: 'cust_3', name: 'Mayyil on the Wheel - Park Royal', email: '', address: 'Park Royal' },
          { id: 'cust_4', name: 'Beit El Zaytoun Park Royal', email: '', address: 'Park Royal' }
        ],
        items: [
          { id: 'item_1', name: 'Baguette', price: 0.55, order: 1, active: true },
          { id: 'item_2', name: 'Burger Bun', price: 0.55, order: 2, active: true },
          { id: 'item_3', name: 'Lebanese Bread Small', price: 0.30, order: 3, active: true },
          { id: 'item_4', name: 'Lebanese Bread Large', price: 0.50, order: 4, active: true }
        ],
        invoices: []
      };
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
    }

    if (path === '/bootstrap') {
      return { ...cache, isOffline: true };
    }
    if (path === '/customers' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const newCust = { id: 'cust_' + Date.now(), ...body };
      cache.customers.push(newCust);
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
      return { success: true, customer: newCust, isOffline: true };
    }
    if (path === '/invoices' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const invNo = cache.settings.nextInvoiceNo || 1001;
      cache.settings.nextInvoiceNo = invNo + 1;
      const inv = { invoiceNo: invNo, ...body, createdAt: new Date().toISOString() };
      cache.invoices.push(inv);
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
      return { success: true, invoiceNo: invNo, invoice: inv, isOffline: true };
    }
    if (path.startsWith('/invoices/') && path.endsWith('/send')) {
      return {
        success: true,
        simulated: true,
        message: 'Offline mode: invoice saved locally. To send live email, connect to Netlify Brevo.'
      };
    }
    if (path === '/invoices' && (!options.method || options.method === 'GET')) {
      return { invoices: cache.invoices || [] };
    }

    throw originalError;
  },

  async login(pin) {
    try {
      const res = await this.request('/login', {
        method: 'POST',
        body: JSON.stringify({ pin })
      });
      this.setAuth(pin, res.role);
      return res;
    } catch (err) {
      // In offline / standalone mode fallback
      if (err.name === 'TypeError' || err.status === 404) {
        const role = (pin === '9999' || pin.length > 5) ? 'admin' : 'staff';
        this.setAuth(pin, role);
        return { success: true, role, isOffline: true };
      }
      throw err;
    }
  },

  async bootstrap() {
    const data = await this.request('/bootstrap');
    // Save to offline cache
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
    return data;
  },

  async saveCustomer(customer) {
    if (customer.id && !customer.id.startsWith('new_')) {
      return this.request(`/customers/${customer.id}`, {
        method: 'PUT',
        body: JSON.stringify(customer)
      });
    } else {
      return this.request('/customers', {
        method: 'POST',
        body: JSON.stringify(customer)
      });
    }
  },

  async deleteCustomer(id) {
    return this.request(`/customers/${id}`, { method: 'DELETE' });
  },

  async saveItem(item) {
    if (item.id && !item.id.startsWith('new_')) {
      return this.request(`/items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify(item)
      });
    } else {
      return this.request('/items', {
        method: 'POST',
        body: JSON.stringify(item)
      });
    }
  },

  async deleteItem(id) {
    return this.request(`/items/${id}`, { method: 'DELETE' });
  },

  async saveSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async createInvoice(invoiceData) {
    return this.request('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoiceData)
    });
  },

  async sendInvoiceEmail(invoiceNo, payload) {
    return this.request(`/invoices/${invoiceNo}/send`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getInvoices() {
    return this.request('/invoices');
  },

  async getInvoice(invoiceNo) {
    return this.request(`/invoices/${invoiceNo}`);
  },

  async exportBackup() {
    return this.request('/backup/export');
  },

  async importBackup(database) {
    return this.request('/backup/import', {
      method: 'POST',
      body: JSON.stringify({ database })
    });
  }
};
