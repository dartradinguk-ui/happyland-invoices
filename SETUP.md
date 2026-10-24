# Happyland Bakery Invoice Tool — Quick Setup Guide

This tool lets staff create invoices on their mobile phones and send them **automatically in 1 tap from your bakery's own Gmail account** (`smtp.gmail.com`) — with the **PDF invoice attached** and the **customer's `To:` email address filled in automatically**.

Every sent invoice also appears in your bakery Gmail's **Sent** folder automatically!

---

## 📧 One-Time Setup: Connect Your Bakery Gmail (Takes 1 Minute)

Because Google protects regular Gmail passwords with 2-Step Verification, Gmail provides a special **16-character App Password** so your invoice app can send emails directly from your Gmail account.

### Step 1: Generate a 16-character Google App Password
1. Sign into your bakery's Google / Gmail account and open:  
   👉 **[https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**  
   *(Note: If Google says App Passwords isn't available, make sure **2-Step Verification** is turned ON first at [myaccount.google.com/signinoptions/two-step-verification](https://myaccount.google.com/signinoptions/two-step-verification)).*
2. Under **App name**, type `Happyland Invoices` and click **Create**.
3. Google will display a **16-letter code** inside a yellow box (e.g. `abcd efgh ijkl mnop`). Copy it.

### Step 2: Save it in the App's Settings Tab
1. Open the Happyland Bakery Invoice app and tap **Admin ⚙️** in the top-right corner.
2. Tap the **⚙️ Settings** tab at the bottom.
3. Under **📧 1-Tap Gmail Auto-Send**:
   - **Bakery Gmail Address**: Enter your Gmail address (e.g. `happylandbakery@gmail.com`).
   - **Gmail 16-Character App Password**: Paste the 16-letter code from Google.
4. Tap **🔌 Test & Save Gmail Connection**.
5. Once the badge turns green (**✅ Connected**), **all staff phones** can send invoices with 1 tap!

*(Optional: You can also set `GMAIL_USER` and `GMAIL_APP_PASSWORD` in Netlify → **Site configuration** → **Environment variables** if you prefer).*

---

## 📱 How Sending Works on Staff Phones

1. On the **Invoice** tab, select the customer and enter quantities for each day (`Mon`–`Sun`).
2. Tap the green **✉️ Send** button at the bottom right:
   - A 5-second **UNDO / Send Now** bar appears at the bottom in case of a mis-tap.
   - The app generates the PDF, attaches it, fills in the customer's **`To:`** email (plus any CC/BCC), and sends it directly through your bakery Gmail!
3. Need to share via WhatsApp, AirDrop, or the phone's Share Sheet instead? Tap **📲 Share** right next to Send.

---

## 📲 How to Install on Staff Phones

### iPhone (Safari):
1. Open your Netlify site URL in Safari.
2. Tap the **Share** button (box with an arrow pointing up at the bottom).
3. Scroll down and tap **Add to Home Screen** → **Add**.

### Android (Chrome):
1. Open your Netlify site URL in Chrome.
2. Tap the **three dots menu (⋮)** in the top-right corner.
3. Tap **Install app** (or **Add to Home screen**).

---

## 🥖 Everyday Usage

| What you want to do | How to do it |
|---|---|
| **Create & send an invoice** | Pick customer → Enter daily quantities → Tap **✉️ Send** (sends automatically via Gmail with PDF attached & `To:` filled in). |
| **Switch between Staff & Admin** | Tap **Staff** or **Admin ⚙️** in the top-right header (instant switch, no PIN needed). |
| **Amend item prices** | Switch to **Admin ⚙️** → Tap 🥖 **Items** → Tap ✏️ to change price or name. Updates across all phones automatically. |
| **Add / edit / delete customers** | Tap 👥 **Customers** → Tap **+ New Customer**, ✏️ Edit, or 🗑️ Delete (in Admin mode). |
| **Re-download or re-send past invoices** | Tap 🗂 **History** → Tap **📄 Download PDF** or **✉️ Re-send**. |
