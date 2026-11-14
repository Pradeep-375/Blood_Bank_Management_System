# Blood Bank and Donor Management System
Full-stack project for SR University – DevOps & Full Stack Development (B.Tech IV Year, AY 2026-27).

## 1. Objectives
Digitise donor registration, blood-unit tracking (group, collection date, expiry), hospital blood requests and stock issue.

## 2. Requirements covered
| Requirement | Where |
|---|---|
| 8+ screens | Login, Register, Dashboard, Donors, Donations & Stock, Blood Requests, Reports, Users (admin), My Profile (donor) |
| Roles | Admin, Blood Bank Staff, Donor, Hospital Representative (JWT + role-based authorisation) |
| Reports | Blood Group Availability, Donor Registration, Blood Request, Blood Stock (view / CSV export / print) |
| Donor eligibility | 90-day gap between donations enforced on every donation |
| Expiry tracking | Units expire 42 days after collection; auto-marked `expired` |
| Request flow | Hospital submits -> staff approve (stock verified) / reject -> staff issue (oldest-expiry-first, transactional) |
| Docker / K8s | `backend/Dockerfile`, `docker-compose.yml`, `k8s/*.yaml` |

## 3. Architecture
Browser SPA (vanilla JS) -> Express REST API (`backend/server.js`) -> PostgreSQL. The API also serves the frontend from `backend/public`, so a single container runs the app.

## 4. Database design (`backend/schema.sql`)
- `users(id, name, email, password_hash, role, hospital_name)`
- `donors(id, user_id→users, blood_group, phone, dob, city)`
- `blood_units(id, donor_id→donors, blood_group, volume_ml, collected_on, expiry_on, status, request_id→blood_requests)`
- `blood_requests(id, hospital_id→users, blood_group, units, urgency, status, note, decided_by→users)`

## 5. API summary
| Method & path | Role | Purpose |
|---|---|---|
| POST /api/auth/register, /api/auth/login | public | Register donor/hospital; login (returns JWT) |
| GET/POST /api/users | admin | List / create staff or admin |
| GET /api/donors | admin, staff | Donors with eligibility |
| GET /api/me | donor | Own profile + donation history |
| GET/POST /api/units | admin, staff | Stock list / record donation |
| GET/POST /api/requests | hospital (own), staff (all) / hospital | List / create requests |
| PUT /api/requests/:id/status | admin, staff | approve / reject |
| POST /api/requests/:id/issue | admin, staff | Issue units |
| GET /api/dashboard | any | Role-specific cards + stock chart |
| GET /api/reports/:availability\|donors\|requests\|stock[?format=csv] | admin, staff | Reports |

## 6. Setup
**Docker (recommended):** `docker compose up --build` -> http://localhost:3000

**Local:** start PostgreSQL, create DB/user `bloodbank`, then
```
cd backend && npm install && npm start
```
Env vars: `DATABASE_URL`, `JWT_SECRET`, `PORT`. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STAFF_EMAIL`, and `STAFF_PASSWORD` to override the seeded accounts. Tables and users are created automatically.

Development default logins: `admin@bloodbank.local / Admin@123`, `staff@bloodbank.local / Staff@123`. These defaults are disabled in production; donors and hospitals self-register.

## 7. Testing (manual scenario)
1. Register a donor (O+) and a hospital. 2. Login as staff -> Donations & Stock -> add a unit for the donor.
3. Add the same donor again -> rejected (not eligible). 4. Login as hospital -> request 1 unit O+.
5. Staff -> Blood Requests -> Approve -> Issue units. 6. Reports -> export CSV. 7. Request more than the stock -> approval blocked.

## 8. Deployment
### Render
1. Push this repository to GitHub and select **New +** -> **Blueprint** in Render.
2. Connect the repository. Render reads `render.yaml` to create the Docker web service and PostgreSQL database.
3. Enter unique values for `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STAFF_EMAIL`, and `STAFF_PASSWORD` when prompted. Render generates `JWT_SECRET` and connects the database automatically.
4. Open the deployed service URL after its health check passes.

The included Blueprint uses Render's free plans for evaluation. Free web services can sleep when idle, and free PostgreSQL databases expire after 30 days; use suitable paid plans for persistent production use. Never use the development default credentials for a live deployment.

### Kubernetes
```
docker build -t bloodbank-app:1.0 ./backend
kubectl apply -f k8s/postgres.yaml -f k8s/app.yaml
kubectl get pods,svc
```
Minikube: `minikube image load bloodbank-app:1.0` then `minikube service bloodbank-service`. Docker Desktop K8s: open http://localhost:30080.
Set a strong `JWT_SECRET`, database credentials, and unique admin/staff email and password environment variables in the Kubernetes Secret before deployment.
