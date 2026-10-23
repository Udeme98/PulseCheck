# PulseCheck

**An API monitoring platform for tracking endpoint health, uptime, and response times.**

PulseCheck is a portfolio project focused on building a reliable, production-minded SaaS application. It is being developed incrementally, with an emphasis on backend architecture, automated testing, background job processing, and operational reliability.

## Project Status 

🚧 **Under active development**

### Planned Features

- User authentication and individual accounts
- Endpoint registration and management
- Configurable HTTP health checks
- Response-time and uptime tracking
- Historical health-check results
- Incident detection based on consecutive failures
- Background job processing for scheduled checks
- Automated tests and reliability improvements

Features will be marked as implemented as development progresses.

## Tech Stack

| Technology | Purpose |
|---|---|
| TypeScript | Application language |
| Next.js | Frontend |
| NestJS | Backend API |
| Prisma | Database ORM and migrations |
| PostgreSQL | Relational database |
| Redis | Background processing infrastructure |
| Docker Compose | Local development services |

## Project Structure

```text
PulseCheck/
├── apps/
│   ├── api/          # NestJS backend and Prisma schema
│   └── web/          # Next.js frontend
├── docker-compose.yml
└── README.md
```

## Getting Started

### Prerequisites

- Node.js and npm
- Docker Desktop
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Udeme98/PulseCheck.git
cd PulseCheck
```

### 2. Start the local infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL and Redis using Docker Compose.

### 3. Configure environment variables

Create `apps/api/.env` with your local PostgreSQL connection string:

```env
DATABASE_URL="postgresql://pulsecheck:YOUR_LOCAL_PASSWORD@localhost:5432/pulsecheck?schema=public"
```

Use the credentials configured in your local Docker Compose file. Never commit `.env` files or production secrets.

### 4. Set up the database

From the API directory:

```bash
cd apps/api
npm install
npx prisma migrate deploy
npx prisma generate
```

### 5. Start the applications

Start the backend API and frontend using the development scripts configured in their respective application directories.

The local development ports are currently:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`

## Engineering Goals

This project is also a practical exercise in:

- Designing maintainable backend modules and APIs
- Working with relational data and database migrations
- Building background jobs and scheduled tasks
- Writing meaningful automated tests
- Handling failures, retries, and service reliability
- Preparing an application for deployment and monitoring

## Development Approach

PulseCheck is being built incrementally, starting with local infrastructure and database setup before moving into application features.

The documentation will evolve alongside the implementation so that setup instructions and feature status remain accurate.

## License

A license has not yet been selected.
