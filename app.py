import os
import sqlite3
import random
from datetime import datetime
from functools import wraps

from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "crack_my_interview.db")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", "crack-my-interview-dev-secret-key")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

CORS(app, supports_credentials=True)


# -----------------------------
# Database helpers
# -----------------------------
def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_all(sql, params=()):
    cur = get_db().execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    return rows


def query_one(sql, params=()):
    cur = get_db().execute(sql, params)
    row = cur.fetchone()
    cur.close()
    return row


def execute(sql, params=()):
    db = get_db()
    cur = db.execute(sql, params)
    db.commit()
    last_id = cur.lastrowid
    cur.close()
    return last_id


def executemany(sql, seq_of_params):
    db = get_db()
    db.executemany(sql, seq_of_params)
    db.commit()


# -----------------------------
# Utilities and auth
# -----------------------------
def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def ok(message="OK", data=None, status=200):
    payload = {"success": True, "message": message}
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status


def err(message="Error", status=400, **extra):
    payload = {"success": False, "message": message}
    payload.update(extra)
    return jsonify(payload), status


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return query_one(
        "SELECT user_id, full_name, email, phone, role, created_at FROM users WHERE user_id = ?",
        (uid,),
    )


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            if request.path.startswith("/api/"):
                return err("Authentication required. Please login.", 401)
            return redirect(url_for("login_page", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            if request.path.startswith("/api/"):
                return err("Authentication required. Please login.", 401)
            return redirect(url_for("login_page", next=request.path))
        if session.get("role") != "admin":
            if request.path.startswith("/api/"):
                return err("Admin access required.", 403)
            return redirect(url_for("dashboard_page"))
        return view(*args, **kwargs)

    return wrapped


def normalize_answer(val):
    if val is None:
        return None
    s = str(val).strip()
    if s == "":
        return None
    return s


def answers_match(user_answer, correct_answer):
    ua = normalize_answer(user_answer)
    ca = normalize_answer(correct_answer)
    if ua is None or ca is None:
        return False
    return ua.lower() == ca.lower()


def option_text_for(row, answer_key):
    key = normalize_answer(answer_key)
    if not key:
        return None
    k = key.upper()
    mapping = {
        "A": row["option_a"],
        "B": row["option_b"],
        "C": row["option_c"],
        "D": row["option_d"],
    }
    if k in mapping:
        return mapping[k]
    # if answer stored as full text, return as-is
    return key


def compute_feedback(interview_row, correct_count, incorrect_count, unanswered_count):
    pct = interview_row["percentage"] or 0
    category = interview_row["category_name"] or "this category"
    strengths = []
    weaknesses = []
    suggestions = []

    if pct >= 80:
        strengths.append(f"Strong performance in {category} with {pct:.1f}% score.")
        suggestions.append(f"Try a higher difficulty in {category} or attempt mixed practice.")
    elif pct >= 60:
        strengths.append(f"Good understanding shown in {category}.")
        weaknesses.append(f"Some gaps remain in {category} concepts.")
        suggestions.append(f"Review incorrect answers in {category} and practice similar questions.")
    elif pct >= 40:
        weaknesses.append(f"Average performance in {category}; key concepts need revision.")
        suggestions.append(f"Revise fundamentals of {category} and practice more beginner/intermediate questions.")
    else:
        weaknesses.append(f"Low score in {category}; foundational practice is needed.")
        suggestions.append(f"Start with beginner-level {category} questions and review explanations carefully.")

    if unanswered_count > 0:
        weaknesses.append(f"{unanswered_count} question(s) were unanswered due to time or skipping.")
        suggestions.append("Work on time management: attempt each question within 60 seconds.")

    if correct_count == 0 and incorrect_count == 0 and unanswered_count == 0:
        weaknesses.append("No evaluated answers were recorded.")
        suggestions.append("Retake the interview to generate feedback.")

    # de-duplicate while preserving order
    def uniq(items):
        seen = set()
        out = []
        for it in items:
            if it not in seen:
                seen.add(it)
                out.append(it)
        return out

    return {
        "strengths": " ".join(uniq(strengths)) if strengths else f"Completed {category} interview.",
        "weaknesses": " ".join(uniq(weaknesses)) if weaknesses else "No major weaknesses identified in this attempt.",
        "suggestions": " ".join(uniq(suggestions)) if suggestions else f"Continue practicing {category} questions regularly.",
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
    }


# -----------------------------
# Database initialization and seed
# -----------------------------
def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            full_name VARCHAR(100),
            email VARCHAR(120) UNIQUE,
            password_hash VARCHAR(255),
            phone VARCHAR(15),
            role VARCHAR(20) DEFAULT 'student',
            created_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS categories (
            category_id INTEGER PRIMARY KEY,
            category_name VARCHAR(50),
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS questions (
            question_id INTEGER PRIMARY KEY,
            category_id INTEGER,
            question_text TEXT,
            option_a TEXT,
            option_b TEXT,
            option_c TEXT,
            option_d TEXT,
            correct_answer TEXT,
            explanation TEXT,
            difficulty_level VARCHAR(20),
            marks INTEGER DEFAULT 1,
            FOREIGN KEY (category_id) REFERENCES categories(category_id)
        );

        CREATE TABLE IF NOT EXISTS interviews (
            interview_id INTEGER PRIMARY KEY,
            user_id INTEGER,
            category_id INTEGER,
            difficulty_level VARCHAR(20),
            total_questions INTEGER,
            correct_answers INTEGER,
            total_score INTEGER,
            percentage REAL,
            duration INTEGER,
            started_at DATETIME,
            completed_at DATETIME,
            status VARCHAR(20),
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (category_id) REFERENCES categories(category_id)
        );

        CREATE TABLE IF NOT EXISTS interview_answers (
            answer_id INTEGER PRIMARY KEY,
            interview_id INTEGER,
            question_id INTEGER,
            user_answer TEXT,
            is_correct BOOLEAN,
            marks_obtained INTEGER,
            answered_at DATETIME,
            FOREIGN KEY (interview_id) REFERENCES interviews(interview_id),
            FOREIGN KEY (question_id) REFERENCES questions(question_id)
        );

        CREATE TABLE IF NOT EXISTS feedback (
            feedback_id INTEGER PRIMARY KEY,
            interview_id INTEGER UNIQUE,
            strengths TEXT,
            weaknesses TEXT,
            suggestions TEXT,
            correct_count INTEGER,
            incorrect_count INTEGER,
            created_at DATETIME,
            FOREIGN KEY (interview_id) REFERENCES interviews(interview_id)
        );
        """
    )

    # Seed categories
    cat_count = db.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if cat_count == 0:
        categories = [
            ("HR", "Human resources and behavioral interview questions."),
            ("Technical", "Core technical and computer science questions."),
            ("Aptitude", "Numerical, logical, and analytical aptitude questions."),
            ("Coding", "Programming and problem-solving questions."),
        ]
        db.executemany(
            "INSERT INTO categories (category_name, description) VALUES (?, ?)",
            categories,
        )

    # Map category ids
    cat_rows = db.execute("SELECT category_id, category_name FROM categories").fetchall()
    cat_map = {name: cid for cid, name in cat_rows}

    # Seed questions (20 total, 5 per category, mixed difficulty)
    q_count = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    if q_count == 0 and all(k in cat_map for k in ("HR", "Technical", "Aptitude", "Coding")):
        questions = [
            # HR (5)
            (cat_map["HR"], "What is the best way to introduce yourself in an interview?",
             "Start with personal hobbies only", "Give a brief summary of education, skills, and goals", "Ask the interviewer to introduce themselves first", "Read your resume word for word",
             "B", "A clear and relevant self-introduction highlights your background, skills, and career goals.", "Beginner", 1),
            (cat_map["HR"], "How should you answer a question about your weakness?",
             "Say you have no weaknesses", "Blame others for your weakness", "Mention a real weakness and how you are improving it", "Avoid answering the question",
             "C", "Employers value self-awareness and a plan for improvement.", "Beginner", 1),
            (cat_map["HR"], "What is the most professional response to feedback from a manager?",
             "Ignore the feedback", "Become defensive immediately", "Listen carefully and act on constructive points", "Argue until they agree with you",
             "C", "Listening and improving based on feedback shows professionalism and growth mindset.", "Intermediate", 1),
            (cat_map["HR"], "Why do employers ask behavioral interview questions?",
             "To test only technical coding skills", "To understand past behavior and workplace approach", "To check your typing speed", "To avoid discussing experience",
             "B", "Behavioral questions help assess how candidates handled situations in the past.", "Intermediate", 1),
            (cat_map["HR"], "When describing a conflict you resolved, what should you focus on most?",
             "Only the mistakes of others", "How you escalated without trying to resolve it", "The actions you took and the positive outcome", "Avoiding responsibility",
             "C", "Using a structured response that highlights your actions and outcomes is most effective.", "Advanced", 1),

            # Technical (5)
            (cat_map["Technical"], "Which data structure follows the LIFO principle?",
             "Queue", "Stack", "Array", "Linked List",
             "B", "Stack follows Last In, First Out (LIFO).", "Beginner", 1),
            (cat_map["Technical"], "Which SQL command is used to retrieve data from a database?",
             "INSERT", "UPDATE", "SELECT", "DELETE",
             "C", "SELECT is used to query and retrieve data.", "Beginner", 1),
            (cat_map["Technical"], "What is the time complexity of binary search on a sorted array?",
             "O(n)", "O(log n)", "O(n log n)", "O(1)",
             "B", "Binary search halves the search space each step, giving O(log n).", "Intermediate", 1),
            (cat_map["Technical"], "Which OOP concept binds data and methods together and restricts direct access?",
             "Inheritance", "Encapsulation", "Polymorphism", "Abstraction",
             "B", "Encapsulation bundles data with methods and controls access.", "Intermediate", 1),
            (cat_map["Technical"], "Which HTTP status code indicates that a requested resource was not found?",
             "200", "301", "403", "404",
             "D", "404 Not Found means the server cannot find the requested resource.", "Advanced", 1),

            # Aptitude (5)
            (cat_map["Aptitude"], "What is 15% of 200?",
             "15", "20", "30", "35",
             "C", "15% of 200 = (15/100) * 200 = 30.", "Beginner", 1),
            (cat_map["Aptitude"], "If a train travels 120 km in 2 hours, what is its speed?",
             "40 km/h", "50 km/h", "60 km/h", "70 km/h",
             "C", "Speed = distance / time = 120 / 2 = 60 km/h.", "Beginner", 1),
            (cat_map["Aptitude"], "Find the next number in the series: 2, 4, 8, 16, ?",
             "18", "24", "30", "32",
             "D", "Each number is multiplied by 2, so next is 32.", "Intermediate", 1),
            (cat_map["Aptitude"], "A shopkeeper buys an item for Rs. 400 and sells it for Rs. 500. What is the profit percentage?",
             "20%", "25%", "30%", "40%",
             "B", "Profit = 100, profit% = (100/400)*100 = 25%.", "Intermediate", 1),
            (cat_map["Aptitude"], "What is the probability of getting a head when tossing a fair coin once?",
             "1/4", "1/3", "1/2", "1",
             "C", "A fair coin has two equally likely outcomes, so probability of head is 1/2.", "Advanced", 1),

            # Coding (5)
            (cat_map["Coding"], "What is the output of print(len('Python')) in Python?",
             "5", "6", "7", "Error",
             "B", "The string 'Python' has 6 characters.", "Beginner", 1),
            (cat_map["Coding"], "Which keyword is used to define a function in Python?",
             "func", "function", "def", "define",
             "C", "Python uses the def keyword to define functions.", "Beginner", 1),
            (cat_map["Coding"], "What does list.append(x) do in Python?",
             "Removes x from the list", "Adds x to the end of the list", "Sorts the list", "Returns the length of the list",
             "B", "append(x) adds element x to the end of the list.", "Intermediate", 1),
            (cat_map["Coding"], "Which of the following is the correct way to create a dictionary in Python?",
             "['a': 1, 'b': 2]", "{'a': 1, 'b': 2}", "('a': 1, 'b': 2)", "<'a': 1, 'b': 2>",
             "B", "Dictionaries in Python are created using curly braces with key-value pairs.", "Intermediate", 1),
            (cat_map["Coding"], "What is the time complexity of accessing an element by index in a Python list?",
             "O(1)", "O(log n)", "O(n)", "O(n log n)",
             "A", "List index access is constant time on average, O(1).", "Advanced", 1),
        ]
        db.executemany(
            """
            INSERT INTO questions (
                category_id, question_text, option_a, option_b, option_c, option_d,
                correct_answer, explanation, difficulty_level, marks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            questions,
        )

    # Seed admin user
    admin = db.execute("SELECT user_id FROM users WHERE email = ?", ("admin@crack.com",)).fetchone()
    if not admin:
        db.execute(
            """
            INSERT INTO users (full_name, email, password_hash, phone, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "Administrator",
                "admin@crack.com",
                generate_password_hash("Admin@123"),
                None,
                "admin",
                now_str(),
            ),
        )

    db.commit()
    db.close()


# -----------------------------
# Page routes
# -----------------------------
@app.route("/")
def index_page():
    return render_template("index.html")


@app.route("/register")
def register_page():
    return render_template("register.html")


@app.route("/login")
def login_page():
    return render_template("login.html")


@app.route("/dashboard")
@login_required
def dashboard_page():
    return render_template("dashboard.html")


@app.route("/profile")
@login_required
def profile_page():
    return render_template("profile.html")


@app.route("/question-bank")
@login_required
def question_bank_page():
    return render_template("question-bank.html")


@app.route("/mock-interview")
@login_required
def mock_interview_page():
    return render_template("mock-interview.html")


@app.route("/result")
@login_required
def result_page():
    return render_template("result.html")


@app.route("/report")
@login_required
def report_page():
    return render_template("report.html")


@app.route("/admin")
@admin_required
def admin_page():
    return render_template("admin.html")


# -----------------------------
# Auth APIs
# -----------------------------
@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""
    phone = (data.get("phone") or "").strip() or None

    if not full_name or not email or not password or not confirm_password:
        return err("Full name, email, password, and confirm password are required.", 400)
    if "@" not in email or "." not in email:
        return err("Please enter a valid email address.", 400)
    if len(password) < 6:
        return err("Password must be at least 6 characters long.", 400)
    if password != confirm_password:
        return err("Passwords do not match.", 400)
    if phone and (not phone.isdigit() or not (10 <= len(phone) <= 15)):
        return err("Phone number must contain 10 to 15 digits.", 400)

    existing = query_one("SELECT user_id FROM users WHERE email = ?", (email,))
    if existing:
        return err("Email is already registered.", 409)

    user_id = execute(
        """
        INSERT INTO users (full_name, email, password_hash, phone, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (full_name, email, generate_password_hash(password), phone, "student", now_str()),
    )
    return ok("Registration successful. Please login.", {"user_id": user_id}, 201)


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return err("Email and password are required.", 400)

    user = query_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not check_password_hash(user["password_hash"], password):
        return err("Invalid email or password.", 401)

    session.clear()
    session["user_id"] = user["user_id"]
    session["role"] = user["role"]
    session["full_name"] = user["full_name"]

    return ok(
        "Login successful.",
        {
            "user": {
                "user_id": user["user_id"],
                "full_name": user["full_name"],
                "email": user["email"],
                "phone": user["phone"],
                "role": user["role"],
            }
        },
    )


@app.route("/api/forgot-password", methods=["POST"])
def api_forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    new_password = data.get("new_password") or ""
    confirm_password = data.get("confirm_password") or data.get("new_password") or ""

    if not email or not new_password:
        return err("Email and new password are required.", 400)
    if len(new_password) < 6:
        return err("New password must be at least 6 characters long.", 400)
    if new_password != confirm_password:
        return err("Passwords do not match.", 400)

    user = query_one("SELECT user_id FROM users WHERE email = ?", (email,))
    if not user:
        return err("No account found with this email.", 404)

    execute(
        "UPDATE users SET password_hash = ? WHERE user_id = ?",
        (generate_password_hash(new_password), user["user_id"]),
    )
    return ok("Password reset successful. Please login with your new password.")


@app.route("/api/profile", methods=["GET", "PUT", "POST"])
@login_required
def api_profile():
    user = current_user()
    if not user:
        session.clear()
        return err("User not found.", 404)

    if request.method == "GET":
        return ok("Profile fetched.", {"user": dict(user)})

    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") if data.get("full_name") is not None else user["full_name"]) or ""
    full_name = full_name.strip()
    phone = data.get("phone")
    if phone is not None:
        phone = str(phone).strip()
        phone = phone if phone else None

    if not full_name:
        return err("Full name cannot be empty.", 400)
    if phone and (not phone.isdigit() or not (10 <= len(phone) <= 15)):
        return err("Phone number must contain 10 to 15 digits.", 400)

    # Password change (optional)
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""
    confirm_new_password = data.get("confirm_new_password") or ""

    db_user = query_one("SELECT password_hash FROM users WHERE user_id = ?", (user["user_id"],))
    password_hash = db_user["password_hash"]
    if current_password or new_password or confirm_new_password:
        if not current_password or not new_password or not confirm_new_password:
            return err("To change password, provide current password, new password, and confirm new password.", 400)
        if not check_password_hash(password_hash, current_password):
            return err("Current password is incorrect.", 400)
        if len(new_password) < 6:
            return err("New password must be at least 6 characters long.", 400)
        if new_password != confirm_new_password:
            return err("New password and confirm password do not match.", 400)
        password_hash = generate_password_hash(new_password)

    execute(
        "UPDATE users SET full_name = ?, phone = ?, password_hash = ? WHERE user_id = ?",
        (full_name, phone, password_hash, user["user_id"]),
    )
    session["full_name"] = full_name
    updated = current_user()
    return ok("Profile updated successfully.", {"user": dict(updated) if updated else None})


@app.route("/api/logout", methods=["POST", "GET"])
@login_required
def api_logout():
    session.clear()
    return ok("Logged out successfully.")


@app.route("/api/session", methods=["GET"])
def api_session():
    if not session.get("user_id"):
        return ok("No active session.", {"authenticated": False, "user": None})
    user = current_user()
    if not user:
        session.clear()
        return ok("No active session.", {"authenticated": False, "user": None})
    return ok("Session active.", {"authenticated": True, "user": dict(user)})


# -----------------------------
# Categories and questions APIs
# -----------------------------
@app.route("/api/categories", methods=["GET"])
@login_required
def api_categories():
    rows = query_all("SELECT category_id, category_name, description FROM categories ORDER BY category_name")
    return ok("Categories fetched.", {"categories": [dict(r) for r in rows]})


@app.route("/api/questions", methods=["GET", "POST"])
@login_required
def api_questions():
    if request.method == "POST":
        if session.get("role") != "admin":
            return err("Admin access required.", 403)
        data = request.get_json(silent=True) or {}
        category_id = data.get("category_id")
        question_text = (data.get("question_text") or "").strip()
        option_a = (data.get("option_a") or "").strip()
        option_b = (data.get("option_b") or "").strip()
        option_c = (data.get("option_c") or "").strip()
        option_d = (data.get("option_d") or "").strip()
        correct_answer = (data.get("correct_answer") or "").strip().upper()
        explanation = (data.get("explanation") or "").strip() or None
        difficulty_level = (data.get("difficulty_level") or "").strip()
        marks = data.get("marks", 1)

        if not all([category_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty_level]):
            return err("All question fields are required.", 400)
        try:
            category_id = int(category_id)
            marks = int(marks)
        except (TypeError, ValueError):
            return err("Invalid category_id or marks.", 400)
        if correct_answer not in {"A", "B", "C", "D"}:
            return err("Correct answer must be A, B, C, or D.", 400)
        if difficulty_level not in {"Beginner", "Intermediate", "Advanced"}:
            return err("Invalid difficulty level.", 400)
        if not query_one("SELECT category_id FROM categories WHERE category_id = ?", (category_id,)):
            return err("Category not found.", 404)

        qid = execute(
            """
            INSERT INTO questions (
                category_id, question_text, option_a, option_b, option_c, option_d,
                correct_answer, explanation, difficulty_level, marks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (category_id, question_text, option_a, option_b, option_c, option_d, correct_answer, explanation, difficulty_level, marks),
        )
        return ok("Question added successfully.", {"question_id": qid}, 201)

    # GET
    category_id = request.args.get("category_id")
    difficulty_level = request.args.get("difficulty_level")
    params = []
    where = []
    if category_id:
        try:
            params.append(int(category_id))
            where.append("q.category_id = ?")
        except (TypeError, ValueError):
            return err("Invalid category_id.", 400)
    if difficulty_level:
        if difficulty_level not in {"Beginner", "Intermediate", "Advanced"}:
            return err("Invalid difficulty_level.", 400)
        params.append(difficulty_level)
        where.append("q.difficulty_level = ?")

    sql = """
        SELECT q.question_id, q.category_id, c.category_name, c.description AS category_description,
               q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
               q.correct_answer, q.explanation, q.difficulty_level, q.marks
        FROM questions q
        JOIN categories c ON c.category_id = q.category_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY c.category_name, q.difficulty_level, q.question_id"
    rows = query_all(sql, tuple(params))
    questions = [dict(r) for r in rows]
    return ok("Questions fetched.", {"questions": questions, "count": len(questions)})


@app.route("/api/questions/<int:question_id>", methods=["PUT", "DELETE"])
@login_required
def api_question_detail(question_id):
    if session.get("role") != "admin":
        return err("Admin access required.", 403)

    existing = query_one("SELECT question_id FROM questions WHERE question_id = ?", (question_id,))
    if not existing:
        return err("Question not found.", 404)

    if request.method == "DELETE":
        # prevent deleting if used in interview answers
        used = query_one("SELECT answer_id FROM interview_answers WHERE question_id = ? LIMIT 1", (question_id,))
        if used:
            return err("Cannot delete a question that has been used in interviews.", 400)
        execute("DELETE FROM questions WHERE question_id = ?", (question_id,))
        return ok("Question deleted successfully.")

    data = request.get_json(silent=True) or {}
    category_id = data.get("category_id")
    question_text = (data.get("question_text") or "").strip()
    option_a = (data.get("option_a") or "").strip()
    option_b = (data.get("option_b") or "").strip()
    option_c = (data.get("option_c") or "").strip()
    option_d = (data.get("option_d") or "").strip()
    correct_answer = (data.get("correct_answer") or "").strip().upper()
    explanation = (data.get("explanation") or "").strip() or None
    difficulty_level = (data.get("difficulty_level") or "").strip()
    marks = data.get("marks", 1)

    if not all([category_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty_level]):
        return err("All question fields are required.", 400)
    try:
        category_id = int(category_id)
        marks = int(marks)
    except (TypeError, ValueError):
        return err("Invalid category_id or marks.", 400)
    if correct_answer not in {"A", "B", "C", "D"}:
        return err("Correct answer must be A, B, C, or D.", 400)
    if difficulty_level not in {"Beginner", "Intermediate", "Advanced"}:
        return err("Invalid difficulty level.", 400)
    if not query_one("SELECT category_id FROM categories WHERE category_id = ?", (category_id,)):
        return err("Category not found.", 404)

    execute(
        """
        UPDATE questions SET
            category_id = ?, question_text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
            correct_answer = ?, explanation = ?, difficulty_level = ?, marks = ?
        WHERE question_id = ?
        """,
        (category_id, question_text, option_a, option_b, option_c, option_d, correct_answer, explanation, difficulty_level, marks, question_id),
    )
    return ok("Question updated successfully.")


# -----------------------------
# Mock interview APIs
# -----------------------------
@app.route("/api/interviews/start", methods=["POST"])
@login_required
def api_interview_start():
    data = request.get_json(silent=True) or {}
    category_id = data.get("category_id")
    difficulty_level = (data.get("difficulty_level") or "").strip()
    count = data.get("total_questions", data.get("count"))

    try:
        category_id = int(category_id)
        count = int(count)
    except (TypeError, ValueError):
        return err("Category, difficulty, and count are required.", 400)

    if difficulty_level not in {"Beginner", "Intermediate", "Advanced"}:
        return err("Invalid difficulty level.", 400)
    if count not in {5, 10}:
        return err("Question count must be 5 or 10.", 400)

    category = query_one("SELECT category_id, category_name FROM categories WHERE category_id = ?", (category_id,))
    if not category:
        return err("Category not found.", 404)

    rows = query_all(
        """
        SELECT question_id, question_text, option_a, option_b, option_c, option_d, marks
        FROM questions
        WHERE category_id = ? AND difficulty_level = ?
        ORDER BY RANDOM()
        LIMIT ?
        """,
        (category_id, difficulty_level, count),
    )
    if not rows:
        return err("No questions available for the selected category and difficulty.", 404)

    started_at = now_str()
    interview_id = execute(
        """
        INSERT INTO interviews (
            user_id, category_id, difficulty_level, total_questions, correct_answers,
            total_score, percentage, duration, started_at, completed_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (session["user_id"], category_id, difficulty_level, len(rows), 0, 0, 0.0, 0, started_at, None, "in_progress"),
    )

    # create answer placeholders for issued questions
    for r in rows:
        execute(
            """
            INSERT INTO interview_answers (interview_id, question_id, user_answer, is_correct, marks_obtained, answered_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (interview_id, r["question_id"], None, 0, 0, None),
        )

    questions = [dict(r) for r in rows]
    warning = None
    if len(rows) < count:
        warning = f"Only {len(rows)} question(s) available. Starting with available questions."

    return ok(
        "Mock interview started.",
        {
            "interview": {
                "interview_id": interview_id,
                "category_id": category["category_id"],
                "category_name": category["category_name"],
                "difficulty_level": difficulty_level,
                "total_questions": len(rows),
                "started_at": started_at,
                "seconds_per_question": 60,
            },
            "questions": questions,
            "warning": warning,
        },
        201,
    )


@app.route("/api/interviews/submit", methods=["POST"])
@login_required
def api_interview_submit():
    data = request.get_json(silent=True) or {}
    interview_id = data.get("interview_id")
    answers = data.get("answers") or []
    if not isinstance(answers, list):
        return err("Answers must be a list.", 400)
    try:
        interview_id = int(interview_id)
    except (TypeError, ValueError):
        return err("Invalid interview_id.", 400)

    interview = query_one(
        """
        SELECT i.*, c.category_name
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        WHERE i.interview_id = ? AND i.user_id = ?
        """,
        (interview_id, session["user_id"]),
    )
    if not interview:
        return err("Interview not found.", 404)
    if interview["status"] == "completed":
        return ok("Interview already submitted.", {"interview_id": interview_id, "evaluation_id": interview_id})

    # Build answer map from submitted payload (only for issued questions)
    submitted_map = {}
    for a in answers:
        if not isinstance(a, dict):
            continue
        qid = a.get("question_id")
        try:
            qid = int(qid)
        except (TypeError, ValueError):
            continue
        submitted_map[qid] = normalize_answer(a.get("user_answer"))

    issued = query_all(
        """
        SELECT ia.answer_id, ia.question_id, q.correct_answer, q.marks
        FROM interview_answers ia
        JOIN questions q ON q.question_id = ia.question_id
        WHERE ia.interview_id = ?
        """,
        (interview_id,),
    )
    if not issued:
        return err("No questions found for this interview.", 400)

    correct_count = 0
    incorrect_count = 0
    unanswered_count = 0
    obtained_marks = 0
    total_marks = 0
    answered_at = now_str()

    for row in issued:
        qid = row["question_id"]
        total_marks += int(row["marks"] or 0)
        user_ans = submitted_map.get(qid)
        if user_ans is None:
            is_correct = 0
            marks_obtained = 0
            unanswered_count += 1
        else:
            is_correct = 1 if answers_match(user_ans, row["correct_answer"]) else 0
            if is_correct:
                marks_obtained = int(row["marks"] or 0)
                correct_count += 1
                obtained_marks += marks_obtained
            else:
                marks_obtained = 0
                incorrect_count += 1
        execute(
            """
            UPDATE interview_answers
            SET user_answer = ?, is_correct = ?, marks_obtained = ?, answered_at = ?
            WHERE answer_id = ?
            """,
            (user_ans, is_correct, marks_obtained, answered_at if user_ans is not None else answered_at, row["answer_id"]),
        )

    percentage = round((obtained_marks / total_marks) * 100, 2) if total_marks > 0 else 0.0

    # Duration in seconds from started_at to now
    started_at = interview["started_at"]
    try:
        start_dt = datetime.strptime(started_at, "%Y-%m-%d %H:%M:%S")
        end_dt = datetime.strptime(answered_at, "%Y-%m-%d %H:%M:%S")
        duration = max(int((end_dt - start_dt).total_seconds()), 0)
    except Exception:
        duration = 0

    execute(
        """
        UPDATE interviews
        SET correct_answers = ?, total_score = ?, percentage = ?, duration = ?, completed_at = ?, status = ?
        WHERE interview_id = ?
        """,
        (correct_count, obtained_marks, percentage, duration, answered_at, "completed", interview_id),
    )

    updated_interview = query_one(
        """
        SELECT i.*, c.category_name
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        WHERE i.interview_id = ?
        """,
        (interview_id,),
    )
    fb = compute_feedback(updated_interview, correct_count, incorrect_count, unanswered_count)

    # upsert-like for unique interview_id
    existing_fb = query_one("SELECT feedback_id FROM feedback WHERE interview_id = ?", (interview_id,))
    if existing_fb:
        execute(
            """
            UPDATE feedback
            SET strengths = ?, weaknesses = ?, suggestions = ?, correct_count = ?, incorrect_count = ?, created_at = ?
            WHERE interview_id = ?
            """,
            (fb["strengths"], fb["weaknesses"], fb["suggestions"], fb["correct_count"], fb["incorrect_count"], now_str(), interview_id),
        )
    else:
        execute(
            """
            INSERT INTO feedback (interview_id, strengths, weaknesses, suggestions, correct_count, incorrect_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (interview_id, fb["strengths"], fb["weaknesses"], fb["suggestions"], fb["correct_count"], fb["incorrect_count"], now_str()),
        )

    return ok(
        "Interview submitted successfully.",
        {
            "interview_id": interview_id,
            "evaluation_id": interview_id,
            "correct_answers": correct_count,
            "incorrect_answers": incorrect_count,
            "unanswered": unanswered_count,
            "total_score": obtained_marks,
            "total_marks": total_marks,
            "percentage": percentage,
            "duration": duration,
        },
    )


@app.route("/api/interviews/history", methods=["GET"])
@login_required
def api_interviews_history():
    rows = query_all(
        """
        SELECT i.interview_id, i.user_id, i.category_id, c.category_name, i.difficulty_level,
               i.total_questions, i.correct_answers, i.total_score, i.percentage, i.duration,
               i.started_at, i.completed_at, i.status
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        WHERE i.user_id = ?
        ORDER BY COALESCE(i.completed_at, i.started_at) DESC, i.interview_id DESC
        """,
        (session["user_id"],),
    )
    return ok("Interview history fetched.", {"history": [dict(r) for r in rows], "count": len(rows)})


@app.route("/api/evaluation/<int:interview_id>", methods=["GET"])
@login_required
def api_evaluation(interview_id):
    interview = query_one(
        """
        SELECT i.*, c.category_name
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        WHERE i.interview_id = ? AND i.user_id = ?
        """,
        (interview_id, session["user_id"]),
    )
    if not interview:
        return err("Evaluation not found.", 404)

    answers = query_all(
        """
        SELECT ia.answer_id, ia.interview_id, ia.question_id, ia.user_answer, ia.is_correct, ia.marks_obtained, ia.answered_at,
               q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation, q.difficulty_level, q.marks
        FROM interview_answers ia
        JOIN questions q ON q.question_id = ia.question_id
        WHERE ia.interview_id = ?
        ORDER BY ia.answer_id ASC
        """,
        (interview_id,),
    )

    answer_items = []
    unanswered = 0
    for r in answers:
        ua = r["user_answer"]
        status_label = "Unanswered"
        if ua is not None and str(ua).strip() != "":
            status_label = "Correct" if r["is_correct"] else "Incorrect"
        else:
            unanswered += 1
        answer_items.append({
            "answer_id": r["answer_id"],
            "question_id": r["question_id"],
            "question_text": r["question_text"],
            "option_a": r["option_a"],
            "option_b": r["option_b"],
            "option_c": r["option_c"],
            "option_d": r["option_d"],
            "user_answer": ua,
            "user_answer_text": option_text_for(r, ua) if ua else None,
            "correct_answer": r["correct_answer"],
            "correct_answer_text": option_text_for(r, r["correct_answer"]),
            "is_correct": bool(r["is_correct"]),
            "status": status_label,
            "marks_obtained": r["marks_obtained"],
            "marks": r["marks"],
            "explanation": r["explanation"],
            "difficulty_level": r["difficulty_level"],
        })

    feedback = query_one("SELECT * FROM feedback WHERE interview_id = ?", (interview_id,))
    fb_data = dict(feedback) if feedback else None
    if fb_data and "correct_count" in fb_data and "incorrect_count" in fb_data:
        # include unanswered for convenience
        fb_data["unanswered_count"] = max((interview["total_questions"] or 0) - (fb_data["correct_count"] or 0) - (fb_data["incorrect_count"] or 0), 0)
    else:
        # derive if missing
        correct_count = sum(1 for a in answer_items if a["status"] == "Correct")
        incorrect_count = sum(1 for a in answer_items if a["status"] == "Incorrect")
        fb_data = {
            "strengths": None,
            "weaknesses": None,
            "suggestions": None,
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "unanswered_count": unanswered,
        }

    return ok(
        "Evaluation fetched.",
        {
            "interview": dict(interview),
            "answers": answer_items,
            "feedback": fb_data,
        },
    )


@app.route("/api/performance", methods=["GET"])
@login_required
def api_performance():
    uid = session["user_id"]
    rows = query_all(
        """
        SELECT i.interview_id, i.percentage, i.total_questions, i.correct_answers, i.total_score,
               i.duration, i.difficulty_level, i.completed_at, i.started_at, i.status,
               c.category_name
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        WHERE i.user_id = ?
        ORDER BY COALESCE(i.completed_at, i.started_at) ASC, i.interview_id ASC
        """,
        (uid,),
    )
    completed = [r for r in rows if r["status"] == "completed"]
    percentages = [float(r["percentage"] or 0) for r in completed]
    total_interviews = len(completed)
    avg_score = round(sum(percentages) / total_interviews, 2) if total_interviews else 0.0
    highest_score = round(max(percentages), 2) if percentages else 0.0

    improvement = "Baseline"
    improvement_value = None
    if len(percentages) >= 2:
        prev = percentages[-2]
        curr = percentages[-1]
        if prev == 0:
            improvement = "Baseline"
            improvement_value = None
        else:
            improvement_value = round(((curr - prev) / prev) * 100, 2)
            improvement = f"{improvement_value}%"

    # strongest/weakest category by average percentage across completed interviews
    cat_stats = {}
    for r in completed:
        name = r["category_name"]
        cat_stats.setdefault(name, []).append(float(r["percentage"] or 0))
    cat_avgs = {k: (sum(v) / len(v)) for k, v in cat_stats.items()}
    strongest_category = max(cat_avgs, key=cat_avgs.get) if cat_avgs else None
    weakest_category = min(cat_avgs, key=cat_avgs.get) if cat_avgs else None

    trend = [
        {
            "interview_id": r["interview_id"],
            "label": (r["completed_at"] or r["started_at"] or "")[:10],
            "percentage": float(r["percentage"] or 0),
            "category_name": r["category_name"],
            "difficulty_level": r["difficulty_level"],
        }
        for r in completed
    ]

    return ok(
        "Performance fetched.",
        {
            "summary": {
                "total_interviews": total_interviews,
                "average_score": avg_score,
                "highest_score": highest_score,
                "improvement": improvement,
                "improvement_value": improvement_value,
                "strongest_category": strongest_category,
                "weakest_category": weakest_category,
            },
            "trend": trend,
            "category_averages": [
                {"category_name": k, "average_percentage": round(v, 2), "attempts": len(cat_stats[k])}
                for k, v in sorted(cat_avgs.items())
            ],
        },
    )


@app.route("/api/report/<int:interview_id>/download", methods=["GET"])
@login_required
def api_report_download(interview_id):
    # Return full report data for a specific interview (frontend uses print/PDF)
    interview = query_one(
        """
        SELECT i.*, c.category_name, u.full_name, u.email
        FROM interviews i
        JOIN categories c ON c.category_id = i.category_id
        JOIN users u ON u.user_id = i.user_id
        WHERE i.interview_id = ? AND i.user_id = ?
        """,
        (interview_id, session["user_id"]),
    )
    if not interview:
        return err("Report not found.", 404)

    evaluation_resp = api_evaluation(interview_id)
    # api_evaluation returns (response, status)
    eval_json = evaluation_resp[0].get_json() if isinstance(evaluation_resp, tuple) else evaluation_resp.get_json()
    eval_data = eval_json.get("data") if eval_json else None

    perf_resp = api_performance()
    perf_json = perf_resp[0].get_json() if isinstance(perf_resp, tuple) else perf_resp.get_json()
    perf_data = perf_json.get("data") if perf_json else None

    return ok(
        "Report data fetched.",
        {
            "interview": dict(interview),
            "evaluation": eval_data,
            "performance": perf_data,
            "generated_at": now_str(),
        },
    )


# -----------------------------
# Error handlers
# -----------------------------
@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return err("Resource not found.", 404)
    return render_template("index.html"), 404


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith("/api/"):
        return err("Internal server error.", 500)
    return "Internal Server Error", 500


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
