# 🛡️ Swoshmail Console

A beautiful, high-end, password-protected web interface to drag-and-drop backup files and automatically send them directly to your email inbox using Swoshmail. 

Designed to be hosted easily on Vercel with zero database overhead.

---

## ✨ Features

- **🔒 Security Lock Screen**: Single password access control to keep out unauthorized visitors.
- **⏱️ Auto-Lock Session**: Strictly state-based authentication; refreshing the page or closing the tab instantly re-locks the console.
- **📁 Multi-File Upload**: Drag-and-drop or browse multiple files to attach to a single email.
- **📧 Dynamic Routing**: Optional "Send Email To" field allows custom recipient targeting (falls back to default email configuration if empty).
- **🎨 Glassmorphism Design System**: Futuristic dark theme with glowing borders, hover effects, success/error toast notifications, and responsive styling.
- **📈 Real-time Progress Bar**: Displays actual network upload progress during the backup process.
- **⚡ Vercel Limits Alert**: Built-in total file size warning if selection exceeds Vercel's **4.5 MB serverless body request limit**.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, TypeScript)
- **Email Dispatch**: [Nodemailer](https://nodemailer.com/) (using SMTP over SSL)
- **Styling**: Modern CSS Variables & Glassmorphic panels (no heavy styling utilities)

---

## 🚀 Getting Started

### 1. Prerequisites (Generate a Gmail App Password)
Since standard Gmail sign-ins are blocked for security, you must generate a secure **16-character App Password**:
1. Go to your **[Google Account Security settings](https://myaccount.google.com/security)**.
2. Under *"How you sign in to Google"*, ensure **2-Step Verification** is turned on.
3. Search for **App Passwords** or click **2-Step Verification** and scroll down to the **App passwords** section.
4. Name the app descriptively (e.g., `Email Backup Portal`) and click **Create**.
5. Copy the generated 16-character string.

### 2. Configuration
Create a `.env.local` file in the root directory (you can copy the [.env.example](.env.example) template):

```env
# Password to unlock the web console
UPLOAD_PASSWORD=your_secure_console_password

# Gmail SMTP settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
EMAIL_USER=your_sender_gmail@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx  # The 16-character App Password (with or without spaces)
EMAIL_TO=default_recipient_email@gmail.com  # Fallback inbox where attachments will be sent
```

### 3. Local Installation & Development

```bash
# Install dependencies
npm install

# Verify production compilation builds correctly
npm run build

# Start local server at http://localhost:3000
npm run dev
```

---

## ⛅ Hosting on Vercel

This repository is optimized for quick, one-click hosting on Vercel:

1. Push this project to GitHub/GitLab/Bitbucket.
2. Import the repository into the [Vercel Dashboard](https://vercel.com).
3. Under the **Environment Variables** section, copy the variables from your `.env.local` config:
   - `UPLOAD_PASSWORD`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `EMAIL_TO`
4. Click **Deploy**.

> [!WARNING]
> **Vercel Serverless Function Limits**
> Vercel limits serverless request bodies to **4.5 MB**. If the total size of your uploaded files exceeds 4.5 MB, the serverless API will reject the request with a `413 Payload Too Large` error. For backups larger than this limit, deploy the app on serverful hosting platforms like Render, Heroku, or a VPS.
