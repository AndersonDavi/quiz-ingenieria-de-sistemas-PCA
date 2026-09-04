# Estanco Control

Aplicación web para que un administrador gestione el inventario y registre ventas de un estanco. Está construida con FastAPI, SQLite y una interfaz HTML/CSS/JavaScript sin framework.

## Funcionalidades

- Login con un único usuario administrador.
- Crear, editar y eliminar productos.
- Control de stock, precio de compra, precio de venta y nivel mínimo.
- Registrar ventas con validación de stock.
- Descuento automático del inventario al registrar una venta.
- Cálculo de ingresos, costos y ganancias mensuales.
- Historial de ventas filtrable por mes.

## Puesta en marcha

Requiere Python 3.10 o superior.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload
```

Abrir http://127.0.0.1:8000

La cuenta inicial es `admin` / `admin123`. Antes de usarla en un entorno real, definir credenciales y una clave de sesión:

```powershell
$env:ADMIN_USERNAME="tu_usuario"
$env:ADMIN_PASSWORD="tu_clave_segura"
$env:SESSION_SECRET="una-clave-larga-y-aleatoria"
uvicorn app:app
```

La base de datos se crea automáticamente en `data/estanco.db`. Para cambiar su ubicación se puede definir `DATABASE_PATH`.

## Modelo de ganancias

Cada venta guarda una copia del precio de compra y de venta vigentes en el momento de la operación. La ganancia se calcula como:

`(precio de venta - precio de compra) × unidades vendidas`

Esto mantiene el histórico correcto aunque después se modifique el precio de un producto.
