# Swosh Workspace

A unified, glassmorphic dark-mode productivity dashboard integrating an email client, a cloud drive, and a real-time messaging suite into a single cohesive SaaS workspace.

---

## Key Modules & Features

### 📬 Swoshmail (Email Client)
- **SMTP Email Dispatch**: Fast, reliable email delivery powered by Nodemailer.
- **Dual-Attachment Pipeline**: Attach files directly from your device or link existing files directly from Swosh Drive without re-uploading.
- **Save to Drive Archive**: Optional one-click toggle to automatically save sent attachments into your Swosh Drive.
- **Live Dispatch Feedback**: Progress tracking and animated delivery status toasts.

### 💾 Swosh Drive (Cloud Storage)
- **Multi-File Uploads**: Select and upload multiple files simultaneously with per-file progress tracking.
- **Folder Uploads**: Upload entire directory trees via the dedicated **Upload Folder** button or drag-and-drop, with an interactive choice modal:
  - *Create Subfolder*: Automatically creates the folder in Swosh Drive and uploads all nested files into it.
  - *Upload Flat*: Uploads all files directly into the current directory.
- **Smart Duplicate Conflict Resolution**: Detects name collisions upon upload and offers a clean modal to either **Replace** the existing file or **Keep Both (1)** with automatic numbered suffixing.
- **Inline Previews**: Built-in file previewer for images (PNG, JPG, SVG, WebP, GIF) and code/text documents (TXT, MD, JSON, JS, TS, CSS, HTML, CSV, LOG).
- **Quota Management**: Real-time storage quota tracking with client and server enforcement.
- **Directory Hierarchy**: Create multi-level folders with breadcrumb trail navigation and cascading folder deletion.

### 💬 Swosh Chat (Real-Time Messaging)
- **Message Replies**: Quote any message in the chat with author tag and snippet preview. Clicking a quoted reply smoothly scrolls to and highlights the target message with an animated glow.
- **Dual History Modes**:
  - *Disappearing Mode (Default)*: Ephemeral, Snapchat-style messaging where messages are permanently deleted the moment the recipient views them.
  - *Keep History Mode*: Persistent chat history with automatic sliding-window pruning (capped at 100 messages) to prevent database bloat.
- **Live Presence**: Real-time online/offline participant indicators via Supabase Realtime channels.
- **Message Actions**: Inline editing and permanent deletion for sent messages.
- **Interactive Ping/Pong**: Send `ping` to trigger an automated `pong` response from peer clients.
- **Background Notifications**: Tab title unread counter (`(N) Swosh Chat`) when the workspace is running in a background tab.
- **Keyboard Shortcuts**: Press <kbd>Esc</kbd> to quickly dismiss active reply or edit banners.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| **Frontend** | [React 19](https://react.dev/), TypeScript, Custom Glassmorphism CSS |
| **Database & Realtime** | [Supabase](https://supabase.com/) (PostgreSQL & Realtime WebSockets) |
| **Object Storage** | S3-Compatible Storage ([Cloudflare R2](https://www.cloudflare.com/products/r2/) via `@aws-sdk/client-s3`) |
| **Authentication** | [NextAuth.js](https://next-auth.js.org/) (Credentials Provider) |
| **Mail Dispatch** | [Nodemailer](https://nodemailer.com/) (SMTP) |

---

## Getting Started

### Prerequisites
- **Node.js**: v20.x or v24.x (recommended)
- **npm**: v10.x or higher

### 1. Clone & Install
```bash
git clone https://github.com/TheJonathanC/swoshmail.git
cd swoshmail
npm install
```

### 2. Environment Configuration
Create a `.env.local` file in the root directory (or copy from `.env.example`):

```env
# NextAuth Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret_key

# Supabase (Database & Realtime WebSockets)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Cloudflare R2 / S3 Storage
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_r2_bucket_name

# SMTP Email Dispatch
EMAIL_USER=your_smtp_email@gmail.com
EMAIL_PASS=your_smtp_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

### 3. Database Initialization
Run the provided `supabase_setup.sql` script in your Supabase project's **SQL Editor**. This initializes:
- `users` table with credential hashing
- `files` & `folders` tables for Swosh Drive with cascade constraints
- `conversations` & `messages` tables for Swosh Chat

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/             # NextAuth authentication handlers
│   │   │   ├── chat/             # Swosh Chat endpoints (conversations, messages, toggle)
│   │   │   ├── drive/            # Swosh Drive endpoints (upload, delete, download, preview, folders)
│   │   │   └── send/             # Swoshmail SMTP email dispatch endpoint
│   │   ├── globals.css           # Design system, glassmorphism tokens, and responsive styles
│   │   ├── layout.tsx            # Root layout and session provider
│   │   └── page.tsx              # Main console combining Mail, Drive, and Chat
│   ├── components/
│   │   ├── ChatPanel.tsx         # Realtime chat client with reply, edit, and ephemeral modes
│   │   └── Icons.tsx             # Custom SVG icon library
│   └── lib/
│       ├── auth.ts               # NextAuth configuration and credentials provider
│       ├── crypto.ts             # Cryptographic hashing helpers
│       ├── r2.ts                 # S3 / Cloudflare R2 client and storage utilities
│       ├── rate-limit.ts         # In-memory rate limiting utility
│       └── supabase.ts           # Supabase client instances
├── supabase_setup.sql            # Database schema, indexes, and foreign keys
└── package.json
```

---

## Security & Reliability Highlights
- **Rate Limiting**: Built-in sliding-window rate limiters across all API endpoints (chat, upload, send, auth) to prevent abuse.
- **Storage Quota Enforcement**: Server-validated 1 GB quota check per account preventing unauthorized storage exhaustion.
- **Scoped User Access**: All Drive files, folders, and Chat conversations are strictly validated against the authenticated session user ID.
- **Zero-Migration Metadata**: Swosh Chat reply references are serialized within message content, ensuring full compatibility across any Supabase deployment without manual schema migrations.

