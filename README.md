# ReachInbox
Full-stack email scheduling platform with BullMQ, Redis, PostgreSQL, Google OAuth and Slack notifications.
# ReachInbox – Full-Stack Email Job Scheduler

ReachInbox is a full-stack email scheduling platform that allows users to create email campaigns, upload recipient lists through CSV files, schedule email delivery, and monitor sending activity through a dashboard.

The application uses **BullMQ and Redis** for background job processing, **PostgreSQL** for persistent storage, and **Nodemailer with Ethereal SMTP** for email delivery. It also includes Google authentication and Slack notifications for hourly sending-limit alerts.

## Features

- **Google OAuth Authentication** – Secure user login using Google.
- **Email Campaign Management** – Create and manage email campaigns.
- **CSV Recipient Upload** – Import multiple recipients from CSV files.
- **Scheduled Email Delivery** – Schedule emails for future delivery.
- **Background Job Processing** – Process email jobs using BullMQ and Redis.
- **Persistent Job Queue** – Keep scheduled jobs in Redis across application restarts.
- **Email Retry Mechanism** – Automatically retry failed email jobs with exponential backoff.
- **Hourly Rate Limiting** – Enforce configurable hourly sending limits for each sender.
- **Automatic Rescheduling** – Move emails to the next available hourly slot when a limit is reached.
- **Slack Notifications** – Notify the connected Slack workspace when an hourly sending limit is reached.
- **Bull Board Dashboard** – Monitor queued, active, completed and failed jobs.
- **Email Activity Tracking** – Track scheduled, processing, sent and failed email statuses.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express.js, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Queue | BullMQ |
| Queue Storage | Redis |
| Email Service | Nodemailer, Ethereal SMTP |
| Authentication | Google OAuth, JWT |
| Notifications | Slack OAuth API |
| Job Monitoring | Bull Board |
| HTTP Client | Axios |
| CSV Processing | PapaParse |

## Project Structure

```text
ReachInbox/
│
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   └── schema.prisma
│   │
│   ├── scripts/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── campaigns/
│   │   │   └── slack/
│   │   ├── queues/
│   │   ├── services/
│   │   ├── workers/
│   │   └── server.ts
│   │
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── App.tsx
│   │   ├── App.css
│   │   └── main.tsx
│   │
│   ├── package.json
│   └── .env.example
│
├── .gitignore
└── README.md
```

## Prerequisites

Install the following before running the project:

- Node.js (v20 or later recommended)
- npm
- PostgreSQL
- Redis instance (local or cloud)
- Google OAuth credentials
- Slack application credentials
- Ethereal SMTP credentials

## Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/Sunita1115mondal/ReachInbox.git
cd ReachInbox
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend` directory.

Configure the following environment variables:

```env
DATABASE_URL="postgresql://USERNAME:PASSWORD@localhost:5432/reachinbox_db"

REDIS_URL="your_redis_connection_url"

PORT=5000
FRONTEND_URL=http://localhost:5173

SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=your_ethereal_username
SMTP_PASS=your_ethereal_password
SMTP_FROM="ReachInbox <your_email@example.com>"

WORKER_CONCURRENCY=5

GOOGLE_CLIENT_ID=your_google_client_id
JWT_SECRET=your_secure_jwt_secret
JWT_EXPIRES_IN=1d

SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_REDIRECT_URI=http://localhost:5000/api/slack/callback
SLACK_BOT_TOKEN=your_slack_bot_token
SLACK_TOKEN_ENCRYPTION_KEY=your_64_character_hex_key
SLACK_ALERT_CHANNEL_ID=your_slack_channel_id
```

Use your own credentials. Never commit your `.env` file.

### 3. Database setup

Create a PostgreSQL database named `reachinbox_db`.

Apply the Prisma migrations:

```bash
npx prisma migrate deploy
```

Generate the Prisma Client:

```bash
npx prisma generate
```

### 4. Start the backend

```bash
npm run dev
```

Backend API:

```text
http://localhost:5000
```

Health check:

```text
http://localhost:5000/api/health
```

Bull Board:

```text
http://localhost:5000/admin/queues
```

### 5. Frontend setup

Open another terminal:

```bash
cd frontend
npm install
```

Create a `.env` file inside the `frontend` directory:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

Start the frontend:

```bash
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/google` | Authenticate using Google |

### Campaigns and Emails

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/campaigns` | Create and schedule an email campaign |
| GET | `/api/campaigns` | Retrieve user campaigns |
| GET | `/api/campaigns/emails` | Retrieve email records |
| GET | `/api/campaigns/:id` | Retrieve campaign details |

### Slack Integration

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/slack/connect` | Start Slack OAuth connection |
| GET | `/api/slack/callback` | Handle Slack OAuth callback |

Protected endpoints require a valid JWT bearer token.

## How Email Scheduling Works

1. The user signs in using Google.
2. The user creates a campaign and uploads recipient details.
3. The backend validates the campaign and recipient information.
4. Campaign and email records are stored in PostgreSQL.
5. Email jobs are added to the BullMQ queue with scheduling delays.
6. Redis maintains the queue and delayed jobs.
7. Workers process jobs according to the configured concurrency.
8. Before sending, the worker checks the sender's hourly sending limit.
9. If the limit is reached, the email is rescheduled for the next available slot.
10. A Slack notification is sent when the hourly limit is reached.
11. Emails are delivered through Ethereal SMTP, and their statuses are updated in PostgreSQL.

## Job Monitoring
