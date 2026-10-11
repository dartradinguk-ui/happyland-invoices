# Happyland Bakery Invoice Tool — Setup & Configuration Guide

This guide takes you through setting up your **multi-phone, one-tap automated invoice generator** for Happyland Bakery Ltd.

---

## 📋 What you will need before starting

1. **Email account** you want to send invoices from (e.g. `accounts@happylandbakery.co.uk` or a Gmail/Outlook address).
2. **Access to your Netlify account** where your current tool is hosted.
3. **A computer / laptop** for the initial 20-30 minute setup. (After setup, everything runs directly on staff phones).

---

## 🚀 STEP 1: Create a GitHub Repository (5 minutes)

Netlify requires a connected Git repository to run backend functions and cloud storage.

1. Go to **[https://github.com/signup](https://github.com/signup)** and log in (or create a free account).
2. Click the **`+`** icon in the top-right corner and select **New repository**.
3. Fill in:
   - **Repository name:** `happyland-invoices`
   - **Privacy:** Choose **Private** (recommended to keep company details private).
   - Tick **Add a README file**.
4. Click **Create repository**.
5. Upload your project files:
   - On the new repository page, click **Add file** → **Upload files**.
   - Open your `Maan` folder on your computer.
   - Select and drag all these files and folders into GitHub:
     - `public/` (entire folder)
     - `netlify/` (entire folder)
     - `netlify.toml`
     - `package.json`
     - `SETUP.md`
   - Click the green **Commit changes** button.

---

## ✉️ STEP 2: Create a Free Brevo Account for Emailing (10 minutes)

Brevo provides **300 free emails per day**, which is more than enough for weekly bakery invoicing.

1. Go to **[https://www.brevo.com](https://www.brevo.com)** and click **Sign up free**.
2. Complete the initial registration and confirm your email address.
3. Fill in the quick business profile:
   - **Company Name:** `Happyland Bakery Ltd`
   - Address and contact phone number.
4. If Brevo asks to verify your phone number via SMS, complete that verification so transactional sending is enabled.

---

## 🔑 STEP 3: Verify Your Sender Email Address in Brevo (5 minutes)

1. In Brevo, click on your **Account Name** (top-right corner).
2. Select **Senders, Domains & Dedicated IPs** → **Senders**.
3. Click **Add a sender**:
   - **From Name:** `Happyland Bakery`
   - **From Email:** The email address you want invoices sent from (e.g. `accounts@happylandbakery.co.uk` or your bakery email).
4. Brevo will send a verification code or link to that email address. Open your inbox, click the link or copy the code, and confirm.
5. The sender status will now show as **Verified**.

---

## 🛡️ STEP 4: Generate Brevo API Key (3 minutes)

1. In Brevo, click your **Account Name** (top-right corner) → **SMTP & API**.
2. Go to the **API Keys** tab.
3. Click **Generate a new API key**.
4. Name it: `happyland-invoice-app`.
5. Click **Generate**.
6. **Important:** Copy the generated key immediately (starts with `xkeysib-...`) and save it in a safe place. Brevo will only show it once.

---

## ⚠️ STEP 5: Turn OFF "Authorised IPs" in Brevo (CRUCIAL)

*Netlify Functions run on dynamic cloud IPs. If Brevo has IP restriction turned on, it will block sending with an "unrecognised IP" error.*

1. In Brevo, go to **Account Settings** → **Security** (or **Authorised IPs**).
2. Ensure **Authorised IPs** is **DISABLED / OFF**.
3. Save changes.

---

## 🌐 STEP 6: Connect Netlify & Add Environment Secrets (10 minutes)

Now connect your existing Netlify site to your new GitHub repository.

1. Log in to **[https://app.netlify.com](https://app.netlify.com)**.
2. Click on your existing invoice website.
3. Go to **Site configuration** → **Build & deploy** → **Continuous deployment**.
4. Click **Link repository** → choose **GitHub** → authorize Netlify → select your `happyland-invoices` repository.
5. Verify build settings:
   - **Branch:** `main`
   - **Build command:** *(leave empty)*
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
6. Click **Deploy site**.

### 6.1 Add Environment Variables in Netlify
1. Go to **Site configuration** → **Environment variables**.
2. Click **Add a variable** → **Add a single variable**. Add each of the following:

| Variable Name | Description | Example Value |
|---|---|---|
| `BREVO_API_KEY` | Your Brevo API key from Step 4 | `xkeysib-0123456789abcdef...` |
| `SENDER_EMAIL` | Verified email address from Step 3 | `accounts@happylandbakery.co.uk` |
| `SENDER_NAME` | Display name on emails | `Happyland Bakery Ltd` |
| `BCC_EMAIL` | Optional: Your email to get a copy | `owner@happylandbakery.co.uk` |
| `STAFF_PIN` | 4-digit PIN for staff phones | `1234` |
| `ADMIN_PIN` | Manager PIN to amend prices & settings | `9999` (or a secure custom code) |

3. After saving all variables, go to **Deploys** → **Trigger deploy** → **Deploy site**.
   *(Environment variables only take effect after a new deployment).*

---

## 📱 STEP 7: Install on Staff Mobile Phones (2 minutes per phone)

Once deployed, staff can install the tool as a standalone web app on their phones:

### On iPhone (Safari):
1. Open your Netlify site URL in Safari.
2. Tap the **Share** button (box with an arrow pointing up at the bottom).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.
5. The **Happyland** icon will appear on your home screen and open in full-screen app mode.

### On Android (Chrome):
1. Open your Netlify site URL in Chrome.
2. Tap the **three dots menu (⋮)** in the top-right corner.
3. Tap **Install app** or **Add to Home screen**.
4. Tap **Install**.

---

## 💡 Everyday Operations Guide

### 1. Logging In on a Phone
- When opened for the first time, the app asks for a PIN.
- Staff enter the **Staff PIN** (`1234`).
- Managers enter the **Admin PIN** (`9999`) to unlock price changes and settings.
- The phone remembers the PIN automatically.

### 2. Creating an Invoice
1. Select the **Customer** from the dropdown.
2. Pick or verify the **Week Ending** date (automatically defaults to the next Sunday).
3. Tap the day pills (`Mon`, `Tue`, `Wed`, etc.) to enter quantities for each day.
4. Use the big **`−`** and **`+`** buttons or type numbers directly.
5. The bottom bar shows the **Total £** updated live.

### 3. One-Tap Automated Send
1. Tap the green **✉️ Send** button.
2. An **Undo Banner** appears: *"Sending invoice to [email] in 5s... [UNDO]"*.
3. If tapped by mistake, tap **UNDO** within 5 seconds to cancel.
4. After 5 seconds, the invoice is saved, numbered, and sent straight to the customer's inbox with the PDF attached.

### 4. Amending Product Prices (Manager Only)
1. Tap the **🔑** icon (top right) or go to ⚙️ **Settings** and enter the **Admin PIN**.
2. Tap the 🥖 **Items** tab.
3. Tap ✏️ on any item to update its price or name, or tap **+ Add Item** to add a new bread or pastry.
4. Changes are updated immediately across all staff phones!

---

## ❓ Frequently Asked Questions & Troubleshooting

- **Q: Email failed to send?**
  - Check that the customer has an email address filled in under the **👥 Customers** tab.
  - Check that `BREVO_API_KEY` is saved in Netlify environment variables and you triggered a deploy.
  - Verify that Brevo's **Authorised IPs** restriction is disabled.
- **Q: Need to change the Staff PIN?**
  - Change `STAFF_PIN` in Netlify Environment Variables and click **Trigger deploy**. All phones will use the new PIN.
- **Q: Want to download a backup?**
  - Go to ⚙️ **Settings** (Admin mode) and tap **📥 Export JSON Backup**.
