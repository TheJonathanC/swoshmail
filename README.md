# Swosh Workspace

A highly polished, unified modern SaaS workspace that seamlessly integrates an email client, a cloud drive, and a real-time chat application into a single cohesive, glassmorphic dark-mode dashboard.

## Structural Overview
Swosh Workspace is split into three main panels, navigable via a unified sidebar:
- **Swoshmail**: A fully functional email client allowing users to compose emails, attach files directly from their local machine, or pull attachments straight from their cloud storage.
- **Swosh Drive**: A recursive file and folder management system mimicking Google Drive. Features drag-and-drop uploads, instant previews, multi-level folder creation, and secure deletion.
- **Swosh Chat**: A real-time, peer-to-peer messaging system featuring live presence indicators (online/offline), message editing/deleting, and a toggleable "Disappearing Mode" (Snapchat-style) that deletes messages permanently the moment they are read.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Frontend**: React 19, TypeScript, Custom CSS (Glassmorphic Dark Mode), custom SVG Icon Library
- **Database & Auth**: Supabase (PostgreSQL, Realtime WebSockets, NextAuth.js Credentials)
- **Blob Storage**: Cloudflare R2 / AWS S3 SDK
- **Email Delivery**: Nodemailer (SMTP)

## Getting Started

### 1. Environment Setup
Create a `.env.local` file in the root directory and populate it with your keys:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_super_secret_key

# Supabase (Database & Realtime)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Cloudflare R2 / AWS S3
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_ACCOUNT_ID=your_account_id
R2_BUCKET_NAME=your_bucket_name
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxxx.r2.dev

# SMTP Email Dispatch
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

### 2. Database Initialization
Run the provided `supabase_setup.sql` script inside your Supabase project's SQL Editor to instantly generate the tables, schemas, and Foreign Key relations required for Users, Files, Emails, and Conversations.

### 3. Installation
Ensure you have Node.js 20+ installed.
```bash
npm install
```

### 4. Run Development Server
```bash
npm run dev
```
Open `http://localhost:3000` to start exploring the Swosh Workspace.
