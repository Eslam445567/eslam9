(function () {
  'use strict';

  const productMargin = product => ((Number(product.salePrice) - Number(product.costPrice)) / (Number(product.salePrice) || 1) * 100).toFixed(2);
  const catalogLink = user => {
    const token = String(user?.catalogInviteToken || '').trim();
    if (!token) return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('catalog', token);
    return url.toString();
  };

  async function copyCatalogLink(user) {
    const link = catalogLink(user);
    if (!link) return showToast('لا يوجد رمز دعوة لهذا الحساب. شغّل ترحيل الكتالوج على Supabase أولًا.', 'error');
    if (window.location.protocol === 'file:') return showToast('شغّل التطبيق عبر رابط استضافة أو خادم محلي؛ رابط file لا يعمل مع العملاء.', 'warning');
    try { await navigator.clipboard.writeText(link); showToast('تم نسخ رابط الكتالوج'); }
    catch (_) { window.prompt('انسخ رابط الكتالوج', link); }
  }

  function shareCatalogLink(user, network) {
    const link = catalogLink(user);
    if (!link) return showToast('لا يوجد رمز دعوة لهذا الحساب. شغّل ترحيل الكتالوج على Supabase أولًا.', 'error');
    if (window.location.protocol === 'file:') return showToast('شغّل التطبيق عبر رابط استضافة أو خادم محلي؛ رابط file لا يعمل مع العملاء.', 'warning');
    const text = `كتالوج المنتجات بالجملة من ${user.name}`;
    const target = network === 'whatsapp' ? `https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}` : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  window.CatalogLinks = { link: catalogLink, copy: copyCatalogLink, share: shareCatalogLink };

  window.ManageApp = {
    showMarketers() {
      const users = Storage.getUsers().filter(user => user.role === 'marketer');
      const active = users.filter(user => user.isActive).length;
      const rows = users.length ? users.map(user => {
        const stats = Storage.getMarketerStats(user.id);
        return `<tr style="${user.isActive ? '' : 'opacity:.55;background:#f4f4f4'}"><td><span class="avatar" style="display:inline-grid;width:28px;height:28px;font-size:11px;margin-left:6px">${escapeHTML(user.name.charAt(0))}</span>${escapeHTML(user.name)}</td><td dir="ltr">${escapeHTML(user.username)}</td><td><span class="badge ${user.isActive ? 'completed' : 'cancelled'}">${user.isActive ? 'نشط' : 'معطّل'}</span></td><td>${stats.totalOrders}</td><td class="money">${formatCurrency(stats.totalRevenue)}</td><td class="money text-success">${formatCurrency(stats.totalProfit)}</td><td><div class="actions"><button class="action-btn" data-copy-catalog="${user.id}">🔗 نسخ الرابط</button><button class="action-btn" data-share-catalog="whatsapp" data-user-id="${user.id}">واتساب</button><button class="action-btn" data-share-catalog="facebook" data-user-id="${user.id}">فيسبوك</button><button class="action-btn" data-permissions-user="${user.id}">⚙️ الصلاحيات</button><button class="action-btn" data-toggle-user="${user.id}">🔄 ${user.isActive ? 'تعطيل' : 'تفعيل'}</button><button class="action-btn" data-password-user="${user.id}">🔑 كلمة المرور</button><button class="action-btn danger" data-delete-user="${user.id}">🗑️</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="7"><div class="empty-state">لا يوجد مسوقون</div></td></tr>';
      mainContent.innerHTML = `<div class="page-head"><div><h1>إدارة المسوقين</h1><p>إدارة الحسابات ومراجعة الأداء ومشاركة رابط الكتالوج الخاص بكل مسوق.</p></div><button class="btn btn-accent" id="new-marketer">＋ إضافة مسوّق</button></div><div class="stats-grid"><div class="stat-card"><div class="stat-icon">👥</div><div><div class="stat-value">${users.length}</div><div class="stat-label">إجمالي المسوقين</div></div></div><div class="stat-card success"><div class="stat-icon">✅</div><div><div class="stat-value">${active}</div><div class="stat-label">نشطون</div></div></div><div class="stat-card warning"><div class="stat-icon">⏸️</div><div><div class="stat-value">${users.length - active}</div><div class="stat-label">معطّلون</div></div></div></div><div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الحالة</th><th>الأوردرات</th><th>الإيرادات</th><th>الأرباح</th><th>رابط الكتالوج والإجراءات</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
      document.getElementById('new-marketer').onclick = () => this.marketerModal();
      document.querySelectorAll('[data-copy-catalog]').forEach(button => button.onclick = () => { const user = users.find(item => item.id === button.dataset.copyCatalog); if (user) copyCatalogLink(user); });
      document.querySelectorAll('[data-share-catalog]').forEach(button => button.onclick = () => { const user = users.find(item => item.id === button.dataset.userId); if (user) shareCatalogLink(user, button.dataset.shareCatalog); });
      document.querySelectorAll('[data-permissions-user]').forEach(button => button.onclick = () => this.permissionsModal(button.dataset.permissionsUser));
      document.querySelectorAll('[data-toggle-user]').forEach(button => button.onclick = async () => { try { await Storage.toggleUserStatus(button.dataset.toggleUser); showToast('تم تحديث حالة الحساب'); this.showMarketers(); } catch (error) { console.error(error); showToast('تعذر تحديث الحساب', 'error'); } });
      document.querySelectorAll('[data-password-user]').forEach(button => button.onclick = () => this.passwordModal(button.dataset.passwordUser));
      document.querySelectorAll('[data-delete-user]').forEach(button => button.onclick = async () => { if (!confirm('حذف حساب المسوّق؟')) return; try { await Storage.deleteUser(button.dataset.deleteUser); showToast('تم تعطيل الحساب'); this.showMarketers(); } catch (error) { console.error(error); showToast('تعذر تعطيل الحساب', 'error'); } });
    },

    permissionsModal(id) {
      const user = Storage.getUsers().find(item => item.id === id); if (!user) return;
      const checks = Storage.PERMISSION_DEFINITIONS.map(([key, label]) => `<label class="checkbox-row permission-row"><input type="checkbox" name="${key}" ${user.permissions?.[key] ? 'checked' : ''}><span>${label}</span></label>`).join('');
      openModal('صلاحيات المسوّق: ' + user.name, `<form id="permissions-form"><p class="muted" style="font-size:12px">فعّل أو عطّل كل صلاحية بشكل مستقل.</p><div class="permissions-grid">${checks}</div><div class="form-actions"><button class="btn btn-primary">حفظ الصلاحيات</button><button type="button" class="btn btn-outline" id="cancel-permissions">إلغاء</button></div></form>`);
      document.getElementById('cancel-permissions').onclick = closeModal;
      document.getElementById('permissions-form').onsubmit = async event => { event.preventDefault(); const permissions = Object.fromEntries(Storage.PERMISSION_DEFINITIONS.map(([key]) => [key, event.target.elements[key].checked])); try { await Storage.updateMarketerPermissions(id, permissions); closeModal(); showToast('تم حفظ صلاحيات المسوّق'); this.showMarketers(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر حفظ الصلاحيات', 'error'); } };
    },

    marketerModal() {
      openModal('إضافة مسوّق جديد', `<form id="marketer-form"><div class="form-grid"><div class="form-group full"><label>الاسم الكامل *</label><input name="name" required></div><div class="form-group"><label>اسم المستخدم *</label><input name="username" required></div><div class="form-group"><label>الإيميل *</label><input name="email" type="email" required></div><div class="form-group"><label>كلمة المرور (6 أحرف على الأقل) *</label><input name="password" type="password" minlength="6" required></div><div class="form-group full"><label>تأكيد كلمة المرور *</label><input name="confirm" type="password" minlength="6" required></div></div><div class="form-actions"><button class="btn btn-primary">حفظ</button></div></form>`);
      document.getElementById('marketer-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); if (data.password !== data.confirm) return showToast('كلمتا المرور غير متطابقتين', 'error'); if (Storage.getUserByUsername(data.username)) return showToast('اسم المستخدم مستخدم بالفعل', 'error'); try { await Storage.addUser(data); closeModal(); showToast('تمت إضافة المسوق'); this.showMarketers(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر إنشاء الحساب', 'error'); } };
    },

    passwordModal(id) {
      openModal('تغيير كلمة المرور', '<form id="password-form"><div class="form-group"><label>كلمة المرور الجديدة</label><input name="password" type="password" minlength="6" required></div><div class="form-actions"><button class="btn btn-primary">حفظ كلمة المرور</button></div></form>');
      document.getElementById('password-form').onsubmit = async event => { event.preventDefault(); try { await Storage.updateUser(id, { password: new FormData(event.target).get('password') }); closeModal(); showToast('تم تغيير كلمة المرور'); } catch (error) { console.error(error); showToast('تعذر تغيير كلمة المرور', 'error'); } };
    },

    showProducts() {
      const user = Storage.getCurrentUser(); const marketer = user?.role === 'marketer'; const canAdd = !marketer || Storage.can('add_product'); const canEdit = !marketer || Storage.can('edit_product'); const canDelete = !marketer || Storage.can('delete_product'); const products = Storage.getAllProducts(); const groups = Storage.getProductFamilies(); const orders = Storage.getOrders(); const orderCount = productId => orders.filter(order => (order.items || []).some(item => item.productId === productId)).length;
      const headers = marketer ? '<th>نوع الفوطة</th><th>المقاسات المتاحة</th><th>أسعار البيع</th><th>عدد الأوردرات</th><th>إجراءات</th>' : '<th>نوع الفوطة</th><th>المقاسات المتاحة</th><th>أسعار البيع</th><th>التكاليف</th><th>هوامش الربح</th><th>عدد الأوردرات</th><th>إجراءات</th>';
      const rows = groups.length ? groups.map(group => { const variants = group.variants; const sizes = variants.map(product => `<span class="variant-chip ${product.isActive ? '' : 'inactive'}">${escapeHTML([product.size, product.design].filter(Boolean).join(' · ') || 'افتراضي')}${product.isActive ? '' : ' · متوقف'}</span>`).join(' '); const sales = variants.map(product => `<span class="variant-price">${escapeHTML([product.size, product.design].filter(Boolean).join(' · ') || 'افتراضي')}: ${formatCurrency(product.salePrice)} ج.م</span>`).join('<br>'); const costs = variants.map(product => `<span class="variant-price">${escapeHTML([product.size, product.design].filter(Boolean).join(' · ') || 'افتراضي')}: ${formatCurrency(product.costPrice)} ج.م</span>`).join('<br>'); const margins = variants.map(product => `<span class="variant-price">${productMargin(product)}%</span>`).join('<br>'); return `<tr><td><b>${escapeHTML(group.name)}</b><small class="text-muted" style="display:block">${variants.length} مقاس/نسخة</small></td><td>${sizes || '—'}</td><td class="money">${sales || '—'}</td>${marketer ? '' : `<td class="money">${costs || '—'}</td><td>${margins || '—'}</td>`}<td>${variants.reduce((sum, product) => sum + orderCount(product.id), 0)}</td><td><div class="actions">${canAdd ? `<button class="action-btn" data-new-variant="${group.id}">＋ مقاس</button>` : ''}${!marketer && canEdit ? `<button class="action-btn" data-edit-family="${group.id}">✏️ تعديل النوع</button>` : ''}${variants.map(product => canEdit ? `<button class="action-btn" data-edit-product="${product.id}">📝 ${escapeHTML(product.size || 'المقاس')}</button>` : '').join('')}${canDelete ? variants.filter(product => product.isActive).map(product => `<button class="action-btn danger" data-delete-product="${product.id}">⏸ إيقاف ${escapeHTML(product.size || 'المقاس')}</button>`).join('') : ''}</div></td></tr>`; }).join('') : `<tr><td colspan="${marketer ? 5 : 7}"><div class="empty-state">لا توجد أنواع أو مقاسات</div></td></tr>`;
      const settingsButton = !marketer ? '<button class="btn btn-outline" id="catalog-settings">⚙️ إعدادات الكتالوج</button>' : '';
      mainContent.innerHTML = `<div class="page-head"><div><h1>إدارة المنتجات</h1><p>${marketer ? 'إدارة المنتجات المسموح بها لحسابك.' : 'إضافة وتعديل المنتجات وأسعار الدستة وبيانات عرضها في الكتالوج.'}</p></div><div class="page-actions">${settingsButton}${canAdd ? '<button class="btn btn-accent" id="new-product">＋ إضافة منتج</button>' : ''}</div></div><div class="card"><div class="table-wrap"><table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
      document.getElementById('new-product')?.addEventListener('click', () => this.productModal()); document.getElementById('catalog-settings')?.addEventListener('click', () => this.catalogSettingsModal()); document.querySelectorAll('[data-new-variant]').forEach(button => button.onclick = () => this.productModal(null, button.dataset.newVariant)); document.querySelectorAll('[data-edit-family]').forEach(button => button.onclick = () => this.familyModal(button.dataset.editFamily)); document.querySelectorAll('[data-edit-product]').forEach(button => button.onclick = () => this.productModal(button.dataset.editProduct)); document.querySelectorAll('[data-delete-product]').forEach(button => button.onclick = async () => { if (!confirm('إيقاف هذا المقاس؟ سيختفي من الطلبات الجديدة مع الاحتفاظ به في الأوردرات السابقة.')) return; try { await Storage.deleteProduct(button.dataset.deleteProduct); showToast('تم إيقاف المقاس'); this.showProducts(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر إيقاف المقاس', 'error'); } });
    },

    catalogSettingsModal() {
      const settings = Storage.getCatalogSettings();
      openModal('إعدادات الكتالوج', `<form id="catalog-settings-form"><div class="form-grid"><div class="form-group full"><label>اسم المصنع *</label><input name="factoryName" value="${escapeAttr(settings.factory_name || settings.factoryName || '')}" required></div><div class="form-group full"><label>رابط الشعار</label><input name="logoUrl" type="url" value="${escapeAttr(settings.logo_url || settings.logoUrl || '')}" placeholder="https://..."><small class="muted">يمكنك وضع رابط صورة الشعار من الاستضافة الحالية.</small></div><div class="form-group full"><label>رقم واتساب الاستفسارات</label><input name="whatsappNumber" type="tel" inputmode="tel" value="${escapeAttr(settings.whatsapp_number || '')}" placeholder="مثال: 01012345678"><small class="muted">سيظهر زر استفسار واتساب داخل الكتالوج. اكتب الرقم المصري كما هو أو أضف كود الدولة.</small></div></div><div class="form-actions"><button class="btn btn-primary">حفظ إعدادات الكتالوج</button></div></form>`);
      document.getElementById('catalog-settings-form').onsubmit = async event => { event.preventDefault(); try { await Storage.updateCatalogSettings(Object.fromEntries(new FormData(event.target))); closeModal(); showToast('تم حفظ إعدادات الكتالوج'); this.showProducts(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر حفظ الإعدادات', 'error'); } };
    },

    familyModal(id) {
      const family = Storage.getProductFamilies().find(item => String(item.id) === String(id)); if (!family) return;
      openModal('تعديل نوع الفوطة', `<form id="family-form"><div class="form-group"><label>اسم النوع الرئيسي *</label><input name="name" value="${escapeAttr(family.name)}" required></div><div class="form-actions"><button class="btn btn-primary">حفظ النوع</button></div></form>`);
      document.getElementById('family-form').onsubmit = async event => { event.preventDefault(); try { await Storage.manageProductFamily('update', { familyId: id, name: new FormData(event.target).get('name') }); closeModal(); showToast('تم تحديث نوع الفوطة'); this.showProducts(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر تحديث النوع', 'error'); } };
    },

    productModal(id, familyId = '') {
      const product = id ? Storage.getAllProducts().find(item => item.id === id) : null; const marketer = Storage.getCurrentUser()?.role === 'marketer'; const families = Storage.getProductFamilies(); const selectedFamilyId = product?.familyId || familyId || ''; const selectedFamily = families.find(item => String(item.id) === String(selectedFamilyId)); const costFields = marketer ? '' : `<div class="form-group"><label>التكلفة للمقاس *</label><input id="product-cost" name="costPrice" type="number" min="0" value="${product?.costPrice || ''}" required></div>`;
      const familyOptions = families.map(family => `<option value="${escapeAttr(family.id)}" ${String(selectedFamilyId) === String(family.id) ? 'selected' : ''}>${escapeHTML(family.name)}</option>`).join('');
      openModal(product ? 'تعديل مقاس وسعر' : 'إضافة مقاس جديد', `<form id="product-form"><div class="form-grid"><div class="form-group full"><label>نوع الفوطة الرئيسي *</label><select name="familyId"><option value="">نوع جديد — اكتب الاسم بالأسفل</option>${familyOptions}</select></div><div class="form-group full"><label>اسم النوع الجديد (عند عدم اختيار نوع موجود)</label><input name="familyName" value="${escapeAttr(selectedFamily?.name || product?.familyName || (!id ? '' : product?.name) || '')}" placeholder="مثال: فوطة ميكروفايبر"></div><div class="form-group"><label>المقاس</label><input name="size" value="${escapeAttr(product?.size || '')}" placeholder="مثال: 25×35"></div><div class="form-group"><label>التصميم أو النوع</label><input name="design" value="${escapeAttr(product?.design || '')}" placeholder="اختياري"></div><div class="form-group"><label>سعر المقاس *</label><input id="product-sale" name="salePrice" type="number" min="0" step="0.01" value="${product?.salePrice || ''}" required></div>${costFields}<div class="form-group full"><label>رابط صورة النوع/المقاس</label><input name="imageUrl" type="url" value="${escapeAttr(product?.imageUrl || '')}" placeholder="https://..."><small class="muted">يمكنك استخدام رابط مباشر، أو اختيار صورة من الجهاز.</small></div><div class="form-group full"><label>رفع صورة من الجهاز</label><input id="product-image-file" name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><div id="product-image-preview" class="product-image-preview">${product?.imageUrl ? `<img src="${escapeAttr(product.imageUrl)}" alt="معاينة الصورة">` : '<span>لم يتم اختيار صورة</span>'}</div><small class="muted">الحد الأقصى 5 ميجابايت. إيقاف المقاس لا يحذف الأوردرات القديمة.</small></div></div><p class="muted" id="product-margin" style="font-size:11px"></p><div class="form-actions"><button class="btn btn-primary">حفظ المقاس والسعر</button></div></form>`);
      const updateMargin = () => { const sale = document.getElementById('product-sale'); const cost = document.getElementById('product-cost'); const margin = document.getElementById('product-margin'); if (!sale || !margin) return; const saleValue = Number(sale.value); const costValue = Number(cost?.value || 0); margin.textContent = !marketer && saleValue ? `هامش الربح المتوقع: ${(((saleValue - costValue) / saleValue) * 100).toFixed(2)}%` : ''; };
      document.getElementById('product-sale').oninput = updateMargin; document.getElementById('product-cost')?.addEventListener('input', updateMargin); updateMargin();
      const fileInput = document.getElementById('product-image-file'); const preview = document.getElementById('product-image-preview');
      fileInput.onchange = () => { const file = fileInput.files?.[0]; if (!file) return; if (!String(file.type || '').startsWith('image/')) { fileInput.value = ''; return showToast('اختر ملف صورة صحيحًا', 'error'); } preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="معاينة الصورة الجديدة">`; };
      document.getElementById('product-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); delete data.imageFile; const file = fileInput.files?.[0]; try { showLoading(true); if (file) data.imageUrl = await Storage.uploadProductImage(file); if (id) await Storage.updateProduct(id, data); else await Storage.addProduct({ ...data, name: data.familyName || data.name }); closeModal(); showToast('تم حفظ المقاس والسعر'); this.showProducts(); } catch (error) { console.error(error); showToast(error?.message || 'تعذر حفظ المقاس أو رفع الصورة', 'error'); } finally { showLoading(false); } };
    }
  };
})();
