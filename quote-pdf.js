let libraryPromise, resourcesPromise;
const colour = { ink: [41, 52, 60], muted: [104, 113, 119], accent: [190, 104, 41], line: [228, 227, 223], soft: [245, 244, 240] };
const clean = value => String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/[\u2010-\u2015]/g, '-').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const money = value => clean(new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value));

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}

function loadLibrary() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('assets/vendor/jspdf.umd.min.js', import.meta.url).href;
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library did not load'));
    script.onerror = () => { script.remove(); reject(new Error('Could not load PDF library')); };
    document.head.append(script);
  }).catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}

function loadResources() {
  if (!resourcesPromise) resourcesPromise = Promise.all(['assets/manrope-regular.ttf', 'assets/manrope.ttf', 'assets/brand-original.jpg'].map(async path => {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`Could not load PDF asset: ${path}`);
    return response.arrayBuffer();
  })).then(([regular, bold, logo]) => ({ regular: base64(regular), bold: base64(bold), logo: new Uint8Array(logo) }))
    .catch(error => { resourcesPromise = null; throw error; });
  return resourcesPromise;
}

// Shared renderer: the browser download and local PDF verification use identical code.
export function createQuotePdf(data, assets, JsPDF) {
  const q = data.quote;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Manrope-Regular.ttf', assets.regular);
  doc.addFont('Manrope-Regular.ttf', 'Manrope', 'normal');
  doc.addFileToVFS('Manrope-Bold.ttf', assets.bold);
  doc.addFont('Manrope-Bold.ttf', 'Manrope', 'bold');
  doc.setProperties({ title: `${data.brand} - предварительный расчёт`, author: data.brand, subject: 'Материалы и предварительная доставка', creator: 'ЮГруппБетон' });
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Minsk', dateStyle: 'long' }).format(data.date);
  let y = 70;

  function font(size, style = 'normal', tone = 'ink') {
    doc.setFont('Manrope', style); doc.setFontSize(size); doc.setTextColor(...colour[tone]);
  }
  function text(value, x, baseline, options) { doc.text(Array.isArray(value) ? value.map(clean) : clean(value), x, baseline, options); }
  function rule(baseline) { doc.setDrawColor(...colour.line); doc.setLineWidth(.25); doc.line(18, baseline, 192, baseline); }
  function continuation() {
    doc.addPage(); font(14, 'bold'); text(data.brand, 18, 22);
    font(9, 'normal', 'muted'); text('Предварительный расчёт - продолжение', 18, 29);
    rule(35); y = 45;
  }
  function ensure(height) { if (y + height > 278) continuation(); }
  function paragraph(value, size = 9, tone = 'muted', lineHeight = 4.5, width = 174) {
    font(size, 'normal', tone);
    const lines = doc.splitTextToSize(clean(value), width);
    for (const line of lines) { ensure(lineHeight); font(size, 'normal', tone); text(line, 18, y); y += lineHeight; }
  }
  function label(value) { ensure(8); font(9, 'bold', 'muted'); text(value, 18, y); y += 5; }
  function tableHead() {
    ensure(12);
    doc.setFillColor(...colour.soft); doc.roundedRect(18, y, 174, 10, 1.5, 1.5, 'F');
    font(9.5, 'bold'); text('Позиция и расчёт', 22, y + 6.5); text('Сумма, BYN', 188, y + 6.5, { align: 'right' });
    y += 12;
  }

  // Place the original emblem within a clipped frame; the source image stays unchanged.
  doc.saveGraphicsState();
  doc.rect(18, 18, 52, 52 * 695 / 1140); doc.clip(); doc.discardPath();
  doc.addImage(assets.logo, 'JPEG', 18 - 52 * 60 / 1140, 18 - 52 * 290 / 1140, 52 * 1254 / 1140, 52 * 1254 / 1140);
  doc.restoreGraphicsState();
  font(9, 'bold', 'muted'); text('ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ', 88, 26);
  font(18, 'bold'); text('Стоимость заказа', 88, 36);
  font(10); text(data.brand, 88, 46);
  font(9, 'normal', 'muted'); text(date, 88, 54);
  doc.setDrawColor(...colour.accent); doc.setLineWidth(.65); doc.line(18, 63, 192, 63);

  font(9, 'bold', 'muted'); text('ОТПРАВКА', 18, y); text('ПОЛУЧЕНИЕ', 112, y);
  font(10.5); text(data.origin, 18, y + 6); text(data.pickup ? 'Самовывоз' : 'Доставка на объект', 112, y + 6);
  y += 19;
  if (q.requiresRoute) {
    label('ОБЪЕКТ');
    paragraph(data.address || 'Адрес пока не указан', 10.5, 'ink', 4.8);
    y += 3;
    paragraph(`Расстояние в одну сторону: ${data.distance == null ? 'не указано' : clean(new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(data.distance)) + ' км'}${data.distance != null ? data.manual ? ' (введено вручную)' : ' (расчётный маршрут OSRM)' : ''}`, 9, 'muted', 4.5);
    y += 4;
  }

  if (!data.pickup && q.mixerPlan?.count) {
    if (q.delivery === null) { paragraph(q.mixerPlan.detail, 9, 'ink', 4.3); y += 2; }
    if (q.mixerPlan.preliminary) {
      paragraph(`Предварительная загрузка: до ${q.mixerPlan.capacity} м³ за рейс. Допустимый объём уточняется по конкретной машине, массе смеси и условиям маршрута.`, 8.5, 'muted', 4.1);
      y += 3;
    }
  }
  tableHead();
  for (const row of q.rows) {
    font(10.5, 'bold'); const names = doc.splitTextToSize(clean(row.label), 126);
    font(9); const details = doc.splitTextToSize(clean(row.detail), 126);
    const height = 11 + (names.length - 1) * 4.5 + details.length * 4;
    if (y + height > 278) { continuation(); tableHead(); }
    font(10.5, 'bold'); text(names, 22, y + 4.5, { lineHeightFactor: 1.22 }); text(money(row.amount), 188, y + 4.5, { align: 'right' });
    font(9, 'normal', 'muted'); text(details, 22, y + 10 + (names.length - 1) * 4.5, { lineHeightFactor: 1.22 });
    y += height; rule(y);
  }
  if (data.pickup) {
    ensure(14); font(10); text('Самовывоз материалов', 22, y + 6); text('0,00', 188, y + 6, { align: 'right' }); y += 14; rule(y);
  }

  y += 6; ensure(29);
  doc.setFillColor(...colour.ink); doc.roundedRect(18, y, 174, 26, 2, 2, 'F');
  doc.setFont('Manrope', 'normal'); doc.setFontSize(9); doc.setTextColor(239, 233, 224);
  text(q.complete ? 'ПРЕДВАРИТЕЛЬНЫЙ ИТОГ' : q.pumpCost ? 'МАТЕРИАЛЫ И ВЫЕЗД НАСОСА БЕЗ КИЛОМЕТРАЖА' : 'МАТЕРИАЛЫ БЕЗ ДОСТАВКИ', 24, y + 8);
  doc.setFont('Manrope', 'bold'); doc.setFontSize(22); doc.setTextColor(255, 255, 255);
  text(`${money(q.total)} BYN`, 186, y + 20, { align: 'right' });
  y += 33;
  if (q.delivery === null) paragraph(data.distance == null ? 'Доставка не включена: укажите расстояние для расчёта.' : 'Доставка не включена: для этого расстояния требуется индивидуальный тариф.', 9, 'ink', 4.3);
  else paragraph(`В том числе доставка: ${money(q.delivery)} BYN.`, 9, 'ink', 4.3);
  y += 2;
  paragraph('Цены материалов и доставка ориентировочные. Фактическая стоимость, параметры смеси и возможность поставки уточняются перед заказом.', 8.5, 'muted', 4.1);
  if (q.distant) { y += 2; paragraph('Дальний маршрут требует отдельного согласования перевозки свежего бетона.', 8.5, 'muted', 4.1); }
  y += 1;
  paragraph('Расчёт не является подтверждением заказа. Контакты и приём заявок будут добавлены позднее.', 8.5, 'muted', 4.1);

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page); rule(283); font(8, 'normal', 'muted'); text(data.brand, 18, 290); text(`${page} / ${count}`, 192, 290, { align: 'right' });
  }
  return doc;
}

export async function downloadQuotePdf(data) {
  const [JsPDF, assets] = await Promise.all([loadLibrary(), loadResources()]);
  const doc = createQuotePdf(data, assets, JsPDF);
  doc.save('ЮГруппБетон - предварительный расчёт.pdf');
}
