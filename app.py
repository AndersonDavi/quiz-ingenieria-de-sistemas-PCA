from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", DATA_DIR / "estanco.db"))
COOKIE_NAME = "estanco_session"
SESSION_SECRET = os.getenv("SESSION_SECRET", "cambia-esta-clave-en-produccion")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

app = FastAPI(title="Gestión de Estanco", version="1.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@contextmanager
def get_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE,
                category TEXT NOT NULL DEFAULT 'General',
                purchase_price_cents INTEGER NOT NULL CHECK (purchase_price_cents >= 0),
                sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents >= 0),
                stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
                min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                unit_sale_price_cents INTEGER NOT NULL,
                unit_cost_cents INTEGER NOT NULL,
                total_sale_cents INTEGER NOT NULL,
                total_cost_cents INTEGER NOT NULL,
                profit_cents INTEGER NOT NULL,
                sold_at TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
            CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);
            """
        )


def price_to_cents(value: Any, field_name: str) -> int:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field_name} debe ser un número válido")
    if amount < 0:
        raise HTTPException(status_code=422, detail=f"{field_name} no puede ser negativo")
    return int(amount * 100)


def cents_to_price(cents: int) -> float:
    return round(cents / 100, 2)


def product_json(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "purchase_price": cents_to_price(row["purchase_price_cents"]),
        "sale_price": cents_to_price(row["sale_price_cents"]),
        "stock": row["stock"],
        "min_stock": row["min_stock"],
        "margin": cents_to_price(row["sale_price_cents"] - row["purchase_price_cents"]),
        "low_stock": row["stock"] <= row["min_stock"],
    }


def make_session(username: str) -> str:
    payload = f"{username}:{secrets.token_urlsafe(16)}"
    signature = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}|{signature}"


def valid_session(value: str | None) -> bool:
    if not value or "|" not in value:
        return False
    payload, signature = value.rsplit("|", 1)
    expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected) and payload.startswith(f"{ADMIN_USERNAME}:")


def require_session(request: Request) -> None:
    if not valid_session(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    if valid_session(request.cookies.get(COOKIE_NAME)):
        return RedirectResponse("/dashboard", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    username_ok = hmac.compare_digest(username, ADMIN_USERNAME)
    password_ok = hmac.compare_digest(password, ADMIN_PASSWORD)
    if not (username_ok and password_ok):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Usuario o contraseña incorrectos"},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    response = RedirectResponse("/dashboard", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(COOKIE_NAME, make_session(username), httponly=True, samesite="lax", max_age=60 * 60 * 12)
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(COOKIE_NAME)
    return response


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    if not valid_session(request.cookies.get(COOKIE_NAME)):
        return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse("dashboard.html", {"request": request, "username": ADMIN_USERNAME})


@app.get("/api/products")
def list_products(_: None = Depends(require_session)):
    with get_db() as db:
        rows = db.execute("SELECT * FROM products ORDER BY name COLLATE NOCASE").fetchall()
    return [product_json(row) for row in rows]


@app.post("/api/products", status_code=201)
def create_product(payload: dict[str, Any], _: None = Depends(require_session)):
    name = str(payload.get("name", "")).strip()
    category = str(payload.get("category", "General")).strip() or "General"
    if not name:
        raise HTTPException(status_code=422, detail="El nombre es obligatorio")
    try:
        stock = int(payload.get("stock", 0))
        min_stock = int(payload.get("min_stock", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="El stock debe ser un número entero")
    if stock < 0 or min_stock < 0:
        raise HTTPException(status_code=422, detail="El stock no puede ser negativo")
    purchase = price_to_cents(payload.get("purchase_price", 0), "El precio de compra")
    sale = price_to_cents(payload.get("sale_price", 0), "El precio de venta")
    with get_db() as db:
        try:
            cursor = db.execute(
                """INSERT INTO products (name, category, purchase_price_cents, sale_price_cents, stock, min_stock)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (name, category, purchase, sale, stock, min_stock),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Ya existe un producto con ese nombre")
        row = db.execute("SELECT * FROM products WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return product_json(row)


@app.put("/api/products/{product_id}")
def update_product(product_id: int, payload: dict[str, Any], _: None = Depends(require_session)):
    name = str(payload.get("name", "")).strip()
    category = str(payload.get("category", "General")).strip() or "General"
    if not name:
        raise HTTPException(status_code=422, detail="El nombre es obligatorio")
    try:
        stock = int(payload.get("stock", 0))
        min_stock = int(payload.get("min_stock", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="El stock debe ser un número entero")
    if stock < 0 or min_stock < 0:
        raise HTTPException(status_code=422, detail="El stock no puede ser negativo")
    purchase = price_to_cents(payload.get("purchase_price", 0), "El precio de compra")
    sale = price_to_cents(payload.get("sale_price", 0), "El precio de venta")
    with get_db() as db:
        try:
            result = db.execute(
                """UPDATE products SET name = ?, category = ?, purchase_price_cents = ?, sale_price_cents = ?,
                   stock = ?, min_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (name, category, purchase, sale, stock, min_stock, product_id),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Ya existe un producto con ese nombre")
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        row = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    return product_json(row)


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, _: None = Depends(require_session)):
    with get_db() as db:
        try:
            result = db.execute("DELETE FROM products WHERE id = ?", (product_id,))
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="No se puede eliminar un producto que ya tiene ventas")
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"message": "Producto eliminado"}


@app.post("/api/sales", status_code=201)
def create_sale(payload: dict[str, Any], _: None = Depends(require_session)):
    try:
        product_id = int(payload.get("product_id"))
        quantity = int(payload.get("quantity"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Producto y cantidad son obligatorios")
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="La cantidad debe ser mayor que cero")
    with get_db() as db:
        db.execute("BEGIN IMMEDIATE")
        product = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if product is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        if product["stock"] < quantity:
            raise HTTPException(status_code=409, detail=f"Stock insuficiente. Disponible: {product['stock']}")
        total_sale = product["sale_price_cents"] * quantity
        total_cost = product["purchase_price_cents"] * quantity
        profit = total_sale - total_cost
        sold_at = datetime.now().isoformat(timespec="seconds")
        db.execute(
            """INSERT INTO sales (product_id, quantity, unit_sale_price_cents, unit_cost_cents,
               total_sale_cents, total_cost_cents, profit_cents, sold_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (product_id, quantity, product["sale_price_cents"], product["purchase_price_cents"], total_sale, total_cost, profit, sold_at),
        )
        db.execute("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (quantity, product_id))
    return {"message": "Venta registrada", "total": cents_to_price(total_sale), "profit": cents_to_price(profit)}


@app.get("/api/sales")
def list_sales(month: str | None = None, _: None = Depends(require_session)):
    month = month or datetime.now().strftime("%Y-%m")
    with get_db() as db:
        rows = db.execute(
            """SELECT s.id, p.name AS product_name, s.quantity, s.total_sale_cents,
               s.profit_cents, s.sold_at FROM sales s JOIN products p ON p.id = s.product_id
               WHERE substr(s.sold_at, 1, 7) = ? ORDER BY s.sold_at DESC""",
            (month,),
        ).fetchall()
    return [
        {"id": row["id"], "product_name": row["product_name"], "quantity": row["quantity"],
         "total": cents_to_price(row["total_sale_cents"]), "profit": cents_to_price(row["profit_cents"]), "sold_at": row["sold_at"]}
        for row in rows
    ]


@app.get("/api/summary")
def summary(month: str | None = None, _: None = Depends(require_session)):
    month = month or datetime.now().strftime("%Y-%m")
    with get_db() as db:
        sales = db.execute(
            """SELECT COALESCE(SUM(total_sale_cents), 0) AS revenue,
                      COALESCE(SUM(total_cost_cents), 0) AS cost,
                      COALESCE(SUM(profit_cents), 0) AS profit,
                      COALESCE(SUM(quantity), 0) AS units,
                      COUNT(*) AS transactions
               FROM sales WHERE substr(sold_at, 1, 7) = ?""",
            (month,),
        ).fetchone()
        inventory = db.execute("SELECT COUNT(*) AS products, COALESCE(SUM(stock), 0) AS units, SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) AS low_stock FROM products").fetchone()
    return {
        "month": month,
        "revenue": cents_to_price(sales["revenue"]),
        "cost": cents_to_price(sales["cost"]),
        "profit": cents_to_price(sales["profit"]),
        "units_sold": sales["units"],
        "transactions": sales["transactions"],
        "products": inventory["products"],
        "inventory_units": inventory["units"],
        "low_stock": inventory["low_stock"] or 0,
    }


init_db()
