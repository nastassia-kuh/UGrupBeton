import { CONFIG } from './config.js?v=20261013i';
import { calculate, slabVolume, planMixerTrips } from './calculator.js?v=20261013i';
import { downloadQuotePdf } from './quote-pdf.js?v=20261013i';
import { createRoutingClient, createLatestRequest, formatKm, parseDistance, inCountry } from './routing.js?v=20261013i';
// Every initial visit or refresh starts at the top. In-page navigation still works.
history.scrollRestoration = 'manual';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
window.scrollTo(0, 0);
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
const state = { pickup: false, distance: null, address: '', manual: false, lastQuote: null };
let toastTimer, pdfDownloadPending = false;

function closeMenu() {
  document.querySelector('.header').classList.remove('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  $('menu-toggle').setAttribute('aria-label', 'Открыть меню');
}
$('menu-toggle').addEventListener('click', () => {
  const open = $('menu-toggle').getAttribute('aria-expanded') !== 'true';
  document.querySelector('.header').classList.toggle('menu-open', open);
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  $('menu-toggle').setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
$('site-nav').addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
document.querySelector('.header-calc').addEventListener('click', closeMenu);
document.addEventListener('click', e => { if (!e.target.closest('.header')) closeMenu(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('menu-toggle').getAttribute('aria-expanded') === 'true') {
    closeMenu();
    $('menu-toggle').focus();
  }
});
matchMedia('(min-width: 1101px)').addEventListener('change', closeMenu);

// The mobile action opens the full breakdown while the form is on screen.
const formObserver = new IntersectionObserver(([entry]) => {
  $('mobile-quote-link').href = entry.isIntersecting ? '#quote-summary' : '#calculator';
  $('mobile-quote-link').replaceChildren(document.createTextNode(entry.isIntersecting ? 'Итог заказа' : 'Калькулятор'));
});
formObserver.observe($('calc-form'));

for (const [galleryId, photos] of [['fleet-gallery', [...CONFIG.fleetPhotos, ...CONFIG.pumpPhotos].filter((photo, index, photos) => photos.findIndex(p => p.src === photo.src) === index)]]) {
  if (!photos.length) continue;
  $(galleryId).replaceChildren();
  for (const photo of photos) {
    const figure = document.createElement('figure');
    figure.className = 'fleet-photo';
    const image = document.createElement('img');
    image.src = photo.src;
    image.alt = photo.alt || photo.caption || 'Техника ЮГруппБетон';
    image.loading = 'lazy';
    image.width = 1200;
    image.height = 900;
    figure.append(image);
    if (photo.caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = photo.caption;
      figure.append(caption);
    }
    $(galleryId).append(figure);
  }
}

function options(id, items, selected) {
  for (const x of items) {
    const opt = document.createElement('option');
    opt.value = x.id;
    opt.textContent = `${x.name}${x.cls ? ` · ${x.cls}` : ''} — ${fmt(x.price)} BYN${id === 'grade' ? '/м³' : id === 'gravel' ? '/т' : '/м'}`;
    $(id).append(opt);
  }
  $(id).value = selected;
}
options('grade', CONFIG.concrete, 'M300');
options('gravel', CONFIG.gravel, '5-20');
options('rebar', CONFIG.rebar, '12');
document.querySelectorAll('.pump-price').forEach(el => { el.textContent = CONFIG.delivery.rates.pump.dispatchFee; });
$('pump-per-km').textContent = `Цена за километр: ${fmt(CONFIG.delivery.rates.pump.perKm)} BYN.`;
$('mixer-price').textContent = CONFIG.delivery.rates.concrete.dispatchFee;
$('mixer-per-km').textContent = `Цена за километр: ${fmt(CONFIG.delivery.rates.concrete.perKm)} BYN. Тариф одинаковый для всех марок.`;
const defaultMixerPlan = planMixerTrips(0);
$('capacity-note').textContent = `В расчёте: миксер — до ${defaultMixerPlan.capacity} м³ за рейс; щебень — до ${CONFIG.delivery.gravelCapacity} т; арматура — до ${CONFIG.delivery.rebarCapacityKg / 1000} т. Загрузка и тарифы предварительные. Допустимая загрузка зависит от машины, массы смеси, осевых нагрузок и маршрута.`;
for (const grade of CONFIG.concrete) {
  const card = document.createElement('article');
  card.className = 'concrete-card';
  card.dataset.grade = grade.id;
  card.innerHTML = `<span class="card-popular" hidden>✓ В калькуляторе</span><div class="card-top"><h3>${grade.name}</h3><span class="class-tag">${grade.cls}</span></div><div class="concrete-model"><img src="assets/uses/${grade.image}.jpg" srcset="assets/uses/${grade.image}-small.jpg 480w, assets/uses/${grade.image}.jpg 960w" sizes="(max-width: 600px) calc(100vw - 80px), (max-width: 1000px) 40vw, 340px" alt="" aria-hidden="true" width="960" height="640" loading="lazy" decoding="async"></div><p>${grade.use}</p><div class="card-bottom"><strong>${grade.price} <small>BYN / м³</small></strong><span class="round-button" aria-hidden="true">↗</span></div><span class="card-action" aria-hidden="true">Выбрать для расчёта</span><p class="card-purpose"><b>Назначение</b>${grade.purpose}</p><button type="button" class="concrete-card-choice" aria-label="Выбрать бетон ${grade.name}" aria-pressed="false"></button>`;
  card.querySelector('button').addEventListener('click', () => {
    $('grade').value = grade.id;
    renderQuote();
    $('grade').focus({ preventScroll: true });
    $('calculator').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    toast(`${grade.name} выбран — стоимость пересчитана`);
  });
  $('concrete-cards').append(card);
  const row = document.createElement('tr');
  row.innerHTML = `<td>${grade.name}</td><td>${grade.cls}</td><td>${grade.use}</td>`;
  $('quality-table').append(row);
}
$('tariff-table').innerHTML = `<table class="mini-tariff"><caption>Примерные тарифы за рейс</caption><thead><tr><th>Техника / материал</th><th>Выезд, BYN</th><th>BYN/км</th></tr></thead><tbody>${[['concrete', 'Автобетоносмеситель'], ['gravel', 'Щебень'], ['rebar', 'Арматура'], ['pump', 'Автобетононасос']].map(([type, label]) => `<tr><td>${label}</td><td>${fmt(CONFIG.delivery.rates[type].dispatchFee)}</td><td>${fmt(CONFIG.delivery.rates[type].perKm)}</td></tr>`).join('')}</tbody></table><p class="small">Марка бетона не меняет цену доставки. Карта показывает расстояние в одну сторону.${CONFIG.delivery.distanceMultiplier === 2 ? ' В тарифе оплачиваются оба направления: километраж умножается на 2.' : ' Цена за километр в этом примере уже учитывает обратный путь.'}</p>`;

function readOrder() {
  return { grade: $('grade').value, volume: num('volume'), gravelEnabled: $('gravel-enabled').checked, gravel: $('gravel').value, gravelQty: num('gravel-qty'), rebarEnabled: $('rebar-enabled').checked, rebar: $('rebar').value, rebarQty: num('rebar-qty'), pumpEnabled: $('pump-yes').checked, pickup: state.pickup, distance: state.distance };
}
function renderQuote() {
  for (const type of ['gravel', 'rebar']) {
    const enabled = $(`${type}-enabled`).checked;
    $(`${type}-fields`).hidden = !enabled;
    $(type).disabled = !enabled;
    $(`${type}-qty`).disabled = !enabled;
  }
  const order = readOrder();
  const needsRoute = !state.pickup || order.pumpEnabled;
  $('mixer-selection').textContent = state.pickup ? 'Не учтён — самовывоз материалов' : order.volume === 0 ? 'Не нужен — бетон не выбран' : !Number.isFinite(order.volume) ? 'Укажите объём бетона' : 'Выбран автоматически';
  $('mixer-trips').hidden = state.pickup || order.volume === 0;
  $('mixer-trip-count').textContent = '—';
  $('mixer-load-plan').textContent = '';
  $('mixer-load-note').textContent = '';
  $('delivery-fields').hidden = !needsRoute;
  $('pickup-note').hidden = !state.pickup;
  $('pickup-note').textContent = order.pumpEnabled ? 'Самовывоз материалов — без перевозки. Для выезда автобетононасоса всё равно нужен адрес объекта.' : 'Стоимость перевозки материалов — 0 BYN. Способ вывоза смеси и время отгрузки согласуются перед поставкой.';
  const grade = CONFIG.concrete.find(g => g.id === order.grade);
  $('grade-hint').textContent = `${grade.cls} · ${grade.desc} Заполнитель готовой смеси включён в цену.`;
  document.querySelectorAll('.concrete-card').forEach(c => {
    const selected = c.dataset.grade === order.grade;
    c.classList.toggle('selected', selected);
    c.querySelector('button').setAttribute('aria-pressed', String(selected));
    c.querySelector('.card-popular').hidden = !selected;
    c.querySelector('.card-action').textContent = selected ? 'Выбрано для расчёта' : 'Выбрать для расчёта';
  });
  $('quote-grade').textContent = order.volume === 0 ? 'Без бетона' : grade.name;
  $('quote-volume').textContent = `${Number.isFinite(order.volume) ? order.volume : '—'} м³`;
  $('quote-distance').textContent = !needsRoute ? 'Самовывоз' : state.distance == null ? 'Без расстояния' : `${formatKm(state.distance)} км · ${state.manual ? 'вручную' : 'по маршруту'}`;
  let location = $('quote-location');
  if (!location) { location = document.createElement('p'); location.id = 'quote-location'; location.className = 'quote-location small muted'; document.querySelector('.quote-chips').after(location); }
  location.hidden = !needsRoute || !state.address;
  location.textContent = state.address ? `Объект: ${state.address}` : '';
  try {
    const result = calculate(order);
    state.lastQuote = result;
    $('mixer-trip-count').textContent = result.mixerPlan.count;
    if (!state.pickup && result.mixerPlan.count) {
      $('mixer-load-plan').textContent = result.mixerPlan.detail;
      $('mixer-load-note').textContent = result.mixerPlan.preliminary ? 'Предварительная загрузка. Допустимый объём уточняется по конкретной машине и маршруту.' : 'Рабочая загрузка уточняется с учётом условий маршрута.';
    }
    $('calc-error').hidden = true;
    $('quote-rows').replaceChildren();
    for (const row of result.rows) {
      const el = document.createElement('div');
      el.className = 'quote-row';
      const text = document.createElement('div');
      text.textContent = row.label;
      const detail = document.createElement('span');
      detail.textContent = row.detail;
      text.append(detail);
      const price = document.createElement('strong');
      price.textContent = fmt(row.amount);
      el.append(text, price);
      $('quote-rows').append(el);
    }
    if (state.pickup) {
      const row = document.createElement('div');
      row.className = 'quote-row';
      row.innerHTML = '<div>Самовывоз материалов<span>Без стоимости перевозки материалов</span></div><strong>0,00</strong>';
      $('quote-rows').append(row);
    }
    $('total').replaceChildren(document.createTextNode(`${fmt(result.total)} `));
    const small = document.createElement('small'); small.textContent = 'BYN'; $('total').append(small);
    $('total-label').textContent = result.complete ? 'Предварительный итог' : order.pumpEnabled ? 'Материалы и выезд автобетононасоса' : 'Материалы без доставки';
    $('quote-notice').textContent = !result.complete ? (order.pumpEnabled ? 'Включены материалы и выезд автобетононасоса. Километраж и остальные перевозки ещё не включены: постройте маршрут или согласуйте дальнюю доставку.' : state.distance == null ? 'Постройте маршрут, чтобы добавить доставку. Пока показана только стоимость материалов.' : 'Для этого расстояния доставка по индивидуальному расчёту. В итог включены только материалы.') : !needsRoute ? 'Стоимость материалов. Самовывоз согласуется перед отгрузкой.' : result.distant ? 'Дальний маршрут: возможность перевозки свежего бетона и тариф нужно согласовать. Расчёт ориентировочный.' : 'Включены материалы, выезд машин и километраж. Тарифы пока примерные.';
    $('download-quote').disabled = pdfDownloadPending;
    $('print-quote').disabled = false;
  } catch (error) {
    state.lastQuote = null;
    $('quote-rows').replaceChildren();
    $('total').textContent = '—';
    $('total-label').textContent = 'Проверьте параметры';
    $('calc-error').textContent = error.message;
    $('calc-error').hidden = false;
    $('quote-notice').textContent = 'Исправьте значение, чтобы получить точный предварительный расчёт.';
    $('download-quote').disabled = true;
    $('print-quote').disabled = true;
  }
  $('mobile-quote-label').textContent = $('total-label').textContent;
  $('mobile-quote-total').textContent = $('total').textContent;
}
$('calc-form').addEventListener('submit', e => e.preventDefault());
for (const id of ['grade', 'volume', 'gravel-enabled', 'gravel', 'gravel-qty', 'rebar-enabled', 'rebar', 'rebar-qty', 'pump-yes', 'pump-no']) {
  $(id).addEventListener('input', renderQuote);
  $(id).addEventListener('change', renderQuote);
}
for (const [id, delta] of [['volume-minus', -1], ['volume-plus', 1]]) $(id).addEventListener('click', () => { $('volume').value = Math.min(500, Math.max(0, Math.round(((num('volume') || 0) + delta) * 10) / 10)); renderQuote(); });
for (const type of ['gravel', 'rebar']) $(`add-${type}`).addEventListener('click', () => { $(`${type}-enabled`).checked = true; renderQuote(); $('calculator').scrollIntoView({ behavior: 'smooth' }); });
function selectTab(type) {
  document.querySelectorAll('[data-tab]').forEach(b => { const active = b.dataset.tab === type; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
  for (const key of ['concrete', 'extras']) $(`panel-${key}`).hidden = key !== type;
}
document.querySelectorAll('[data-tab]').forEach(b => {
  b.addEventListener('click', () => selectTab(b.dataset.tab));
  b.addEventListener('keydown', e => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const type = e.key === 'Home' ? 'concrete' : e.key === 'End' ? 'extras' : b.dataset.tab === 'concrete' ? 'extras' : 'concrete'; selectTab(type); $(`tab-${type}`).focus(); } });
});
function setMode(pickup) {
  state.pickup = pickup;
  if (pickup && state.distance == null) status('Для выезда автобетононасоса укажите адрес объекта.');
  $('mode-delivery').classList.toggle('active', !pickup); $('mode-pickup').classList.toggle('active', pickup);
  $('mode-delivery').setAttribute('aria-pressed', String(!pickup)); $('mode-pickup').setAttribute('aria-pressed', String(pickup));
  $('delivery-fields').hidden = pickup; $('pickup-note').hidden = !pickup;
  renderQuote();
}
$('mode-pickup').addEventListener('click', () => setMode(true));
$('mode-delivery').addEventListener('click', () => setMode(false));
$('add-pump').addEventListener('click', () => { $('pump-yes').checked = true; renderQuote(); $('calculator').scrollIntoView({ behavior: 'smooth' }); toast('Автобетононасос добавлен в расчёт'); });
const pumpVideo = $('pump-video');
async function playPumpVideo() {
  pumpVideo.currentTime = 0;
  try { await pumpVideo.play(); $('play-pump-video').hidden = true; }
  catch { $('play-pump-video').hidden = false; }
}
function stopPumpVideo() { pumpVideo.pause(); pumpVideo.currentTime = 0; $('play-pump-video').hidden = false; }
$('play-pump-video').addEventListener('click', playPumpVideo);
$('pump-video-card').addEventListener('mouseenter', () => {
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) playPumpVideo();
});
$('pump-video-card').addEventListener('mouseleave', stopPumpVideo);
pumpVideo.addEventListener('ended', () => { $('play-pump-video').hidden = false; $('play-pump-video').textContent = '▶ Посмотреть ещё раз'; });
pumpVideo.addEventListener('error', () => { $('play-pump-video').hidden = false; $('play-pump-video').textContent = 'Попробовать ещё раз'; });

$('open-volume').addEventListener('click', () => { $('volume-error').hidden = true; $('volume-dialog').showModal(); });
$('close-volume').addEventListener('click', () => $('volume-dialog').close());
$('volume-dialog').addEventListener('click', e => { if (e.target === $('volume-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
$('volume-form').addEventListener('submit', e => {
  e.preventDefault();
  try { $('volume').value = slabVolume(num('length'), num('width'), num('height'), $('reserve').checked); $('volume-dialog').close(); renderQuote(); }
  catch (error) { $('volume-error').textContent = error.message; $('volume-error').hidden = false; }
});

function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
$('download-quote').addEventListener('click', async () => {
  if (!state.lastQuote || pdfDownloadPending) return;
  const snapshot = { quote: structuredClone(state.lastQuote), brand: CONFIG.brand, origin: CONFIG.origin.name, pickup: state.pickup, address: state.address, distance: state.distance, manual: state.manual, date: new Date() };
  const button = $('download-quote');
  pdfDownloadPending = true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.firstChild.textContent = 'Подготавливаю PDF ';
  try {
    await downloadQuotePdf(snapshot);
    toast('PDF подготовлен. Заявка на заказ не отправлялась.');
  } catch (error) {
    toast('Не удалось подготовить PDF. Попробуйте ещё раз.');
    console.error(error);
  } finally {
    pdfDownloadPending = false;
    button.disabled = !state.lastQuote;
    button.removeAttribute('aria-busy');
    button.firstChild.textContent = 'Скачать расчёт PDF ';
  }
});
$('print-quote').addEventListener('click', () => { if (state.lastQuote) window.print(); });

function status(message, error = false) {
  $('route-status').textContent = message;
  $('route-status').classList.toggle('error', error);
}
function yandexUrl(destination = '') {
  const url = new URL('https://yandex.ru/maps/');
  url.searchParams.set('lang', 'ru_RU');
  if (destination) {
    url.searchParams.set('mode', 'routes');
    url.searchParams.set('rtext', `${CONFIG.origin.lat},${CONFIG.origin.lon}~${destination}`);
    url.searchParams.set('rtt', 'auto');
  } else {
    url.searchParams.set('ll', `${CONFIG.origin.lon},${CONFIG.origin.lat}`);
    url.searchParams.set('z', '9');
  }
  return url.toString();
}
function yandexLink(point = null) {
  const destination = point ? `${point.lat},${point.lon}` : $('address').value.trim();
  $('open-yandex').href = yandexUrl(destination);
  const url = new URL('https://www.google.com/maps/dir/');
  url.search = new URLSearchParams({ api: '1', origin: `${CONFIG.origin.lat},${CONFIG.origin.lon}`, destination: destination || 'Озерцо, Беларусь', travelmode: 'driving' });
  $('open-google').href = url.toString();
}
const routing = createRoutingClient(CONFIG);
const requests = createLatestRequest();
let yandexHasDestination = false;
const constructorMap = $('yandex-map');
function titleYandexFrame() {
  const frame = constructorMap.querySelector('iframe');
  if (frame && !frame.title) frame.title = 'Яндекс.Карты: карта доставки по Беларуси';
}
titleYandexFrame();
new MutationObserver(titleYandexFrame).observe(constructorMap, { childList: true });
const constructorScript = constructorMap.querySelector('script');
constructorScript?.addEventListener('error', () => {
  if (yandexHasDestination) return;
  const note = document.createElement('p');
  note.className = 'map-empty';
  note.textContent = 'Яндекс.Карты сейчас не загрузились. Расчёт по адресу остаётся доступен; карту можно открыть по ссылке ниже.';
  constructorMap.replaceChildren(note);
});
function setMapView(view) {
  const isYandex = view === 'yandex';
  $('yandex-panel').hidden = !isYandex;
  $('calculation-map-panel').hidden = isYandex;
  for (const [id, active] of [['show-yandex', isYandex], ['show-route', !isYandex]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
  if (!isYandex && map) requestAnimationFrame(() => {
    map.invalidateSize();
    if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [35, 35], maxZoom: 15, animate: false });
    else if (selectedPoint) map.setView([selectedPoint.lat, selectedPoint.lon], 15);
    else map.setView([53.6, 28], 7);
  });
}
$('show-yandex').addEventListener('click', () => setMapView('yandex'));
$('show-route').addEventListener('click', () => setMapView('route'));
function showYandexDestination(point) {
  // A standard Yandex widget is a separate map: it does not expose route distance
  // or marker events to this calculator. Only the address selected above is sent.
  const url = new URL('https://yandex.ru/map-widget/v1/');
  url.search = new URLSearchParams({ lang: 'ru_RU', l: 'map', rtext: `${CONFIG.origin.lat},${CONFIG.origin.lon}~${point.lat},${point.lon}`, rtt: 'auto', mode: 'routes' });
  const frame = document.createElement('iframe');
  frame.src = url.toString();
  frame.title = `Яндекс.Карты: маршрут из Озерца — ${point.address}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('allowfullscreen', '');
  $('yandex-map').replaceChildren(frame);
  yandexHasDestination = true;
}
function resetYandexDestination() {
  if (!yandexHasDestination) return;
  const note = document.createElement('p');
  note.className = 'map-empty';
  note.textContent = 'Выберите новый адрес выше — здесь появится маршрут в Яндекс.Картах.';
  $('yandex-map').replaceChildren(note);
  yandexHasDestination = false;
}
let map, boundary, routeLayer, destinationMarker, selectedPoint;
function busy(value) {
  $('search-address').disabled = value;
  $('search-address').textContent = value ? 'Строим маршрут…' : 'Рассчитать доставку';
  $('map').setAttribute('aria-busy', String(value));
}
function clearDistance() {
  state.distance = null;
  state.manual = false;
  $('manual-km').value = '';
  $('manual-km').removeAttribute('aria-invalid');
  $('route-result').hidden = true;
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  renderQuote();
}
function clearDestination() {
  if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; }
  selectedPoint = null;
  resetYandexDestination();
}
async function initializeMap() {
  if (!window.L) throw new Error('Карта не загрузилась. Можно открыть Яндекс.Карты и указать километраж вручную.');
  const response = await fetch('assets/belarus.json');
  if (!response.ok) throw new Error('Карта не загрузилась. Попробуйте обновить страницу.');
  boundary = await response.json();
  const bounds = L.latLngBounds([51.15, 23.1], [56.4, 32.95]);
  map = L.map('map', { scrollWheelZoom: false, maxBounds: bounds, maxBoundsViscosity: 1, minZoom: 6 }).setView([53.6, 28], 7);
  L.tileLayer(CONFIG.maps.tilesUrl, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://project-osrm.org/" target="_blank" rel="noopener">маршрут OSRM</a>' }).addTo(map);
  const countryRing = boundary.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
  L.polygon([[[-85, -180], [-85, 180], [85, 180], [85, -180]], countryRing], { interactive: false, stroke: false, fillColor: '#fcfcfa', fillOpacity: .95 }).addTo(map);
  L.geoJSON(boundary, { interactive: false, style: { color: '#ac9a87', weight: 1, fillOpacity: .02 } }).addTo(map);
  L.circleMarker([CONFIG.origin.lat, CONFIG.origin.lon], { color: '#29343c', fillColor: '#29343c', fillOpacity: 1, radius: 7 }).addTo(map).bindTooltip('Отправка: Озерцо');
  map.on('click', e => routePoint({ lat: e.latlng.lat, lon: e.latlng.lng, address: `Точка на карте: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}` }));
  new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  map.zoomControl.getContainer().setAttribute('aria-label', 'Масштаб карты');
  return map;
}
const mapReady = initializeMap().catch(error => { status(error.message, true); return null; });
function showDestination(point) {
  clearDestination();
  selectedPoint = point;
  const icon = L.divIcon({ className: 'delivery-pin', html: '<svg viewBox="0 0 36 44" width="36" height="44" aria-hidden="true"><path d="M18 42S3 26 3 17a15 15 0 0 1 30 0c0 9-15 25-15 25Z" fill="#be6829" stroke="#fff" stroke-width="2"/><circle cx="18" cy="17" r="5" fill="#fff"/></svg>', iconSize: [36, 44], iconAnchor: [18, 43] });
  destinationMarker = L.marker([point.lat, point.lon], { icon, draggable: true, title: 'Адрес доставки: перетащите метку, чтобы уточнить точку' }).addTo(map).bindTooltip('Объект доставки · метку можно перемещать');
  destinationMarker.on('dragstart', () => { requests.cancel(); busy(false); clearDistance(); status('Переместите метку — пересчитаем маршрут и доставку.'); });
  destinationMarker.on('dragend', e => {
    const position = e.target.getLatLng();
    routePoint({ lat: position.lat, lon: position.lng, address: `Точка на карте: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` });
  });
  $('address').value = point.address;
  state.address = point.address;
  yandexLink(point);
  showYandexDestination(point);
}
async function calculateRoute(point, request) {
  if (!inCountry(point.lat, point.lon, boundary)) throw new Error('Выберите адрес или точку на территории Беларуси.');
  showDestination(point);
  const result = await routing.route(point, request.signal);
  if (!request.current()) return;
  routeLayer = L.polyline(result.coordinates, { color: '#29343c', weight: 5, opacity: .9, interactive: false }).addTo(map);
  map.fitBounds(routeLayer.getBounds().extend([point.lat, point.lon]).extend([CONFIG.origin.lat, CONFIG.origin.lon]), { padding: [35, 35], maxZoom: 15, animate: false });
  state.distance = result.distance;
  state.manual = false;
  $('manual-km').value = String(result.distance);
  $('route-km').textContent = `${formatKm(result.distance)} км`;
  $('route-duration').textContent = Number.isFinite(result.duration) ? `Около ${Math.max(1, Math.ceil(result.duration / 60))} мин · в одну сторону` : 'В одну сторону';
  $('route-result').hidden = false;
  $('manual-distance').open = false;
  status(`Расчётный маршрут построен — расстояние и доставка пересчитаны.${point.approximate ? ' Точный дом не найден: уточните точку в разделе «Маршрут для расчёта».' : ' Выбранный адрес также показан в Яндекс.Картах.'}`);
  renderQuote();
}
function routeFailure(error, request) {
  if (!request.current() || error.name === 'AbortError') return;
  clearDistance();
  $('manual-distance').open = true;
  status(error.name === 'TimeoutError' ? 'Сервис маршрута долго не отвечает. Повторите поиск или укажите километраж вручную.' : error.message || 'Не удалось построить маршрут. Укажите километраж вручную.', true);
}
async function routePoint(point) {
  $('address-options').hidden = true;
  const request = requests.start();
  clearDistance();
  busy(true);
  status('Строим автомобильный маршрут и считаем доставку…');
  try {
    if (!await mapReady || !request.current()) return;
    await calculateRoute(point, request);
  } catch (error) { routeFailure(error, request); }
  finally { if (request.current()) busy(false); }
}
function invalidateAddress() {
  requests.cancel();
  busy(false);
  clearDestination();
  $('address-options').hidden = true;
  $('address-options').replaceChildren();
  state.address = $('address').value.trim();
  clearDistance();
  yandexLink();
  status('Адрес изменён. Нажмите «Рассчитать доставку», чтобы получить новое расстояние и цену.');
}
async function searchAddress() {
  const query = $('address').value.trim();
  if (query.length < 3) { status('Введите населённый пункт, улицу и при необходимости номер дома.', true); $('address').focus(); return; }
  if (selectedPoint && query === selectedPoint.address) return routePoint(selectedPoint);
  const request = requests.start();
  clearDestination();
  state.address = query;
  clearDistance();
  busy(true);
  yandexLink();
  $('address-options').hidden = true;
  $('address-options').replaceChildren();
  status('Ищем адрес в Беларуси…');
  try {
    if (!await mapReady || !request.current()) return;
    const points = await routing.search(query, request.signal);
    if (!request.current()) return;
    const localPoints = points.filter(p => inCountry(p.lat, p.lon, boundary));
    if (!localPoints.length) throw new Error('Адрес не найден в Беларуси. Уточните населённый пункт и улицу или поставьте точку на карте.');
    if (localPoints.length > 1 || localPoints[0].approximate) {
      const heading = document.createElement('p');
      heading.textContent = localPoints.some(p => p.approximate) ? 'Уточните адрес доставки — точный дом не найден' : 'Выберите адрес доставки';
      $('address-options').replaceChildren(heading);
      for (const point of localPoints) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = point.address + (point.approximate ? ' · точный дом не найден' : '');
        button.addEventListener('click', () => { $('address-options').hidden = true; routePoint(point); });
        $('address-options').append(button);
      }
      $('address-options').hidden = false;
      status(localPoints.some(p => p.approximate) ? 'Точный дом не найден. Выберите подходящий вариант и уточните метку в разделе «Маршрут для расчёта».' : 'Найдено несколько адресов. Выберите город и дом из списка — затем посчитаем маршрут и цену.');
      return;
    }
    $('address-options').hidden = true;
    await calculateRoute(localPoints[0], request);
  } catch (error) { routeFailure(error, request); }
  finally { if (request.current()) busy(false); }
}
function applyDistance() {
  try {
    if (!$('address-options').hidden) throw new Error('Сначала выберите нужный адрес из списка или конкретную точку в разделе «Маршрут для расчёта».');
    const value = parseDistance($('manual-km').value);
    requests.cancel();
    busy(false);
    if (routeLayer) { routeLayer.remove(); routeLayer = null; }
    $('route-result').hidden = true;
    $('manual-km').removeAttribute('aria-invalid');
    $('manual-km').value = String(value).replace('.', ',');
    state.distance = value;
    state.manual = true;
    state.address = $('address').value.trim() || 'Расстояние указано вручную';
    status(`Применено вручную: ${formatKm(value)} км в одну сторону. Доставка пересчитана.`);
    renderQuote();
  } catch (error) {
    requests.cancel(); busy(false); state.distance = null; state.manual = false; $('route-result').hidden = true; renderQuote();
    status(error.message, true);
    $('manual-km').setAttribute('aria-invalid', 'true');
  }
}
$('address').addEventListener('input', invalidateAddress);
$('address').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } });
$('manual-km').addEventListener('input', () => { requests.cancel(); busy(false); state.distance = null; $('route-result').hidden = true; renderQuote(); });
$('manual-km').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyDistance(); } });
$('search-address').addEventListener('click', searchAddress);
$('apply-distance').addEventListener('click', applyDistance);
renderQuote();
yandexLink();
requestAnimationFrame(() => window.scrollTo(0, 0));
