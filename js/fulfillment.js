(function () {
  'use strict';

  const state = { selected: new Set() };
  const eligibleOrders = () => Storage.getOrders().filter(order => ['new', 'processing'].includes(order.status));
  const orderItems = order => Array.isArray(order.items) && order.items.length
    ? order.items
    : [{ productId: order.productId, productName: order.productName, quantity: order.quantity }];
  const aggregate = orders => {
    const items = new Map();
    orders.forEach(order => orderItems(order).forEach(item => {
      const key = String(item.productId || item.productName || 'unknown');
      const current = items.get(key) || { productName: item.productName || 'منتج', quantity: 0 };
      current.quantity += Math.max(1, Number(item.quantity) || 1);
      items.set(key, current);
    }));
    return [...items.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'ar'));
  };
  const renderOrderRows = orders => orders.length
    ? orders.map(order => `<tr><td><input type="checkbox" data-fulfillment-select="${escapeAttr(order.id)}" ${state.selected.has(order.id) ? 'checked' : ''} aria-label="تحديد الأوردر ${escapeAttr(order.id)}"></td><td><b>${escapeHTML(order.id)}</b></td><td>${escapeHTML(order.clientName)}<small class="text-muted" style="display:block">${escapeHTML(order.clientPhone)}</small></td><td>${escapeHTML(order.productName)}</td><td>${Number(order.quantity || 0)}</td><td>${statusBadge(order.status)}</td><td>${formatDate(order.createdAt)}</td></tr>`).join('')
    : `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div>لا توجد أوردرات غير مشحونة حاليًا</div></td></tr>`;
  const renderItems = items => items.length
    ? items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHTML(item.productName)}</td><td class="quantity-total">${item.quantity}</td></tr>`).join('')
    : `<tr><td colspan="3"><div class="empty-state">حدد الأوردرات ثم اضغط «إنشاء التقرير»</div></td></tr>`;
  const updateSelectionState = () => {
    const count = state.selected.size;
    const button = document.getElementById('generate-fulfillment-report');
    if (button) button.textContent = count ? `📊 إنشاء التقرير (${count})` : '📊 إنشاء التقرير';
    if (button) button.disabled = !count;
    const countElement = document.getElementById('fulfillment-selection-count');
    if (countElement) countElement.textContent = `تم تحديد ${count} من ${eligibleOrders().length} أوردر`;
  };
  const bind = () => {
    document.querySelectorAll('[data-fulfillment-select]').forEach(input => {
      input.onchange = () => {
        if (input.checked) state.selected.add(input.dataset.fulfillmentSelect);
        else state.selected.delete(input.dataset.fulfillmentSelect);
        updateSelectionState();
      };
    });
    document.getElementById('fulfillment-select-all')?.addEventListener('change', event => {
      document.querySelectorAll('[data-fulfillment-select]').forEach(input => {
        input.checked = event.target.checked;
        if (event.target.checked) state.selected.add(input.dataset.fulfillmentSelect);
        else state.selected.delete(input.dataset.fulfillmentSelect);
      });
      updateSelectionState();
    });
    document.getElementById('generate-fulfillment-report')?.addEventListener('click', () => {
      const orders = eligibleOrders().filter(order => state.selected.has(order.id));
      if (!orders.length) return showToast('حدد أوردرًا واحدًا على الأقل لإنشاء التقرير', 'warning');
      const items = aggregate(orders);
      const report = document.getElementById('fulfillment-result');
      report.innerHTML = `<div class="card-head"><div><h2>تقرير تجميع الأصناف</h2><p class="text-muted">تم تجميع ${orders.length} أوردر في ${items.length} صنف.</p></div><button class="btn btn-outline btn-small" id="print-fulfillment-report">🖨️ طباعة التقرير</button></div><div class="table-wrap"><table class="data-table fulfillment-items-table"><thead><tr><th>#</th><th>الصنف</th><th>إجمالي الكمية المطلوبة</th></tr></thead><tbody>${renderItems(items)}</tbody></table></div>`;
      document.getElementById('print-fulfillment-report').onclick = () => printFulfillmentAggregationReport(orders, items);
      showToast('تم إنشاء تقرير تجميع الأصناف');
    });
    updateSelectionState();
  };
  window.printFulfillmentAggregationReport = (orders, items) => {
    const popup = window.open('', '_blank', 'width=820,height=920');
    if (!popup) return showToast('اسمح بالنوافذ المنبثقة لطباعة التقرير', 'warning');
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير تجميع الأصناف</title><style>*{box-sizing:border-box}body{margin:0;padding:30px;font-family:Tahoma,Arial,sans-serif;color:#172b4d;background:#fff}main{max-width:760px;margin:auto}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:16px}.head h1{margin:0;color:#1e3a5f;font-size:24px}.meta{margin:18px 0;padding:12px;background:#f5f8fb;border-radius:9px;display:flex;justify-content:space-between}table{width:100%;border-collapse:collapse}th,td{padding:12px 10px;border-bottom:1px solid #d9e2ec;text-align:right}th{background:#1e3a5f;color:#fff}.total{margin-top:18px;padding:14px;background:#fff5df;border:1px solid #f5a623;border-radius:9px;font-weight:700}.actions{text-align:center;margin-top:24px}.actions button{border:0;border-radius:8px;padding:11px 20px;background:#1e3a5f;color:#fff;font:inherit;font-weight:700;cursor:pointer}@media print{body{padding:0}.no-print{display:none!important}}</style></head><body><main><section class="head"><h1>تقرير تجميع الأصناف</h1><span>${new Date().toLocaleDateString('ar-EG')}</span></section><div class="meta"><span>عدد الأوردرات: <b>${orders.length}</b></span><span>عدد الأصناف: <b>${items.length}</b></span></div><table><thead><tr><th>#</th><th>الصنف</th><th>إجمالي الكمية</th></tr></thead><tbody>${items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHTML(item.productName)}</td><td>${item.quantity}</td></tr>`).join('')}</tbody></table><div class="total">إجمالي القطع المطلوبة: ${items.reduce((sum, item) => sum + item.quantity, 0)}</div><div class="actions no-print"><button onclick="window.print()">🖨️ طباعة التقرير</button></div></main></body></html>`);
    popup.document.close();
    popup.focus();
  };
  window.FulfillmentApp = {
    showReport() {
      const orders = eligibleOrders();
      state.selected = new Set([...state.selected].filter(id => orders.some(order => order.id === id)));
      mainContent.innerHTML = `<div class="page-head"><div><h1>تقرير تجميع الأصناف</h1><p>تقرير الطلبات غير المشحونة — استبعدنا الأوردرات الملغية والمشحونة بالكامل.</p></div><div class="page-actions"><button class="btn btn-primary" id="generate-fulfillment-report" disabled>📊 إنشاء التقرير</button></div></div><div class="card"><div class="card-head"><div><h2>اختيار الأوردرات</h2><p class="text-muted">يمكنك تحديد أوردرات بعينها أو تحديد الكل لتجميع الكميات المطلوبة.</p></div><span id="fulfillment-selection-count" class="notice">تم تحديد 0 من ${orders.length} أوردر</span></div><div class="table-wrap"><table class="data-table fulfillment-orders-table"><thead><tr><th><input type="checkbox" id="fulfillment-select-all" aria-label="تحديد كل الأوردرات"></th><th>رقم الأوردر</th><th>العميل/الهاتف</th><th>الأصناف</th><th>الكمية</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${renderOrderRows(orders)}</tbody></table></div></div><div id="fulfillment-result" class="card fulfillment-result"><div class="empty-state"><div class="empty-icon">📊</div>سيظهر التجميع هنا بعد إنشاء التقرير.</div></div>`;
      bind();
    }
  };
})();
