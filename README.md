# odinbook

Monorepo with:
- `server/`: Express + Passport(JWT) + Prisma + Cloudinary/Multer
- `client/`: React (Vite)

## Quickstart

### 1) Configure server env

Copy the env template:
- `server/.env.example` → `server/.env`

Set at least:
- `JWT_SECRET` (required)

Cloudinary is optional; it’s only required if you use `POST /api/uploads/avatar`.

### 2) Install deps

From repo root:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 3) Migrate DB

```bash
npm run migrate
```

### 4) Run dev

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000/api/health

## Client routes

- `/` home
- `/login`
- `/register`
- `/me` (protected)

## API (current)

- `GET /api/health`
- `POST /api/auth/register` `{ email, password, name? }`
- `POST /api/auth/login` `{ email, password }`
- `GET /api/me` (Bearer token)
- `POST /api/uploads/avatar` (Bearer token, multipart field `avatar`)
