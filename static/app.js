const state = { products: [], month: new Date().toISOString().slice(0, 7) };
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2 }).format(value || 0);
const $ = selector => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 401) { window.location.href = '/'; return null; }
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'No fue posible completar la operación');
  return data;
}

function showAlert(selector, message, type = 'success') { const element = $(selector); element.textContent = message; element.className = `alert ${type}`; setTimeout(() => element.classList.add('hidden'), 4500); }
function monthLabel(month) { return new Date(`${month}-01T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); }

async function loadSummary() {
  const summary = await api(`/api/summary?month=${state.month}`);
  $('#month-title').textContent = monthLabel(state.month); $('#sales-month-title').textContent = monthLabel(state.month);
  $('#metric-profit').textContent = money(summary.profit); $('#metric-revenue').textContent = money(summary.revenue);
  $('#metric-units').textContent = summary.units_sold; $('#metric-low-stock').textContent = summary.low_stock;
  $('#sales-caption').textContent = `${summary.transactions} transacciones`;
}

function renderProducts() {
  const table = $('#products-table');
  if (!state.products.length) { table.innerHTML = '<tr><td colspan="7" class="empty">Aún no hay productos. Registra el primero para comenzar.</td></tr>'; return; }
  table.innerHTML = state.products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td><span class="tag">${escapeHtml(product.category)}</span></td><td>${money(product.purchase_price)}</td><td>${money(product.sale_price)}</td><td class="${product.margin < 0 ? 'stock low' : 'stock'}">${money(product.margin)}</td><td class="stock ${product.low_stock ? 'low' : ''}">${product.stock}${product.low_stock ? ' · bajo' : ''}</td><td><div class="row-actions"><button class="row-action" data-edit="${product.id}" title="Editar">✎</button><button class="row-action" data-delete="${product.id}" title="Eliminar">×</button></div></td></tr>`).join('');
  table.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openProductModal(Number(button.dataset.edit))));
  table.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteProduct(Number(button.dataset.delete))));
}

function renderSaleProducts() { $('#sale-product').innerHTML = '<option value="">Selecciona un producto</option>' + state.products.filter(p => p.stock > 0).map(p => `<option value="${p.id}">${escapeHtml(p.name)} · ${p.stock} disponibles</option>`).join(''); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

async function loadProducts() { state.products = await api('/api/products') || []; renderProducts(); renderSaleProducts(); }
async function loadSales() {
  const sales = await api(`/api/sales?month=${state.month}`); const table = $('#sales-table');
  if (!sales.length) { table.innerHTML = '<tr><td colspan="5" class="empty">No hay ventas registradas en este mes.</td></tr>'; return; }
  table.innerHTML = sales.map(sale => `<tr><td>${new Date(sale.sold_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${escapeHtml(sale.product_name)}</td><td>${sale.quantity}</td><td>${money(sale.total)}</td><td class="stock">${money(sale.profit)}</td></tr>`).join('');
}
async function refresh() { await loadProducts(); await loadSummary(); await loadSales(); }

function openProductModal(id = null) {
  const product = id ? state.products.find(item => item.id === id) : null;
  $('#modal-title').textContent = product ? 'Editar producto' : 'Nuevo producto'; $('#product-id').value = product?.id || '';
  $('#product-name').value = product?.name || ''; $('#product-category').value = product?.category || 'General'; $('#product-purchase').value = product?.purchase_price ?? ''; $('#product-sale').value = product?.sale_price ?? ''; $('#product-stock').value = product?.stock ?? 0; $('#product-min-stock').value = product?.min_stock ?? 5;
  $('#product-dialog').showModal();
}
async function deleteProduct(id) { if (!confirm('¿Eliminar este producto?')) return; try { await api(`/api/products/${id}`, { method: 'DELETE' }); await refresh(); showAlert('#inventory-alert', 'Producto eliminado.'); } catch (error) { showAlert('#inventory-alert', error.message, 'error'); } }

$('#new-product-button').addEventListener('click', () => openProductModal());
$('#product-form').addEventListener('submit', async event => { event.preventDefault(); const id = $('#product-id').value; const payload = { name: $('#product-name').value, category: $('#product-category').value, purchase_price: $('#product-purchase').value, sale_price: $('#product-sale').value, stock: $('#product-stock').value, min_stock: $('#product-min-stock').value }; try { await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); $('#product-dialog').close(); await refresh(); showAlert('#inventory-alert', id ? 'Producto actualizado.' : 'Producto creado.'); } catch (error) { showAlert('#inventory-alert', error.message, 'error'); } });
$('#sale-form').addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/sales', { method: 'POST', body: JSON.stringify({ product_id: $('#sale-product').value, quantity: $('#sale-quantity').value }) }); $('#sale-quantity').value = 1; await refresh(); showAlert('#sale-alert', `${result.message}. Ganancia: ${money(result.profit)}`); } catch (error) { showAlert('#sale-alert', error.message, 'error'); } });
function updateSalePreview() { const product = state.products.find(p => p.id === Number($('#sale-product').value)); $('#sale-total').textContent = product ? money(product.sale_price * Number($('#sale-quantity').value || 0)) : money(0); }
$('#sale-product').addEventListener('change', updateSalePreview); $('#sale-quantity').addEventListener('input', updateSalePreview);
$('#month-filter').value = state.month; $('#month-filter').addEventListener('change', async event => { state.month = event.target.value; await loadSummary(); await loadSales(); });
$('#today-label').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
refresh().catch(error => showAlert('#inventory-alert', error.message, 'error'));

