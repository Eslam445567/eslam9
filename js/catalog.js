(function () {
  'use strict';

  const MIN_DOZENS = 30;
  const state = {
    token: '',
    settings: {},
    marketer: null,
    products: [],
    cart: new Map(),
    selectedVariants: new Map(),
    checkoutVisible: false,
    submitted: false,
    requestId: ''
  };

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const money = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const uuid = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storedTokenKey = 'oms_catalog_invite_token';

  function whatsappHref(settings) {
    let number = String(settings?.whatsapp_number || '').replace(/\D/g, '');
    if (number.startsWith('00')) number = number.slice(2);
    if (number.startsWith('0')) number = `20${number.slice(1)}`;
    return number ? `https://wa.me/${number}` : '';
  }

  function getToken() {
    const queryToken = new URLSearchParams(window.location.search).get('catalog');
    if (queryToken) {
      sessionStorage.setItem(storedTokenKey, queryToken.trim());
      return queryToken.trim();
    }
    return sessionStorage.getItem(storedTokenKey) || '';
  }

  function cartItems() {
    return [...state.cart.entries()].map(([productId, quantity]) => {
      const product = state.products.flatMap(family => family.variants || []).find(item => String(item.id) === String(productId));
      const family = state.products.find(item => (item.variants || []).some(variant => String(variant.id) === String(productId)));
      return product ? { product: { ...product, familyName: family?.name || '' }, quantity } : null;
    }).filter(Boolean);
  }

  function totalDozens() {
    return cartItems().reduce((sum, item) => sum + item.quantity, 0);
  }

  function totalPrice() {
    return cartItems().reduce((sum, item) => sum + Number(item.product.salePrice || 0) * item.quantity, 0);
  }

  function productImage(product) {
    if (!product.imageUrl) return '<div class="catalog-product-placeholder" aria-hidden="true">📦</div>';
    return `<img src="${escape(product.imageUrl)}" alt="${escape(product.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;catalog-product-placeholder&quot; aria-hidden=&quot;true&quot;>📦</div>'">`;
  }

  function header() {
    const settings = state.settings || {};
    const logo = settings.logo_url || '';
    const whatsapp = whatsappHref(settings);
    return `<header class="catalog-header"><div class="catalog-brand">${logo ? `<img src="${escape(logo)}" alt="شعار المصنع">` : '<span class="catalog-brand-mark">✦</span>'}<div><strong>${escape(settings.factory_name || 'كتالوج المصنع')}</strong><small>${state.marketer ? `مرحبًا بك عبر رابط ${escape(state.marketer.name)}` : 'بيع بالجملة'}</small></div></div><div class="catalog-header-actions">${whatsapp ? `<a class="catalog-whatsapp" href="${whatsapp}" target="_blank" rel="noopener">💬 استفسار واتساب</a>` : ''}<div class="catalog-header-cart">🛒 <b id="catalog-cart-count">${totalDozens()}</b> دستة</div></div></header>`;
  }

  function quantityEditor(product, quantity, inCart = false) {
    const id = escape(product.id);
    return `<div class="catalog-quantity-editor"><label>الكمية بالدستة</label><input type="number" min="1" step="1" inputmode="numeric" data-catalog-quantity="${id}" value="${quantity || ''}" placeholder="مثال: 30"><div class="catalog-presets"><button type="button" data-catalog-preset="${id}" data-quantity="50">50</button><button type="button" data-catalog-preset="${id}" data-quantity="100">100</button></div>${inCart ? '' : `<button type="button" class="catalog-add-btn" data-catalog-apply="${id}">${quantity ? 'تحديث الكمية' : 'أضف إلى العربة'}</button>`}</div>`;
  }

  function productsMarkup() {
    if (!state.products.length) return '<div class="catalog-empty">لا توجد منتجات متاحة حاليًا.</div>';
    return `<div class="catalog-products">${state.products.map(family => { const variants = family.variants || []; const selectedId = state.selectedVariants.get(family.id) || variants[0]?.id || ''; const selected = variants.find(variant => String(variant.id) === String(selectedId)) || variants[0]; const quantity = selected ? (state.cart.get(selected.id) || 0) : 0; return `<article class="catalog-product-card"><div class="catalog-product-image">${productImage({ imageUrl: family.imageUrl, name: family.name })}</div><div class="catalog-product-body"><h3>${escape(family.name)}</h3><div class="catalog-product-meta"><span>${variants.length} مقاس متاح</span></div><label class="catalog-variant-label">اختر المقاس<select data-catalog-variant="${escape(family.id)}">${variants.map(variant => `<option value="${escape(variant.id)}" ${String(variant.id) === String(selected?.id) ? 'selected' : ''}>${escape([variant.size, variant.design].filter(Boolean).join(' · ') || 'المقاس الافتراضي')} — ${money(variant.salePrice)} ج.م</option>`).join('')}</select></label>${selected ? `<strong class="catalog-price">${money(selected.salePrice)} <small>ج.م / الدستة</small></strong><div class="catalog-product-action">${quantityEditor(selected, quantity)}</div>` : '<div class="catalog-empty">لا توجد مقاسات مفعلة</div>'}</div></article>`; }).join('')}</div>`;
  }

  function cartMarkup() {
    const items = cartItems();
    const count = totalDozens();
    const remaining = Math.max(0, MIN_DOZENS - count);
    const progress = Math.min(100, (count / MIN_DOZENS) * 100);
    return `<aside class="catalog-cart card"><div class="catalog-cart-head"><div><h2>عربة التسوق</h2><p>${items.length ? 'اكتب الكمية مباشرة أو اختر 50 أو 100 دستة.' : 'أضف منتجات للبدء.'}</p></div><span class="catalog-cart-icon">🛒</span></div>${items.length ? `<div class="catalog-cart-items">${items.map(({ product, quantity }) => `<div class="catalog-cart-item"><div class="catalog-cart-thumb">${productImage(product)}</div><div class="catalog-cart-info"><b>${escape(product.familyName || product.name || 'منتج')}</b><small>${product.size ? `المقاس: ${escape(product.size)} · ` : ''}${product.design ? `التصميم: ${escape(product.design)}` : ''}</small><span>${money(product.salePrice)} ج.م / دستة</span></div><div class="catalog-cart-controls">${quantityEditor(product, quantity, true)}<button type="button" class="catalog-remove" data-catalog-remove="${escape(product.id)}" aria-label="حذف المنتج">×</button></div><strong class="catalog-line-total">${money(product.salePrice * quantity)} ج.م</strong></div>`).join('')}</div>` : '<div class="catalog-cart-empty">العربة فارغة</div>'}<div class="catalog-minimum"><div class="catalog-minimum-row"><span>إجمالي الدستات</span><b>${count} دستة</b></div><div class="catalog-progress"><span style="width:${progress}%"></span></div><p class="${remaining ? 'warning' : 'success'}">${remaining ? `متبقي ${remaining} دستة للوصول للحد الأدنى` : 'تم استيفاء الحد الأدنى للطلب'}</p></div><div class="catalog-total-row"><span>إجمالي الطلب</span><strong>${money(totalPrice())} ج.م</strong></div><button type="button" class="btn btn-primary btn-block catalog-checkout-btn" id="catalog-checkout" ${count < MIN_DOZENS || state.submitted ? 'disabled' : ''}>متابعة وتسجيل بيانات العميل</button>${state.checkoutVisible ? checkoutMarkup() : ''}</aside>`;
  }

  function checkoutMarkup() {
    return `<div class="catalog-checkout-form-wrap"><h3>بيانات استلام الطلب</h3><p class="muted">لن تحتاج إلى إنشاء حساب. اكتب بيانات التواصل والتوصيل فقط.</p><form id="catalog-checkout-form" novalidate><div class="catalog-form-grid"><label>الاسم بالكامل *<input name="clientName" required></label><label>رقم الموبايل *<input name="clientPhone" type="tel" inputmode="tel" required></label><label>المحافظة *<input name="governorate" required></label><label>المدينة أو المركز *<input name="city" required></label><label class="full">العنوان بالتفصيل *<textarea name="address" rows="3" required></textarea></label><label class="full">ملاحظات إضافية <textarea name="notes" rows="2"></textarea></label></div><div id="catalog-form-error" class="form-error" role="alert"></div><button class="btn btn-accent btn-block" type="submit">تأكيد إرسال الطلب</button></form></div>`;
  }

  function render() {
    const root = document.getElementById('catalog-content');
    root.innerHTML = `${header()}<main class="catalog-main"><div class="catalog-intro"><div><span class="catalog-kicker">كتالوج الجملة</span><h1>اختار منتجاتك واطلب بسهولة</h1><p>الحد الأدنى للطلب ${MIN_DOZENS} دستة إجماليًا، ويمكنك تجميع الأنواع والمقاسات المختلفة.</p></div><div class="catalog-source">${state.marketer ? `الرابط بواسطة: <b>${escape(state.marketer.name)}</b>` : 'طلب مباشر من المصنع'}</div></div><div class="catalog-layout"><section><div class="catalog-section-title"><h2>أنواع الفوط المتاحة</h2><span>${state.products.length} نوع</span></div>${productsMarkup()}</section>${cartMarkup()}</div></main><footer class="catalog-footer">© ${new Date().getFullYear()} ${escape(state.settings?.factory_name || 'المصنع')} · للطلبات بالجملة</footer>`;
    bind();
  }

  function changeQuantity(productId, delta) {
    const current = state.cart.get(productId) || 0;
    const next = current + delta;
    if (next <= 0) state.cart.delete(productId); else state.cart.set(productId, next);
    render();
  }

  function bind() {
    document.querySelectorAll('[data-catalog-variant]').forEach(select => select.onchange = () => { state.selectedVariants.set(select.dataset.catalogVariant, select.value); render(); });
    document.querySelectorAll('[data-catalog-apply]').forEach(button => button.onclick = () => {
      const input = button.closest('.catalog-product-body')?.querySelector('[data-catalog-quantity]');
      const quantity = Math.floor(Number(input?.value || 0));
      if (quantity < 1) return showToast('اكتب كمية صحيحة بالدستة أولًا', 'warning');
      state.cart.set(button.dataset.catalogApply, quantity); render();
    });
    document.querySelectorAll('[data-catalog-preset]').forEach(button => button.onclick = () => {
      state.cart.set(button.dataset.catalogPreset, Number(button.dataset.quantity)); render();
    });
    document.querySelectorAll('[data-catalog-quantity]').forEach(input => input.onchange = () => {
      const quantity = Math.floor(Number(input.value || 0));
      if (quantity < 1) state.cart.delete(input.dataset.catalogQuantity); else state.cart.set(input.dataset.catalogQuantity, quantity);
      render();
    });
    document.querySelectorAll('[data-catalog-remove]').forEach(button => button.onclick = () => { state.cart.delete(button.dataset.catalogRemove); render(); });
    document.getElementById('catalog-checkout')?.addEventListener('click', () => { state.checkoutVisible = true; render(); document.getElementById('catalog-checkout-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    document.getElementById('catalog-checkout-form')?.addEventListener('submit', submitOrder);
  }

  async function submitOrder(event) {
    event.preventDefault();
    const form = event.target;
    const error = document.getElementById('catalog-form-error');
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    if (!form.reportValidity()) return;
    if (totalDozens() < MIN_DOZENS) return;
    button.disabled = true;
    button.textContent = 'جارٍ إرسال الطلب...';
    error.textContent = '';
    try {
      const result = await Storage.createPublicCatalogOrder({
        ...values,
        inviteToken: state.token,
        requestId: state.requestId || (state.requestId = uuid()),
        items: cartItems().map(({ product, quantity }) => ({ productId: product.id, quantity }))
      });
      state.submitted = true;
      const root = document.getElementById('catalog-content');
      root.innerHTML = `<div class="catalog-success"><div class="catalog-success-icon">✓</div><h1>تم استلام طلبك بنجاح</h1><p>شكرًا لك، سيتم التواصل معك لتأكيد التفاصيل.</p><div class="catalog-order-number">رقم الأوردر<br><strong>${escape(result?.orderNumber || result?.orderId || '—')}</strong></div><a class="btn btn-primary" href="${escape(window.location.href.split('?')[0])}${state.token ? `?catalog=${encodeURIComponent(state.token)}` : ''}">العودة إلى الكتالوج</a></div>`;
    } catch (submissionError) {
      console.error(submissionError);
      button.disabled = false;
      button.textContent = 'تأكيد إرسال الطلب';
      const message = String(submissionError?.message || '');
      if (message.includes('Minimum')) error.textContent = `الحد الأدنى للطلب ${MIN_DOZENS} دستة.`;
      else if (message.includes('Invalid marketer invite')) error.textContent = 'رابط الدعوة غير صالح أو يحتاج إلى إعادة تشغيل ترحيل الكتالوج.';
      else if (message.includes('orders_catalog_request_id_uidx') || message.includes('duplicate key')) error.textContent = 'يوجد إعداد قديم يمنع حفظ الأوردر متعدد الأصناف. شغّل ملف ترحيل الكتالوج المحدّث ثم أعد المحاولة.';
      else if (message.includes('column') && message.includes('does not exist')) error.textContent = 'قاعدة البيانات تحتاج إلى تشغيل ملف ترحيل الكتالوج المحدّث.';
      else if (['42883', 'PGRST202', 'PGRST205'].includes(submissionError?.code)) error.textContent = 'لم يتم تشغيل ترحيل الكتالوج الجديد على قاعدة البيانات بعد.';
      else error.textContent = message && message.length < 220
        ? `تعذر إرسال الطلب: ${message}`
        : 'تعذر إرسال الطلب الآن. راجع البيانات وحاول مرة أخرى.';
    }
  }

  window.CatalogApp = {
    isCatalogContext() { return Boolean(new URLSearchParams(window.location.search).get('catalog') || sessionStorage.getItem(storedTokenKey)); },
    async init() {
      state.token = getToken();
      const root = document.getElementById('catalog-content');
      root.innerHTML = '<div class="catalog-loading">جارٍ تحميل الكتالوج...</div>';
      try {
        const data = await Storage.getPublicCatalog(state.token);
        state.settings = data.settings || {};
        state.marketer = data.marketer || null;
        state.products = Array.isArray(data.products) ? data.products : [];
        if (state.products.some(product => !Array.isArray(product.variants))) {
          const legacyProducts = state.products;
          state.products = legacyProducts.map(product => ({ id: product.id, name: product.name, imageUrl: product.imageUrl || '', variants: [{ id: product.id, size: product.size || '', design: product.design || '', imageUrl: product.imageUrl || '', salePrice: product.salePrice }] }));
        }
        state.products.forEach(family => { if (family.variants?.length && !state.selectedVariants.has(family.id)) state.selectedVariants.set(family.id, family.variants[0].id); });
        if (state.token && !state.marketer) throw new Error('رابط الدعوة غير متاح');
        render();
      } catch (error) {
        console.error(error);
        const setupError = ['42883', 'PGRST202', 'PGRST205'].includes(error?.code);
        root.innerHTML = `<div class="catalog-error"><div class="catalog-success-icon">!</div><h1>تعذر فتح الكتالوج</h1><p>${setupError ? 'لم يتم تشغيل ترحيل الكتالوج على قاعدة البيانات بعد. شغّل ملف 20261126_wholesale_catalog.sql ثم جرّب الرابط مرة أخرى.' : 'قد يكون رابط الدعوة غير صالح أو تم تعطيله. اطلب رابطًا جديدًا من المسوّق.'}</p></div>`;
      }
    }
  };
})();
