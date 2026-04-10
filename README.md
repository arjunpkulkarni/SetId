# WealthSplit Backend API

Production-style FastAPI backend for a bill-splitting application. Supports receipt scanning, item assignment, per-person balance calculation, and Stripe payments.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.115 |
| Language | Python 3.12 |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (mapped_column style) |
| Migrations | Alembic |
| Auth | JWT (python-jose + passlib/bcrypt) |
| Payments | Stripe |
| Validation | Pydantic v2 |
| File Storage | Local filesystem (swap-ready for S3/Supabase) |
| Containerization | Docker + Docker Compose |

---

## Project Structure

```
B-SPLTR/
├── app/
│   ├── main.py                    # FastAPI app, middleware, router registration
│   ├── core/
│   │   ├── config.py              # Settings via pydantic-settings (.env)
│   │   ├── security.py            # JWT encode/decode, bcrypt hashing
│   │   └── response.py            # success_response() / error_response() helpers
│   ├── db/
│   │   ├── base.py                # DeclarativeBase
│   │   └── session.py             # engine, SessionLocal, get_db()
│   ├── models/
│   │   ├── user.py
│   │   ├── bill.py
│   │   ├── bill_member.py
│   │   ├── receipt.py
│   │   ├── receipt_item.py
│   │   ├── item_assignment.py
│   │   ├── payment.py
│   │   ├── settlement.py
│   │   └── notification.py
│   ├── schemas/                   # Pydantic request/response models
│   │   ├── common.py
│   │   ├── auth.py
│   │   ├── user.py
│   │   ├── bill.py
│   │   ├── bill_member.py
│   │   ├── receipt.py
│   │   ├── item_assignment.py
│   │   ├── payment.py
│   │   ├── dashboard.py
│   │   └── notification.py
│   ├── api/
│   │   ├── deps.py                # get_current_user dependency
│   │   └── routes/
│   │       ├── auth.py
│   │       ├── users.py
│   │       ├── bills.py
│   │       ├── members.py
│   │       ├── receipts.py
│   │       ├── assignments.py
│   │       ├── payments.py
│   │       ├── dashboard.py
│   │       ├── invites.py
│   │       └── notifications.py
│   ├── services/
│   │   ├── auth_service.py
│   │   ├── bill_service.py
│   │   ├── receipt_parser_service.py  # Mock OCR — swap for real provider
│   │   ├── calculation_service.py
│   │   ├── payment_service.py
│   │   └── notification_service.py
│   ├── middleware/
│   │   └── error_handler.py       # Global exception handlers
│   └── utils/
│       └── helpers.py
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/                  # Auto-generated migration files go here
├── scripts/
│   └── seed.py                    # Demo data: users, bill, receipt, assignments
├── tests/
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── requirements.txt
└── .env.example
```

---

## Quick Start

### Option A — Docker (recommended)

```bash
# 1. Copy env file
cp .env.example .env

# 2. Start Postgres + API
docker compose up --build

# 3. Run migrations (in a second terminal)
docker compose exec api alembic upgrade head

# 4. Seed demo data
docker compose exec api python -m scripts.seed
```

API available at http://localhost:8000  
Swagger docs at http://localhost:8000/docs

---

### Option B — Local

```bash
# 1. Create and activate virtualenv
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy and edit env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET_KEY, STRIPE keys

# 4. Start Postgres (requires a local instance or use Docker just for DB)
docker compose up db -d

# 5. Run migrations
alembic upgrade head

# 6. Seed demo data
python -m scripts.seed

# 7. Start server
uvicorn app.main:app --reload --port 8000
```

---

## Environment Variables

```bash
# .env

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wealthsplit

JWT_SECRET_KEY=change-me-to-a-random-secret-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

UPLOAD_DIR=./uploads

CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

> **Note:** If `STRIPE_SECRET_KEY` is empty, the payment service generates mock PaymentIntent IDs so you can develop without a Stripe account.

---

## Migrations

```bash
# Create a new migration after changing models
alembic revision --autogenerate -m "describe your change"

# Apply all pending migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1

# View migration history
alembic history
```

---

## Demo Credentials (after seeding)

| User | Email | Password |
|---|---|---|
| Demo User (bill owner) | demo@wealthsplit.com | password123 |
| Jane Smith | jane@example.com | password123 |
| Bob Wilson | bob@example.com | password123 |

---

## Response Format

All endpoints return a consistent JSON envelope:

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable message"
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Human readable error description"
  }
}
```

**Common error codes:**
| Code | Meaning |
|---|---|
| `EMAIL_EXISTS` | Signup with already-registered email |
| `INVALID_CREDENTIALS` | Wrong email or password |
| `NOT_FOUND` | Resource doesn't exist |
| `VALIDATION_ERROR` | Request body failed Pydantic validation |
| `INVALID_TOKEN` | Expired or unknown invite token |
| `PAYMENT_ERROR` | Stripe or payment logic error |
| `WEBHOOK_ERROR` | Invalid Stripe webhook signature |
| `INTERNAL_ERROR` | Unhandled server exception |

---

## Auth Flow

Authentication uses stateless JWT tokens (Bearer scheme).

1. Call `POST /auth/signup` or `POST /auth/login`
2. Receive `access_token` in the response
3. Include in all protected requests:
   ```
   Authorization: Bearer <access_token>
   ```
4. Token expires after `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` (default: 24 hours)
5. `POST /auth/logout` is acknowledged server-side but tokens are stateless — expire naturally

---

## Receipt Parsing

`POST /bills/{bill_id}/receipt/parse` currently uses a **mock OCR service** (`ReceiptParserService`) that returns a realistic 6-item restaurant receipt. To wire in real OCR (Google Vision, AWS Textract, etc.):

1. Open `app/services/receipt_parser_service.py`
2. Replace the `mock_items_data` block in `parse_receipt()` with your OCR provider call
3. Map the provider's output to `ReceiptItem` fields — the rest of the pipeline stays the same

---

## Stripe Integration

### Development (no keys)
Leave `STRIPE_SECRET_KEY` empty. All payment intents return mock IDs like `pi_mock_...`. You can call `POST /payments/{id}/confirm` to manually flip status to `succeeded`.

### Production
1. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`
2. Configure your Stripe dashboard webhook to point to `https://yourdomain.com/webhooks/stripe`
3. Subscribe to events: `payment_intent.succeeded`, `payment_intent.payment_failed`

The webhook handler verifies the Stripe signature and updates payment + member status automatically.

---

## Example curl Requests

### Sign up
```bash
curl -X POST http://localhost:8000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123","full_name":"Your Name"}'
```

### Login
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@wealthsplit.com","password":"password123"}'

# Save the token:
TOKEN="<access_token from response>"
```

### Create a bill
```bash
curl -X POST http://localhost:8000/bills \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Team Lunch","merchant_name":"Chipotle","currency":"USD"}'
```

### Add a member
```bash
curl -X POST http://localhost:8000/bills/<bill_id>/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","nickname":"Jane"}'
```

### Upload a receipt
```bash
curl -X POST http://localhost:8000/bills/<bill_id>/receipt/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/receipt.jpg"
```

### Parse the receipt (mock OCR)
```bash
curl -X POST http://localhost:8000/bills/<bill_id>/receipt/parse \
  -H "Authorization: Bearer $TOKEN"
```

### Auto-split all items equally
```bash
curl -X POST http://localhost:8000/bills/<bill_id>/assignments/auto-split \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Get per-member balance breakdown
```bash
curl http://localhost:8000/bills/<bill_id>/balance-breakdown \
  -H "Authorization: Bearer $TOKEN"
```

### Create a payment intent
```bash
curl -X POST http://localhost:8000/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bill_id":"<bill_id>","member_id":"<member_id>","amount":42.32,"currency":"USD"}'
```

### Generate an invite link
```bash
curl -X POST http://localhost:8000/bills/<bill_id>/invite-link \
  -H "Authorization: Bearer $TOKEN"
# Returns: { "invite_url": "http://localhost:3000/join/<token>", "token": "...", "expires_at": "..." }
```

### Get dashboard overview
```bash
curl http://localhost:8000/dashboard/overview \
  -H "Authorization: Bearer $TOKEN"
```

---

## JavaScript / React Fetch Examples

```js
const API = "http://localhost:8000";

// Auth header helper
const headers = (token) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
});

// Login
const login = async (email, password) => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json(); // { success, data: { access_token, user } }
};

// Create bill
const createBill = async (token, title, merchant_name) => {
  const res = await fetch(`${API}/bills`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title, merchant_name, currency: "USD" }),
  });
  return res.json(); // { success, data: BillOut }
};

// Upload receipt (multipart)
const uploadReceipt = async (token, billId, file) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/bills/${billId}/receipt/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.json(); // { success, data: ReceiptUploadOut }
};

// Parse receipt
const parseReceipt = async (token, billId) => {
  const res = await fetch(`${API}/bills/${billId}/receipt/parse`, {
    method: "POST",
    headers: headers(token),
  });
  return res.json(); // { success, data: ParsedReceipt }
};

// Auto-split among all members
const autoSplit = async (token, billId) => {
  const res = await fetch(`${API}/bills/${billId}/assignments/auto-split`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({}),
  });
  return res.json(); // { success, data: AssignmentOut[] }
};

// Create payment intent
const createPaymentIntent = async (token, billId, memberId, amount) => {
  const res = await fetch(`${API}/payments/create-intent`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ bill_id: billId, member_id: memberId, amount, currency: "USD" }),
  });
  return res.json();
  // { success, data: { stripe_client_secret, id, status, ... } }
  // Pass stripe_client_secret to Stripe.js confirmCardPayment()
};

// Dashboard
const getDashboard = async (token) => {
  const res = await fetch(`${API}/dashboard/overview`, {
    headers: headers(token),
  });
  return res.json();
};
```

---

## Assumptions & Design Notes

1. **Auth is stateless JWT.** No refresh tokens in MVP — extend `security.py` to add a refresh flow when needed. Supabase JWT can be dropped in by replacing `decode_access_token` in `core/security.py`.

2. **Invite tokens are in-memory** (`BillService._invite_tokens` dict). This resets on server restart and doesn't work across multiple API instances. For production, move tokens to a `bill_invites` DB table or Redis.

3. **Receipt parsing is mocked.** `ReceiptParserService.parse_receipt()` always returns the same 6 restaurant items. Drop in any OCR provider by editing that one method.

4. **Tax/tip/fee distribution** is proportional to each member's item subtotal. Members with zero assigned items get zero shares.

5. **Equal split rounding.** Uses `ROUND_HALF_UP` via Python's `Decimal`. The last-penny problem is not explicitly handled — consider adding a reconciliation pass if precision is critical.

6. **File uploads** are stored at `{UPLOAD_DIR}/{bill_id}/{filename}`. To swap to S3 or Supabase Storage, replace the `save_upload` method in `ReceiptParserService` with a boto3/supabase-py call and store the returned URL in `file_path`.

7. **No ownership checks on mutations.** Any authenticated user can currently update any bill. Add `bill.owner_id == current_user.id` guards in route handlers before shipping to production.

8. **Stripe webhook** skips signature verification when `STRIPE_WEBHOOK_SECRET` is not set (safe for local dev). Always set this in production.

---

## FRONTEND ENGINEER ROUTE MAP

All routes return `{ "success": bool, "data": ..., "message": string | null }`.  
Protected routes require `Authorization: Bearer <token>`.

---

### ONBOARDING

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | No | Create account. Body: `{email, password, full_name}`. Returns `{access_token, user}` |
| POST | `/auth/login` | No | Login. Body: `{email, password}`. Returns `{access_token, user}` |
| GET | `/auth/me` | Yes | Get current user brief |
| POST | `/auth/logout` | Yes | Acknowledge logout (token is stateless) |

---

### DASHBOARD

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/overview` | Yes | `{total_bills, active_bills, settled_bills, total_owed_to_you, total_you_owe}` |
| GET | `/dashboard/active-bills` | Yes | List of `ActiveBillSummary` with your_share, paid, remaining per bill |
| GET | `/dashboard/recent-activity` | Yes | Recent activity events `{type, description, bill_id, amount, timestamp}` |
| GET | `/dashboard/outstanding-balance` | Yes | `{total_you_owe, total_owed_to_you, net_balance}` |
| GET | `/users/me` | Yes | Full user profile |
| PATCH | `/users/me` | Yes | Update profile. Body: `{full_name?, avatar_url?, phone?}` |

---

### BILL DETAILS

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bills` | Yes | Create bill. Body: `{title, merchant_name?, currency?, notes?}` |
| GET | `/bills` | Yes | List all user's bills. Query: `?status=draft\|active\|settled` |
| GET | `/bills/{bill_id}` | Yes | Single bill with member_count |
| PATCH | `/bills/{bill_id}` | Yes | Update bill fields (title, tax, tip, status, etc.) |
| DELETE | `/bills/{bill_id}` | Yes | Delete bill and all related data |
| GET | `/bills/{bill_id}/summary` | Yes | Full summary: bill + members + items + totals |
| GET | `/bills/{bill_id}/activity` | Yes | Activity log for the bill |
| GET | `/bills/{bill_id}/member-balances` | Yes | `[{member_id, nickname, total_owed, total_paid, balance}]` |
| GET | `/bills/{bill_id}/balance-breakdown` | Yes | Per-member subtotal + tax_share + tip_share + fee_share breakdown |

---

### MEMBERS

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bills/{bill_id}/members` | Yes | Add member. Body: `{nickname, user_id?, email?}` |
| GET | `/bills/{bill_id}/members` | Yes | List bill members with status |
| PATCH | `/bills/{bill_id}/members/{member_id}` | Yes | Update member. Body: `{nickname?, status?}` |
| DELETE | `/bills/{bill_id}/members/{member_id}` | Yes | Remove member |
| POST | `/bills/{bill_id}/invite-link` | Yes | Generate 24-hour invite link. Returns `{invite_url, token, expires_at}` |
| GET | `/users/search?q=` | Yes | Search users by name or email for adding |

---

### RECEIPT SCAN

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bills/{bill_id}/receipt/upload` | Yes | Upload receipt image (multipart/form-data, field: `file`) |
| GET | `/bills/{bill_id}/receipt` | Yes | Get receipt upload metadata |
| POST | `/bills/{bill_id}/receipt/parse` | Yes | Parse receipt → returns `{merchant_name, items[], subtotal, tax, total}` |
| GET | `/bills/{bill_id}/receipt/items` | Yes | List all parsed receipt items |
| PATCH | `/bills/{bill_id}/receipt/items/{item_id}` | Yes | Edit item. Body: `{name?, quantity?, unit_price?, total_price?, category?, is_taxable?}` |

**ParsedReceipt item shape:**
```json
{
  "id": "uuid",
  "name": "Margherita Pizza",
  "quantity": 1,
  "unit_price": "14.99",
  "total_price": "14.99",
  "category": "Entree",
  "confidence": 0.95,
  "is_taxable": true,
  "sort_order": 0
}
```

---

### ITEM ASSIGNMENT

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bills/{bill_id}/assignments` | Yes | Bulk create assignments. Body: `{assignments: [{receipt_item_id, bill_member_id, share_type, share_value}]}` |
| GET | `/bills/{bill_id}/assignments` | Yes | List all assignments with item_name and member_nickname |
| PATCH | `/bills/{bill_id}/assignments/{assignment_id}` | Yes | Update share_type or share_value |
| DELETE | `/bills/{bill_id}/assignments/{assignment_id}` | Yes | Remove assignment |
| POST | `/bills/{bill_id}/assignments/auto-split` | Yes | Equal-split all items. Body: `{member_ids?: [uuid]}` (null = all members) |
| POST | `/bills/{bill_id}/recalculate` | Yes | Recalculate all amounts after manual edits |

**share_type values:** `"equal"` | `"percentage"` | `"fixed"`

---

### CHECKOUT / PAYMENT

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/create-intent` | Yes | Create Stripe PaymentIntent. Body: `{bill_id, member_id, amount, currency}`. Returns `stripe_client_secret` |
| GET | `/payments/{payment_id}` | Yes | Get payment record |
| POST | `/payments/{payment_id}/confirm` | Yes | Manually confirm payment (dev/testing) |
| GET | `/bills/{bill_id}/payments` | Yes | List all payments for a bill |
| POST | `/webhooks/stripe` | No | Stripe webhook endpoint (set in Stripe dashboard) |

**Stripe frontend flow:**
```js
const { data } = await createPaymentIntent(token, billId, memberId, amount);
const result = await stripe.confirmCardPayment(data.stripe_client_secret, {
  payment_method: { card: cardElement }
});
// Stripe fires webhook → backend updates payment to succeeded
```

---

### INVITES / SHARING

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bills/{bill_id}/share` | Yes | Generate shareable link (same as invite-link) |
| GET | `/invites/{token}` | No | Validate token and get bill info (public — show on join page) |
| POST | `/bills/{bill_id}/join` | Yes | Join bill with token. Body: `{token: "..."}` |

---

### NOTIFICATIONS

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | Yes | List notifications. Query: `?unread_only=true` |
| PATCH | `/notifications/{notification_id}/read` | Yes | Mark notification as read |

**Notification types:** `bill_invite`, `payment_received`, `bill_settled`, `member_joined`

---

### MISC

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check `{status: "healthy"}` |
| GET | `/docs` | No | Swagger UI |
| GET | `/redoc` | No | ReDoc UI |
| GET | `/users/search?q=` | Yes | Search users by name/email |
| GET | `/users/{user_id}` | Yes | Get any user's public profile |
| POST | `/users/invite` | Yes | Send email invite (stub — wire to email provider) |
# B-SPLTR
