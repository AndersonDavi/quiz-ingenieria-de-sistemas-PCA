const state = {
  products: [],
  sales: [],
  month: new Date().toISOString().slice(0, 7),
  productsPage: 1,
  salesPage: 1,
  pageSize: 6,
  inventorySearch: '',
  salesSearch: ''
};

const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2 }).format(value || 0);
const $ = selector => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 401) { window.location.href = '/'; return null; }
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'No fue posible completar la operación');
  return data;
}

function showAlert(selector, message, type = 'success') {
  const element = $(selector);
  element.textContent = message;
  element.className = `alert ${type}`;
  setTimeout(() => element.classList.add('hidden'), 4500);
}

function monthLabel(month) { return new Date(`${month}-01T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

async function loadSummary() {
  const summary = await api(`/api/summary?month=${state.month}`);
  $('#month-title').textContent = monthLabel(state.month);
  $('#sales-month-title').textContent = monthLabel(state.month);
  $('#metric-profit').textContent = money(summary.profit);
  $('#metric-revenue').textContent = money(summary.revenue);
  $('#metric-units').textContent = summary.units_sold;
  $('#metric-low-stock').textContent = summary.low_stock;
  $('#sales-caption').textContent = `${summary.transactions} transacciones`;
}

function filteredProducts() {
  const search = state.inventorySearch.trim().toLocaleLowerCase();
  return state.products.filter(product => !search || `${product.name} ${product.category}`.toLocaleLowerCase().includes(search));
}

function renderPagination(selector, currentPage, totalItems, onChange) {
  const element = $(selector);
  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  element.innerHTML = totalItems > state.pageSize ? `<span>${currentPage} de ${totalPages}</span><div><button type="button" class="page-button" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>← Anterior</button><button type="button" class="page-button" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente →</button></div>` : '';
  element.querySelector('[data-page="prev"]')?.addEventListener('click', () => onChange(currentPage - 1));
  element.querySelector('[data-page="next"]')?.addEventListener('click', () => onChange(currentPage + 1));
}

function renderProducts() {
  const products = filteredProducts();
  const totalPages = Math.max(1, Math.ceil(products.length / state.pageSize));
  state.productsPage = Math.min(state.productsPage, totalPages);
  const start = (state.productsPage - 1) * state.pageSize;
  const visibleProducts = products.slice(start, start + state.pageSize);
  const table = $('#products-table');
  if (!products.length) { table.innerHTML = `<tr><td colspan="7" class="empty">${state.inventorySearch ? 'No encontramos productos con esa búsqueda.' : 'Aún no hay productos. Registra el primero para comenzar.'}</td></tr>`; } else {
    table.innerHTML = visibleProducts.map(product => `<tr><td>${escapeHtml(product.name)}</td><td><span class="tag">${escapeHtml(product.category)}</span></td><td>${money(product.purchase_price)}</td><td>${money(product.sale_price)}</td><td class="${product.margin < 0 ? 'stock low' : 'stock'}">${money(product.margin)}</td><td class="stock ${product.low_stock ? 'low' : ''}">${product.stock}${product.low_stock ? ' · bajo' : ''}</td><td><div class="row-actions"><button type="button" class="row-action" data-edit="${product.id}" title="Editar">✎</button><button type="button" class="row-action" data-delete="${product.id}" title="Eliminar">×</button></div></td></tr>`).join('');
    table.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openProductModal(Number(button.dataset.edit))));
    table.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteProduct(Number(button.dataset.delete))));
  }
  renderPagination('#products-pagination', state.productsPage, products.length, page => { state.productsPage = page; renderProducts(); });
}

function renderSaleProducts() {
  $('#sale-product').innerHTML = '<option value="">Selecciona un producto</option>' + state.products.filter(product => product.stock > 0).map(product => `<option value="${product.id}">${escapeHtml(product.name)} · ${product.stock} disponibles</option>`).join('');
  updateSalePreview();
}

function filteredSales() {
  const search = state.salesSearch.trim().toLocaleLowerCase();
  return state.sales.filter(sale => !search || sale.product_name.toLocaleLowerCase().includes(search));
}

function renderSales() {
  const sales = filteredSales();
  const totalPages = Math.max(1, Math.ceil(sales.length / state.pageSize));
  state.salesPage = Math.min(state.salesPage, totalPages);
  const visibleSales = sales.slice((state.salesPage - 1) * state.pageSize, state.salesPage * state.pageSize);
  const table = $('#sales-table');
  if (!sales.length) { table.innerHTML = `<tr><td colspan="5" class="empty">${state.salesSearch ? 'No encontramos ventas con esa búsqueda.' : 'No hay ventas registradas en este mes.'}</td></tr>`; } else {
    table.innerHTML = visibleSales.map(sale => `<tr><td>${new Date(sale.sold_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${escapeHtml(sale.product_name)}</td><td>${sale.quantity}</td><td>${money(sale.total)}</td><td class="stock">${money(sale.profit)}</td></tr>`).join('');
  }
  renderPagination('#sales-pagination', state.salesPage, sales.length, page => { state.salesPage = page; renderSales(); });
}

async function loadProducts() { state.products = await api('/api/products') || []; renderProducts(); renderSaleProducts(); }
async function loadSales() { state.sales = await api(`/api/sales?month=${state.month}`) || []; renderSales(); }
async function refresh() { await loadProducts(); await loadSummary(); await loadSales(); }

function openProductModal(id = null) {
  const product = id ? state.products.find(item => item.id === id) : null;
  $('#modal-title').textContent = product ? 'Editar producto' : 'Nuevo producto';
  $('#product-id').value = product?.id || '';
  $('#product-name').value = product?.name || '';
  $('#product-category').value = product?.category || 'General';
  $('#product-purchase').value = product?.purchase_price ?? '';
  $('#product-sale').value = product?.sale_price ?? '';
  $('#product-stock').value = product?.stock ?? 0;
  $('#product-min-stock').value = product?.min_stock ?? 5;
  $('#product-dialog').showModal();
  $('#product-name').focus();
}

function closeProductModal() { $('#product-dialog').close(); }

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  try { await api(`/api/products/${id}`, { method: 'DELETE' }); await refresh(); showAlert('#inventory-alert', 'Producto eliminado.'); }
  catch (error) { showAlert('#inventory-alert', error.message, 'error'); }
}

document.querySelectorAll('[data-scroll-target]').forEach(button => button.addEventListener('click', () => {
  const target = document.getElementById(button.dataset.scrollTarget);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link === button));
}));

$('#new-product-button').addEventListener('click', () => openProductModal());
document.querySelectorAll('[data-close-product-dialog]').forEach(button => button.addEventListener('click', closeProductModal));
$('#product-dialog').addEventListener('click', event => { if (event.target === $('#product-dialog')) closeProductModal(); });

$('#product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#product-id').value;
  const payload = { name: $('#product-name').value.trim(), category: $('#product-category').value.trim(), purchase_price: $('#product-purchase').value, sale_price: $('#product-sale').value, stock: $('#product-stock').value, min_stock: $('#product-min-stock').value };
  try {
    await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    closeProductModal();
    state.productsPage = 1;
    await refresh();
    showAlert('#inventory-alert', id ? 'Producto actualizado.' : 'Producto creado.');
  } catch (error) { showAlert('#inventory-alert', error.message, 'error'); }
});

$('#sale-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/sales', { method: 'POST', body: JSON.stringify({ product_id: $('#sale-product').value, quantity: $('#sale-quantity').value }) });
    $('#sale-quantity').value = 1;
    await refresh();
    showAlert('#sale-alert', `${result.message}. Ganancia: ${money(result.profit)}`);
  } catch (error) { showAlert('#sale-alert', error.message, 'error'); }
});

function updateSalePreview() { const product = state.products.find(item => item.id === Number($('#sale-product').value)); $('#sale-total').textContent = product ? money(product.sale_price * Number($('#sale-quantity').value || 0)) : money(0); }
$('#sale-product').addEventListener('change', updateSalePreview);
$('#sale-quantity').addEventListener('input', updateSalePreview);
$('#inventory-search').addEventListener('input', event => { state.inventorySearch = event.target.value; state.productsPage = 1; renderProducts(); });
$('#sales-search').addEventListener('input', event => { state.salesSearch = event.target.value; state.salesPage = 1; renderSales(); });
$('#month-filter').value = state.month;
$('#month-filter').addEventListener('change', async event => { state.month = event.target.value; state.salesPage = 1; state.salesSearch = ''; $('#sales-search').value = ''; await loadSummary(); await loadSales(); });
$('#today-label').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
refresh().catch(error => showAlert('#inventory-alert', error.message, 'error'));
