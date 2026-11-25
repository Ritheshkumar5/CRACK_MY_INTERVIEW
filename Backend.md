# Backend.md — Crack My Interview

> **Practice Smart. Perform Better. Get Hired.**
> Backend specification for the *Crack My Interview* interview preparation platform.

---

## 1. Overview

| Item | Value |
|---|---|
| Framework | Python **Flask** |
| Database | **SQLite** (`crack_my_interview.db`) |
| Structure | **Single file: `app.py`** |
| Auth | Flask `session` (signed cookie) |
| Password hashing | `werkzeug.security` (`generate_password_hash` / `check_password_hash`) |
| Response format | JSON (frontend calls with `fetch`) |
| CORS | `flask-cors` with `supports_credentials=True` |
| Python | 3.9+ |

### 1.1 Project Structure

```
crack-my-interview/
├── app.py                      # entire backend (routes, DB, seed data)
├── crack_my_interview.db       # auto-created on first run
├── requirements.txt
└── (frontend files: index.html, login.html, css/, js/ ...)
```

### 1.2 `requirements.txt`

```
Flask==3.0.3
Flask-Cors==4.0.1
Werkzeug==3.0.3
```

### 1.3 Run

```bash
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5000
```

---

## 2. Database Schema (SQLite)

Database file: `crack_my_interview.db`. Foreign keys are enabled with `PRAGMA foreign_keys = ON` on every connection.

### 2.1 `users`

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| name | TEXT | NOT NULL |
| email | TEXT | NOT NULL UNIQUE |
| password | TEXT | NOT NULL (**hashed**, never plain text) |
| college | TEXT | |
| department | TEXT | |

### 2.2 `questions`

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| category | TEXT | NOT NULL — `HR`, `Technical`, `Aptitude`, `Coding` |
| level | TEXT | NOT NULL — `Beginner`, `Intermediate`, `Advanced` |
| question | TEXT | NOT NULL |
| option1 | TEXT | NOT NULL |
| option2 | TEXT | NOT NULL |
| option3 | TEXT | NOT NULL |
| option4 | TEXT | NOT NULL |
| correct_answer | TEXT | NOT NULL — **the exact text** of the correct option (must equal one of option1–4) |

### 2.3 `results`

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| user_id | INTEGER | NOT NULL, FOREIGN KEY → `users(id)` ON DELETE CASCADE |
| category | TEXT | NOT NULL |
| score | INTEGER | NOT NULL (number of correct answers) |
| total | INTEGER | NOT NULL (number of questions attempted in the mock) |
| date | TEXT | NOT NULL (`YYYY-MM-DD HH:MM:SS`, server local time) |

### 2.4 Relationships

```
users (1) ────< (M) results
questions  → standalone question pool (queried by category + level)
```

### 2.5 SQL (executed by `init_db()`)

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    college TEXT,
    department TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    level TEXT NOT NULL,
    question TEXT NOT NULL,
    option1 TEXT NOT NULL,
    option2 TEXT NOT NULL,
    option3 TEXT NOT NULL,
    option4 TEXT NOT NULL,
    correct_answer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 3. Password Hashing

- Library: `werkzeug.security`.
- On **register**: `generate_password_hash(password)` → stores a salted hash (default `scrypt`/`pbkdf2` with random salt) in `users.password`.
- On **login**: `check_password_hash(stored_hash, entered_password)`.
- Plain-text passwords are **never** stored or logged.
- Login failures return one generic message — *"Invalid email or password"* — so attackers can't tell which field was wrong.

```python
from werkzeug.security import generate_password_hash, check_password_hash

hashed = generate_password_hash("MyPass123")        # store this
check_password_hash(hashed, "MyPass123")            # True
check_password_hash(hashed, "wrong")                # False
```

---

## 4. Security Rules

| Rule | Implementation |
|---|---|
| SQL injection | Only parameterised queries (`?` placeholders) |
| Session | `app.secret_key` from env var; `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE="Lax"` |
| Protected routes | `@login_required` decorator → `401` JSON if no session |
| Data isolation | Every `results` query filters by `session["user_id"]` |
| Answer leakage | `/start-mock` and `/question-bank` **never** return `correct_answer` |
| Cheating guard | Mock question IDs are stored **server-side in the session**; `/submit-mock` grades only those IDs |
| Validation | Server re-validates all inputs (never trust the frontend) |

---

## 5. API Reference

**Base URL:** `http://127.0.0.1:5000`
**Content-Type:** `application/json`
**Auth:** session cookie (`credentials: "include"` on the frontend).

### 5.0 Standard Response Format

```json
// success
{ "success": true, "message": "…", "data": { } }

// error
{ "success": false, "message": "Human readable error" }
```

| HTTP | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Validation error / bad input |
| 401 | Not logged in / invalid credentials |
| 404 | Not found |
| 409 | Conflict (email already registered) |
| 500 | Server error |

### 5.1 Route Summary

| # | Method | Route | Auth | Purpose |
|---|---|---|---|---|
| 1 | POST | `/register` | No | Create account |
| 2 | POST | `/login` | No | Sign in, start session |
| 3 | GET / POST | `/logout` | Yes | Clear session |
| 4 | GET | `/profile` | Yes | Get current user profile |
| 4b | PUT | `/profile` | Yes | Update profile / change password |
| 5 | GET | `/question-bank` | Yes | List/filter questions |
| 6 | POST | `/start-mock` | Yes | Start mock interview, get random questions |
| 7 | POST | `/submit-mock` | Yes | Submit answers, calculate and save score |
| 8 | GET | `/result?id=<result_id>` | Yes | Get one result with answer details |
| 9 | GET | `/report` | Yes | History + performance statistics |

---

### 5.2 `POST /register`

**Request**
```json
{
  "name": "Rithesh Kumar",
  "email": "rithesh@example.com",
  "password": "Pass@1234",
  "confirm_password": "Pass@1234",
  "college": "ABC Engineering College",
  "department": "Computer Science"
}
```

**Validation**
- `name`, `email`, `password`, `confirm_password` required.
- Email matches a basic email pattern; stored lowercase & trimmed.
- Password ≥ 8 chars, contains a letter and a number.
- `password == confirm_password`.
- `college`, `department` optional.

**Responses**
| Code | Body |
|---|---|
| 201 | `{"success":true,"message":"Registration successful. Please login."}` |
| 400 | `{"success":false,"message":"Password must be at least 8 characters with a letter and a number"}` |
| 409 | `{"success":false,"message":"Email already registered"}` |

---

### 5.3 `POST /login`

**Request**
```json
{ "email": "rithesh@example.com", "password": "Pass@1234" }
```

**Logic:** fetch user by email → `check_password_hash` → on success set `session["user_id"]`, `session["name"]`.

**Responses**
```json
// 200
{
  "success": true,
  "message": "Login successful",
  "data": { "id": 1, "name": "Rithesh Kumar", "email": "rithesh@example.com" }
}
// 401
{ "success": false, "message": "Invalid email or password" }
```

---

### 5.4 `/logout` (GET or POST)

Calls `session.clear()`.

```json
// 200
{ "success": true, "message": "Logged out successfully" }
```
Frontend then redirects to `login.html`.

---

### 5.5 `GET /profile`

```json
// 200
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Rithesh Kumar",
    "email": "rithesh@example.com",
    "college": "ABC Engineering College",
    "department": "Computer Science"
  }
}
```
The `password` field is **never** returned.

### 5.5b `PUT /profile`

**Update details**
```json
{ "name": "Rithesh K", "college": "ABC Engineering College", "department": "CSE" }
```

**Change password (optional, same route)**
```json
{ "current_password": "Pass@1234", "new_password": "NewPass@5678" }
```
- Email is **not** editable.
- Password change requires a correct `current_password`; new password follows the same rules as register and is re-hashed.

```json
// 200
{ "success": true, "message": "Profile updated successfully" }
// 400
{ "success": false, "message": "Current password is incorrect" }
```

---

### 5.6 `GET /question-bank`

**Query params (all optional, combinable)**

| Param | Values |
|---|---|
| `category` | `HR`, `Technical`, `Aptitude`, `Coding` |
| `level` | `Beginner`, `Intermediate`, `Advanced` |
| `page` | default `1` |
| `limit` | default `10`, max `50` |

**Example:** `GET /question-bank?category=Technical&level=Beginner`

```json
{
  "success": true,
  "data": {
    "total": 2,
    "page": 1,
    "questions": [
      {
        "id": 6,
        "category": "Technical",
        "level": "Beginner",
        "question": "Which data structure follows the LIFO principle?",
        "options": ["Queue", "Stack", "Array", "Linked List"]
      }
    ]
  }
}
```
`correct_answer` is **not** included here. (Optional: add `?show_answer=1` if the frontend "Show Answer" button should reveal it — then include `correct_answer` in the payload.)

---

### 5.7 `POST /start-mock`

**Request**
```json
{ "category": "Technical", "level": "Beginner", "count": 5 }
```

**Logic**
1. Validate category/level/count (`count` 1–20).
2. `SELECT … WHERE category=? AND level=? ORDER BY RANDOM() LIMIT ?`.
3. If fewer questions than requested → return what exists and add a `warning`.
4. If none → `404`.
5. Save in session: `session["mock"] = {"ids":[…], "category":"Technical", "level":"Beginner", "started_at": "<iso>"}`.
6. Return questions **without** `correct_answer`.

```json
{
  "success": true,
  "message": "Mock interview started",
  "warning": null,
  "data": {
    "category": "Technical",
    "level": "Beginner",
    "total": 5,
    "questions": [
      {
        "id": 6,
        "question": "Which data structure follows the LIFO principle?",
        "options": ["Queue", "Stack", "Array", "Linked List"]
      }
    ]
  }
}
```

---

### 5.8 `POST /submit-mock`

**Request**
```json
{
  "answers": [
    { "question_id": 6, "answer": "Stack" },
    { "question_id": 7, "answer": "DISTINCT" },
    { "question_id": 8, "answer": null }
  ]
}
```
`answer` is the selected option **text**; `null` / missing = unanswered.

**Logic**
1. Require an active `session["mock"]` (else `400` *"No active mock interview"*).
2. Load questions **only for the IDs stored in the session**.
3. For each question compare `answer` with `correct_answer` (case-insensitive, trimmed) → `correct` / `incorrect` / `unanswered`.
4. `score` = number correct, `total` = number of questions in the mock.
5. `INSERT INTO results (user_id, category, score, total, date)`.
6. Clear `session["mock"]` (prevents re-submission).
7. Return the new `result_id`.

```json
{
  "success": true,
  "message": "Mock interview submitted",
  "data": { "result_id": 12, "score": 4, "total": 5, "percentage": 80.0 }
}
```
Frontend then opens `result.html?id=12`.

---

### 5.9 `GET /result?id=<result_id>`

Returns the saved score for the logged-in user's own result. If `id` is omitted, returns the **latest** result. Requesting another user's result → `404`.

Because the `results` table stores only the score summary, per-question review comes from the **last submission kept in the session** (`session["last_review"]`, saved by `/submit-mock`) when `id` matches the latest result; otherwise `review` is `null`.

```json
{
  "success": true,
  "data": {
    "id": 12,
    "category": "Technical",
    "score": 4,
    "total": 5,
    "percentage": 80.0,
    "grade": "Excellent",
    "date": "2026-11-21 15:30:00",
    "correct": 4,
    "incorrect": 1,
    "unanswered": 0,
    "feedback": {
      "strengths": "Strong performance in Technical (80%).",
      "weaknesses": null,
      "suggestions": "Try the Intermediate level next."
    },
    "review": [
      {
        "question_id": 6,
        "question": "Which data structure follows the LIFO principle?",
        "your_answer": "Stack",
        "correct_answer": "Stack",
        "status": "correct"
      }
    ]
  }
}
```

**Grade & feedback rules (computed in code, nothing is stored)**

| Percentage | Grade | Suggestion |
|---|---|---|
| ≥ 80 | Excellent | Move to the next level |
| 60 – 79 | Good | Practise more questions at this level |
| 40 – 59 | Average | Revise the basics of this category |
| < 40 | Needs Improvement | Start with Beginner questions and review concepts |

Feedback is rule-based on percentages — it is **not** AI evaluation and must not be described as such.

---

### 5.10 `GET /report`

Returns the user's full history and aggregate statistics.

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_interviews": 6,
      "average_percentage": 68.3,
      "highest_percentage": 90.0,
      "strongest_category": "HR",
      "weakest_category": "Aptitude",
      "improvement_percentage": 25.0
    },
    "category_stats": [
      { "category": "HR", "attempts": 2, "average_percentage": 85.0 },
      { "category": "Aptitude", "attempts": 1, "average_percentage": 40.0 }
    ],
    "history": [
      { "id": 12, "date": "2026-11-21 15:30:00", "category": "Technical", "score": 4, "total": 5, "percentage": 80.0 }
    ]
  }
}
```

**Calculations**
- `percentage = score / total × 100` (round to 1 decimal; `total = 0` → `0`).
- `improvement_percentage = ((latest − previous) / previous) × 100`, comparing the two most recent attempts. If there is no previous attempt or `previous = 0` → `null` (the frontend shows "N/A").
- `strongest_category` / `weakest_category` → highest / lowest average percentage (only when ≥ 2 categories have data, else `null`).
- `history` sorted by `date DESC`.

---

## 6. Complete `app.py`

```python
import os
import re
import sqlite3
import random
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, session, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

# ----------------------------------------------------------------------
# App setup
# ----------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-in-production")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
CORS(app, supports_credentials=True)

DATABASE = "crack_my_interview.db"
CATEGORIES = ["HR", "Technical", "Aptitude", "Coding"]
LEVELS = ["Beginner", "Intermediate", "Advanced"]
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ----------------------------------------------------------------------
# Database helpers
# ----------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


SEED_QUESTIONS = [
    # (category, level, question, option1, option2, option3, option4, correct_answer)
    # ---------------- HR ----------------
    ("HR", "Beginner", "Tell me about yourself.",
     "Give a brief summary of your education, skills and goals", "Recite your entire life story",
     "Say you have nothing to share", "Ask the interviewer to answer first",
     "Give a brief summary of your education, skills and goals"),
    ("HR", "Beginner", "What is your greatest strength?",
     "Say you are perfect at everything", "Pick a relevant strength and support it with an example",
     "Avoid answering the question", "Mention a skill unrelated to the job",
     "Pick a relevant strength and support it with an example"),
    ("HR", "Intermediate", "How do you handle tight deadlines?",
     "Ignore the deadline", "Wait until the last day to start",
     "Prioritise tasks, plan, and communicate risks early", "Blame teammates for delays",
     "Prioritise tasks, plan, and communicate risks early"),
    ("HR", "Intermediate", "Why should we hire you?",
     "Because I need a job badly", "Because other candidates are weaker",
     "I have no particular reason", "Because my skills and attitude match the role's needs",
     "Because my skills and attitude match the role's needs"),
    ("HR", "Advanced", "How do you respond when your manager criticises your work?",
     "Argue immediately", "Listen, ask clarifying questions and act on the feedback",
     "Ignore the feedback", "Take it personally and withdraw",
     "Listen, ask clarifying questions and act on the feedback"),

    # ---------------- Technical ----------------
    ("Technical", "Beginner", "Which data structure follows the LIFO principle?",
     "Queue", "Stack", "Array", "Linked List", "Stack"),
    ("Technical", "Beginner", "Which SQL keyword removes duplicate rows from a result set?",
     "UNIQUE", "DISTINCT", "REMOVE", "DROP", "DISTINCT"),
    ("Technical", "Intermediate", "What is the time complexity of binary search?",
     "O(n)", "O(n log n)", "O(log n)", "O(1)", "O(log n)"),
    ("Technical", "Intermediate", "Which OOP concept bundles data and methods and restricts direct access to them?",
     "Inheritance", "Polymorphism", "Encapsulation", "Recursion", "Encapsulation"),
    ("Technical", "Advanced", "Which HTTP method is idempotent and is used to fully replace a resource?",
     "POST", "PUT", "CONNECT", "TRACE", "PUT"),

    # ---------------- Aptitude ----------------
    ("Aptitude", "Beginner", "What is 20% of 250?",
     "25", "40", "50", "60", "50"),
    ("Aptitude", "Beginner", "A train travels 120 km in 2 hours. What is its speed?",
     "50 km/h", "60 km/h", "70 km/h", "240 km/h", "60 km/h"),
    ("Aptitude", "Intermediate", "Find the next number: 2, 6, 12, 20, 30, ?",
     "38", "40", "42", "44", "42"),
    ("Aptitude", "Intermediate", "If the cost price is 400 and the selling price is 500, what is the profit percentage?",
     "20%", "25%", "30%", "100%", "25%"),
    ("Aptitude", "Advanced", "Two fair dice are rolled. What is the probability that the sum is 7?",
     "1/12", "1/9", "1/6", "7/36", "1/6"),

    # ---------------- Coding (Python) ----------------
    ("Coding", "Beginner", "What is the output of print(len('hello'))?",
     "4", "5", "6", "Error", "5"),
    ("Coding", "Beginner", "Which Python expression reverses the string s?",
     "s.reverse()", "s[::-1]", "reverse(s)", "s[-1]", "s[::-1]"),
    ("Coding", "Intermediate", "What is the output of print(10 // 3)?",
     "3.33", "3", "4", "1", "3"),
    ("Coding", "Intermediate", "Which of these Python data types is immutable?",
     "list", "dict", "set", "tuple", "tuple"),
    ("Coding", "Advanced", "What is the output of print([x * x for x in range(4)])?",
     "[1, 4, 9, 16]", "[0, 1, 4, 9]", "[0, 1, 2, 3]", "[1, 2, 3, 4]", "[0, 1, 4, 9]"),
]


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            college TEXT,
            department TEXT
        );
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            level TEXT NOT NULL,
            question TEXT NOT NULL,
            option1 TEXT NOT NULL,
            option2 TEXT NOT NULL,
            option3 TEXT NOT NULL,
            option4 TEXT NOT NULL,
            correct_answer TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            date TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """)
    if db.execute("SELECT COUNT(*) FROM questions").fetchone()[0] == 0:
        db.executemany(
            "INSERT INTO questions (category, level, question, option1, option2, option3, option4, correct_answer) "
            "VALUES (?,?,?,?,?,?,?,?)", SEED_QUESTIONS)
    db.commit()
    db.close()


# ----------------------------------------------------------------------
# Utilities
# ----------------------------------------------------------------------
def ok(data=None, message="OK", code=200, **extra):
    body = {"success": True, "message": message}
    if data is not None:
        body["data"] = data
    body.update(extra)
    return jsonify(body), code


def fail(message, code=400):
    return jsonify({"success": False, "message": message}), code


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return fail("Please login to continue", 401)
        return fn(*args, **kwargs)
    return wrapper


def valid_password(pw):
    return len(pw) >= 8 and re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw)


def pct(score, total):
    return round(score / total * 100, 1) if total else 0.0


def grade_and_suggestion(percentage):
    if percentage >= 80:
        return "Excellent", "Move on to the next difficulty level."
    if percentage >= 60:
        return "Good", "Practise more questions at this level."
    if percentage >= 40:
        return "Average", "Revise the basics of this category."
    return "Needs Improvement", "Start with Beginner questions and review the concepts."


def row_options(row):
    return [row["option1"], row["option2"], row["option3"], row["option4"]]


# ----------------------------------------------------------------------
# 1. Register
# ----------------------------------------------------------------------
@app.route("/register", methods=["POST"])
def register():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    confirm = d.get("confirm_password") or ""
    college = (d.get("college") or "").strip()
    department = (d.get("department") or "").strip()

    if not name or not email or not password or not confirm:
        return fail("Name, email and password are required")
    if not EMAIL_RE.match(email):
        return fail("Enter a valid email address")
    if not valid_password(password):
        return fail("Password must be at least 8 characters with a letter and a number")
    if password != confirm:
        return fail("Passwords do not match")

    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        return fail("Email already registered", 409)

    db.execute(
        "INSERT INTO users (name, email, password, college, department) VALUES (?,?,?,?,?)",
        (name, email, generate_password_hash(password), college, department))
    db.commit()
    return ok(message="Registration successful. Please login.", code=201)


# ----------------------------------------------------------------------
# 2. Login
# ----------------------------------------------------------------------
@app.route("/login", methods=["POST"])
def login():
    d = request.get_json(silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""

    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password"], password):
        return fail("Invalid email or password", 401)

    session.clear()
    session["user_id"] = user["id"]
    session["name"] = user["name"]
    return ok({"id": user["id"], "name": user["name"], "email": user["email"]}, "Login successful")


# ----------------------------------------------------------------------
# 3. Logout
# ----------------------------------------------------------------------
@app.route("/logout", methods=["GET", "POST"])
@login_required
def logout():
    session.clear()
    return ok(message="Logged out successfully")


# ----------------------------------------------------------------------
# 4. Profile
# ----------------------------------------------------------------------
@app.route("/profile", methods=["GET", "PUT"])
@login_required
def profile():
    db = get_db()
    uid = session["user_id"]
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not user:
        session.clear()
        return fail("User not found", 404)

    if request.method == "GET":
        return ok({k: user[k] for k in ("id", "name", "email", "college", "department")})

    d = request.get_json(silent=True) or {}
    name = (d.get("name") or user["name"]).strip()
    college = (d.get("college") if d.get("college") is not None else user["college"]) or ""
    department = (d.get("department") if d.get("department") is not None else user["department"]) or ""
    if not name:
        return fail("Name cannot be empty")

    new_hash = user["password"]
    if d.get("new_password"):
        if not check_password_hash(user["password"], d.get("current_password") or ""):
            return fail("Current password is incorrect")
        if not valid_password(d["new_password"]):
            return fail("Password must be at least 8 characters with a letter and a number")
        new_hash = generate_password_hash(d["new_password"])

    db.execute("UPDATE users SET name=?, college=?, department=?, password=? WHERE id=?",
               (name, college.strip(), department.strip(), new_hash, uid))
    db.commit()
    session["name"] = name
    return ok(message="Profile updated successfully")


# ----------------------------------------------------------------------
# 5. Question bank
# ----------------------------------------------------------------------
@app.route("/question-bank", methods=["GET"])
@login_required
def question_bank():
    category = request.args.get("category")
    level = request.args.get("level")
    show_answer = request.args.get("show_answer") == "1"
    try:
        page = max(int(request.args.get("page", 1)), 1)
        limit = min(max(int(request.args.get("limit", 10)), 1), 50)
    except ValueError:
        return fail("page and limit must be numbers")

    where, params = [], []
    if category:
        if category not in CATEGORIES:
            return fail("Invalid category")
        where.append("category = ?"); params.append(category)
    if level:
        if level not in LEVELS:
            return fail("Invalid level")
        where.append("level = ?"); params.append(level)
    clause = ("WHERE " + " AND ".join(where)) if where else ""

    db = get_db()
    total = db.execute(f"SELECT COUNT(*) FROM questions {clause}", params).fetchone()[0]
    rows = db.execute(f"SELECT * FROM questions {clause} ORDER BY id LIMIT ? OFFSET ?",
                      params + [limit, (page - 1) * limit]).fetchall()

    questions = []
    for r in rows:
        q = {"id": r["id"], "category": r["category"], "level": r["level"],
             "question": r["question"], "options": row_options(r)}
        if show_answer:
            q["correct_answer"] = r["correct_answer"]
        questions.append(q)
    return ok({"total": total, "page": page, "questions": questions})


# ----------------------------------------------------------------------
# 6. Start mock interview
# ----------------------------------------------------------------------
@app.route("/start-mock", methods=["POST"])
@login_required
def start_mock():
    d = request.get_json(silent=True) or {}
    category, level = d.get("category"), d.get("level")
    try:
        count = int(d.get("count", 5))
    except (TypeError, ValueError):
        return fail("count must be a number")

    if category not in CATEGORIES:
        return fail("Invalid category")
    if level not in LEVELS:
        return fail("Invalid level")
    if not 1 <= count <= 20:
        return fail("count must be between 1 and 20")

    rows = get_db().execute(
        "SELECT * FROM questions WHERE category=? AND level=? ORDER BY RANDOM() LIMIT ?",
        (category, level, count)).fetchall()
    if not rows:
        return fail("No questions available for the selected category and level", 404)

    warning = None
    if len(rows) < count:
        warning = f"Only {len(rows)} questions are available; starting with those."

    session["mock"] = {"ids": [r["id"] for r in rows], "category": category, "level": level,
                       "started_at": datetime.now().isoformat()}
    questions = []
    for r in rows:
        opts = row_options(r)
        random.shuffle(opts)
        questions.append({"id": r["id"], "question": r["question"], "options": opts})

    return ok({"category": category, "level": level, "total": len(rows), "questions": questions},
              "Mock interview started", warning=warning)


# ----------------------------------------------------------------------
# 7. Submit mock interview
# ----------------------------------------------------------------------
@app.route("/submit-mock", methods=["POST"])
@login_required
def submit_mock():
    mock = session.get("mock")
    if not mock:
        return fail("No active mock interview")

    d = request.get_json(silent=True) or {}
    submitted = {}
    for a in d.get("answers") or []:
        try:
            submitted[int(a.get("question_id"))] = a.get("answer")
        except (TypeError, ValueError):
            continue

    ids = mock["ids"]
    marks = ",".join("?" * len(ids))
    rows = get_db().execute(f"SELECT * FROM questions WHERE id IN ({marks})", ids).fetchall()
    by_id = {r["id"]: r for r in rows}

    review, score = [], 0
    for qid in ids:
        r = by_id[qid]
        ans = submitted.get(qid)
        if ans is None or str(ans).strip() == "":
            status = "unanswered"
        elif str(ans).strip().lower() == r["correct_answer"].strip().lower():
            status, score = "correct", score + 1
        else:
            status = "incorrect"
        review.append({"question_id": qid, "question": r["question"], "your_answer": ans,
                       "correct_answer": r["correct_answer"], "status": status})

    total = len(ids)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db = get_db()
    cur = db.execute("INSERT INTO results (user_id, category, score, total, date) VALUES (?,?,?,?,?)",
                     (session["user_id"], mock["category"], score, total, now))
    db.commit()

    session["last_review"] = {"result_id": cur.lastrowid, "review": review}
    session.pop("mock", None)
    return ok({"result_id": cur.lastrowid, "score": score, "total": total, "percentage": pct(score, total)},
              "Mock interview submitted")


# ----------------------------------------------------------------------
# 8. Result
# ----------------------------------------------------------------------
@app.route("/result", methods=["GET"])
@login_required
def result():
    db = get_db()
    rid = request.args.get("id", type=int)
    if rid:
        row = db.execute("SELECT * FROM results WHERE id=? AND user_id=?",
                         (rid, session["user_id"])).fetchone()
    else:
        row = db.execute("SELECT * FROM results WHERE user_id=? ORDER BY id DESC LIMIT 1",
                         (session["user_id"],)).fetchone()
    if not row:
        return fail("Result not found", 404)

    percentage = pct(row["score"], row["total"])
    grade, suggestion = grade_and_suggestion(percentage)

    saved = session.get("last_review")
    review = saved["review"] if saved and saved["result_id"] == row["id"] else None
    correct = sum(1 for r in review if r["status"] == "correct") if review else row["score"]
    incorrect = sum(1 for r in review if r["status"] == "incorrect") if review else None
    unanswered = sum(1 for r in review if r["status"] == "unanswered") if review else None

    return ok({
        "id": row["id"], "category": row["category"], "score": row["score"], "total": row["total"],
        "percentage": percentage, "grade": grade, "date": row["date"],
        "correct": correct, "incorrect": incorrect, "unanswered": unanswered,
        "feedback": {
            "strengths": f"Strong performance in {row['category']} ({percentage}%)." if percentage >= 70 else None,
            "weaknesses": f"{row['category']} needs more practice ({percentage}%)." if percentage < 50 else None,
            "suggestions": suggestion,
        },
        "review": review,
    })


# ----------------------------------------------------------------------
# 9. Report
# ----------------------------------------------------------------------
@app.route("/report", methods=["GET"])
@login_required
def report():
    rows = get_db().execute("SELECT * FROM results WHERE user_id=? ORDER BY date DESC, id DESC",
                            (session["user_id"],)).fetchall()

    history = [{"id": r["id"], "date": r["date"], "category": r["category"], "score": r["score"],
                "total": r["total"], "percentage": pct(r["score"], r["total"])} for r in rows]

    cats = {}
    for h in history:
        cats.setdefault(h["category"], []).append(h["percentage"])
    category_stats = [{"category": c, "attempts": len(v), "average_percentage": round(sum(v) / len(v), 1)}
                      for c, v in cats.items()]

    improvement = None
    if len(history) >= 2:
        latest, previous = history[0]["percentage"], history[1]["percentage"]
        if previous > 0:
            improvement = round((latest - previous) / previous * 100, 1)

    strongest = weakest = None
    if len(category_stats) >= 2:
        strongest = max(category_stats, key=lambda c: c["average_percentage"])["category"]
        weakest = min(category_stats, key=lambda c: c["average_percentage"])["category"]

    summary = {
        "total_interviews": len(history),
        "average_percentage": round(sum(h["percentage"] for h in history) / len(history), 1) if history else 0,
        "highest_percentage": max((h["percentage"] for h in history), default=0),
        "strongest_category": strongest,
        "weakest_category": weakest,
        "improvement_percentage": improvement,
    }
    return ok({"summary": summary, "category_stats": category_stats, "history": history})


# ----------------------------------------------------------------------
# Error handlers
# ----------------------------------------------------------------------
@app.errorhandler(404)
def not_found(e):
    return fail("Route not found", 404)


@app.errorhandler(405)
def method_not_allowed(e):
    return fail("Method not allowed", 405)


@app.errorhandler(500)
def server_error(e):
    return fail("Internal server error", 500)


# ----------------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    app.run(debug=True)
```

---

## 7. Sample Data — 20 Questions

5 per category · mixed levels. `correct_answer` equals the exact text of one option. These are seeded automatically by `init_db()` when the `questions` table is empty.

| # | Category | Level | Question | Option 1 | Option 2 | Option 3 | Option 4 | Correct Answer |
|---|---|---|---|---|---|---|---|---|
| 1 | HR | Beginner | Tell me about yourself. | Give a brief summary of your education, skills and goals | Recite your entire life story | Say you have nothing to share | Ask the interviewer to answer first | Give a brief summary of your education, skills and goals |
| 2 | HR | Beginner | What is your greatest strength? | Say you are perfect at everything | Pick a relevant strength and support it with an example | Avoid answering the question | Mention a skill unrelated to the job | Pick a relevant strength and support it with an example |
| 3 | HR | Intermediate | How do you handle tight deadlines? | Ignore the deadline | Wait until the last day to start | Prioritise tasks, plan, and communicate risks early | Blame teammates for delays | Prioritise tasks, plan, and communicate risks early |
| 4 | HR | Intermediate | Why should we hire you? | Because I need a job badly | Because other candidates are weaker | I have no particular reason | Because my skills and attitude match the role's needs | Because my skills and attitude match the role's needs |
| 5 | HR | Advanced | How do you respond when your manager criticises your work? | Argue immediately | Listen, ask clarifying questions and act on the feedback | Ignore the feedback | Take it personally and withdraw | Listen, ask clarifying questions and act on the feedback |
| 6 | Technical | Beginner | Which data structure follows the LIFO principle? | Queue | Stack | Array | Linked List | Stack |
| 7 | Technical | Beginner | Which SQL keyword removes duplicate rows from a result set? | UNIQUE | DISTINCT | REMOVE | DROP | DISTINCT |
| 8 | Technical | Intermediate | What is the time complexity of binary search? | O(n) | O(n log n) | O(log n) | O(1) | O(log n) |
| 9 | Technical | Intermediate | Which OOP concept bundles data and methods and restricts direct access to them? | Inheritance | Polymorphism | Encapsulation | Recursion | Encapsulation |
| 10 | Technical | Advanced | Which HTTP method is idempotent and is used to fully replace a resource? | POST | PUT | CONNECT | TRACE | PUT |
| 11 | Aptitude | Beginner | What is 20% of 250? | 25 | 40 | 50 | 60 | 50 |
| 12 | Aptitude | Beginner | A train travels 120 km in 2 hours. What is its speed? | 50 km/h | 60 km/h | 70 km/h | 240 km/h | 60 km/h |
| 13 | Aptitude | Intermediate | Find the next number: 2, 6, 12, 20, 30, ? | 38 | 40 | 42 | 44 | 42 |
| 14 | Aptitude | Intermediate | If the cost price is 400 and the selling price is 500, what is the profit percentage? | 20% | 25% | 30% | 100% | 25% |
| 15 | Aptitude | Advanced | Two fair dice are rolled. What is the probability that the sum is 7? | 1/12 | 1/9 | 1/6 | 7/36 | 1/6 |
| 16 | Coding | Beginner | What is the output of `print(len('hello'))`? | 4 | 5 | 6 | Error | 5 |
| 17 | Coding | Beginner | Which Python expression reverses the string `s`? | s.reverse() | s[::-1] | reverse(s) | s[-1] | s[::-1] |
| 18 | Coding | Intermediate | What is the output of `print(10 // 3)`? | 3.33 | 3 | 4 | 1 | 3 |
| 19 | Coding | Intermediate | Which of these Python data types is immutable? | list | dict | set | tuple | tuple |
| 20 | Coding | Advanced | What is the output of `print([x * x for x in range(4)])`? | [1, 4, 9, 16] | [0, 1, 4, 9] | [0, 1, 2, 3] | [1, 2, 3, 4] | [0, 1, 4, 9] |

> Note: `/start-mock` shuffles option order per request, so graded answers are matched by **option text**, not by position.

---

## 8. Frontend ↔ Backend Mapping

| Frontend page | Routes used |
|---|---|
| `register.html` | `POST /register` |
| `login.html` | `POST /login` |
| `dashboard.html` | `GET /report`, `GET /profile` |
| `profile.html` | `GET /profile`, `PUT /profile`, `GET /logout` |
| `question-bank.html` | `GET /question-bank` |
| `mock-interview.html` | `POST /start-mock`, `POST /submit-mock` |
| `result.html` | `GET /result?id=` |
| `report.html` | `GET /report` |
| Navbar → Logout | `GET /logout` |

> If the frontend spec uses `/api/...` paths, either set the frontend `API_BASE` paths to these route names or register the same functions under both, e.g. `@app.route("/login")` + `@app.route("/api/login")`.

---

## 9. Testing with curl

```bash
# Register
curl -X POST http://127.0.0.1:5000/register -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"Pass1234","confirm_password":"Pass1234"}'

# Login (save cookie)
curl -c cookies.txt -X POST http://127.0.0.1:5000/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Pass1234"}'

# Question bank
curl -b cookies.txt "http://127.0.0.1:5000/question-bank?category=Coding&level=Beginner"

# Start mock
curl -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:5000/start-mock \
  -H "Content-Type: application/json" -d '{"category":"Technical","level":"Beginner","count":2}'

# Submit mock
curl -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:5000/submit-mock \
  -H "Content-Type: application/json" \
  -d '{"answers":[{"question_id":6,"answer":"Stack"},{"question_id":7,"answer":"DISTINCT"}]}'

# Result + Report
curl -b cookies.txt http://127.0.0.1:5000/result
curl -b cookies.txt http://127.0.0.1:5000/report

# Logout
curl -b cookies.txt http://127.0.0.1:5000/logout
```

---

## 10. Limitations & Notes

- **Scope of schema:** the `results` table stores only `category, score, total, date`, so the per-question review on `/result` is available for the **most recent** submission (kept in the session). Older results return the score summary and `review: null`. To keep reviews permanently, add an `answers` table later.
- **No admin role:** the `users` table has no role column, so question add/edit/delete is out of scope. Add questions via the SQLite file or extend the schema (`role`) later.
- **Forgot password:** not included in the route list; add `/forgot-password` later (requires an email service or an admin-assisted reset).
- **Timer:** enforced on the frontend; the server records only the final score.
- **Production:** set `SECRET_KEY` as an environment variable, set `debug=False`, serve via Gunicorn/Waitress, and use HTTPS with `SESSION_COOKIE_SECURE=True`.
- Feedback is rule-based on percentages — **not** AI evaluation.
