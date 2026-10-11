# Happyland Bakery Invoice Tool — Quick Setup Guide

This tool lets staff create invoices on their mobile phones and send them **directly through their phone's local default email app (Apple Mail on iPhone, Gmail on Android)** with the **PDF already attached**.

No third-party email services (like Brevo) or API keys are required.

---

## 📱 How Sending Works on Staff Phones

1. On the **Invoice** tab, select the customer and enter quantities for each day.
2. Tap the green **✉️ Send** button.
3. Your phone's native **Share / Mail menu** opens immediately:
   - The **PDF invoice is already attached** as a real PDF file!
   - The **Subject** is prefilled (e.g. `Invoice #1001 – Happyland Bakery – Week ending 18.10.2026`).
   - The **Email body** is prefilled with payment details and summary.
   - The customer's email address is automatically copied to your phone's clipboard, ready to paste into the **To:** field with one tap.
4. Tap **Send** in your email app. Done!
5. The invoice is automatically numbered and saved to your shared **History** across all staff phones.

---

## 🚀 3-Minute Netlify Deployment Guide

Your code is already committed to GitHub at:  
👉 **[https://github.com/dartradinguk-ui/happyland-invoices](https://github.com/dartradinguk-ui/happyland-invoices)**

### Step 1: Connect Netlify to your GitHub Repo
1. Log in at **[app.netlify.com](https://app.netlify.com)** and open your invoice site.
2. Go to **Site configuration** → **Build & deploy** → **Continuous deployment**.
3. Click **Link repository** → choose **GitHub** → select `dartradinguk-ui/happyland-invoices`.
4. Netlify will auto-detect settings from `netlify.toml`:
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
5. Click **Save**.

### Step 2: Set your Staff & Admin PINs
1. In Netlify, go to **Site configuration** → **Environment variables**.
2. Click **Add a variable** → **Add a single variable**:
   - `STAFF_PIN`: `1234` *(Shared with staff to create & send invoices)*
   - `ADMIN_PIN`: `9999` *(Manager PIN to amend item prices and bank details)*
3. Go to **Deploys** → **Trigger deploy** → **Deploy site**.

---

## 📲 How to Install on Staff Phones

### iPhone (Safari):
1. Open your Netlify site URL in Safari.
2. Tap the **Share** button (box with an arrow pointing up at the bottom).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.
5. The **Happyland** app icon will appear on your home screen and open in full-screen mode like a native app.

### Android (Chrome):
1. Open your Netlify site URL in Chrome.
2. Tap the **three dots menu (⋮)** in the top-right corner.
3. Tap **Install app** (or **Add to Home screen**).
4. Tap **Install**.

---

## 🥖 Everyday Usage

| What you want to do | How to do it |
|---|---|
| **Create an invoice** | Open app → Pick customer → Tap day pills (`Mon`–`Sun`) → Use `−` and `+` buttons to enter quantities. |
| **Send with attached PDF** | Tap **✉️ Send** → Your phone's Mail/Gmail opens with the PDF attached → Tap Send. |
| **Amend item prices** *(Manager)* | Enter **Admin PIN** (top-right 🔑) → Tap 🥖 **Items** → Tap ✏️ to change price or name. Applies across all phones immediately. |
| **Add / edit customers** | Tap 👥 **Customers** → Tap **+ New Customer** or ✏️ to edit email & address. |
| **Re-download past invoices** | Tap 🗂 **History** → Tap **📄 Download PDF** or **✉️ Re-send**. |
| **Export backup** *(Manager)* | Go to ⚙️ **Settings** → Tap **📥 Export JSON Backup**. |
