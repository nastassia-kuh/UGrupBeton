import { CONFIG } from './config.js?v=20261013i';
import { roundKm } from './routing.js?v=20261013i';
const money = v => Math.round((v + Number.EPSILON) * 100) / 100;
const local = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(v);
function quantity(v, min, max, label) {
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${label}: укажите число от ${min} до ${max}.`);
  return v;
}
const tripForms = { one: 'рейс', few: 'рейса', many: 'рейсов', other: 'рейса' };
export const tripText = count => `${count} ${tripForms[new Intl.PluralRules('ru-RU').select(count)]}`;

// A drum's nominal volume is not a universal road-legal load. The operator
// supplies the working limit and any lower payload allowed for the actual route.
export function planMixerTrips(volume, delivery = CONFIG.delivery) {
  quantity(volume, 0, 500, 'Объём бетона');
  const limits = [quantity(delivery.mixerCapacity, 0.1, 20, 'Рабочая загрузка миксера')];
  const load = delivery.mixerLoad;
  if (load) {
    limits.push(quantity(load.nominalCapacityM3, 0.1, 20, 'Вместимость барабана'));
    const density = quantity(load.concreteDensityKgM3, 100, 5000, 'Плотность бетонной смеси');
    limits.push(quantity(load.technicalPayloadKg, 1, 100000, 'Техническая масса смеси') / density);
    if (load.allowedPayloadKg != null) limits.push(quantity(load.allowedPayloadKg, 1, 100000, 'Рабочий предел массы смеси') / density);
  }
  // Round capacity down so rounding cannot authorize an extra load.
  const capacity = Math.floor((Math.min(...limits) + 1e-10) * 10) / 10;
  quantity(capacity, 0.1, 20, 'Загрузка миксера с учётом ограничений');
  const count = volume ? Math.max(1, Math.ceil(volume / capacity - 1e-12)) : 0;
  const lastLoad = count ? Math.round((volume - (count - 1) * capacity) * 1e6) / 1e6 : 0;
  const loads = Array.from({ length: count }, (_, index) => index === count - 1 ? lastLoad : capacity);
  const loadingText = !count ? '' : count > 5 ? `${count - 1} × ${local(capacity)} + ${local(lastLoad)} м³` : `${loads.map(local).join(' + ')} м³`;
  return { capacity, count, loads, loadingText, preliminary: load?.confirmed !== true,
    detail: count ? `${local(volume)} м³ / до ${local(capacity)} м³ за рейс = ${tripText(count)}. Загрузка: ${loadingText}.` : '' };
}
export function calculate(order, config = CONFIG) {
  const grade = config.concrete.find(g => g.id === order.grade);
  if (!grade) throw new Error('Выберите марку бетона.');
  const volume = quantity(order.volume, 0, 500, 'Объём бетона');
  const gravelQty = order.gravelEnabled ? quantity(order.gravelQty, 0.1, 1000, 'Количество щебня') : 0;
  const rebarQty = order.rebarEnabled ? quantity(order.rebarQty, 1, 100000, 'Длина арматуры') : 0;
  const gravel = config.gravel.find(x => x.id === order.gravel);
  const rebar = config.rebar.find(x => x.id === order.rebar);
  if (gravelQty && !gravel) throw new Error('Выберите фракцию щебня.');
  if (rebarQty && !rebar) throw new Error('Выберите диаметр арматуры.');
  if (volume === 0 && gravelQty === 0 && rebarQty === 0) throw new Error('Добавьте хотя бы один материал.');
  const rows = [];
  if (volume) rows.push({ label: `Бетон ${grade.name}`, detail: `${local(volume)} м³ × ${local(grade.price)} BYN`, amount: money(volume * grade.price) });
  if (gravelQty) rows.push({ label: `Щебень ${gravel.name}`, detail: `${local(gravelQty)} т × ${local(gravel.price)} BYN`, amount: money(gravelQty * gravel.price) });
  if (rebarQty) rows.push({ label: `Арматура ${rebar.name}`, detail: `${local(rebarQty)} м × ${local(rebar.price)} BYN`, amount: money(rebarQty * rebar.price) });
  const materials = money(rows.reduce((s, r) => s + r.amount, 0));
  const pumpBase = order.pumpEnabled ? money(quantity(config.delivery.rates.pump.dispatchFee, 0, 100000, 'Выезд автобетононасоса')) : 0;
  const pumpRow = order.pumpEnabled ? { label: 'Автобетононасос', detail: `Выезд ${local(pumpBase)} BYN; километраж ещё не рассчитан`, amount: pumpBase } : null;
  const mixerPlan = planMixerTrips(volume, config.delivery);
  const trips = { concrete: mixerPlan.count, gravel: gravelQty ? Math.ceil(gravelQty / config.delivery.gravelCapacity) : 0, rebar: rebarQty ? Math.ceil(rebarQty * rebar.kgPerM / config.delivery.rebarCapacityKg) : 0 };
  let delivery = null;
  const deliveryBreakdown = [];
  const requiresRoute = !order.pickup || Boolean(order.pumpEnabled);
  if (!requiresRoute) delivery = 0;
  else if (order.distance != null) {
    quantity(order.distance, 0, 2000, 'Расстояние');
    if (order.distance <= config.delivery.maxDistanceKm) {
      delivery = 0;
      const billedKm = roundKm(order.distance) * quantity(config.delivery.distanceMultiplier, 1, 2, 'Множитель расстояния');
      for (const [type, label] of [['concrete', 'Автобетоносмеситель'], ['gravel', 'Доставка щебня'], ['rebar', 'Доставка арматуры'], ['pump', 'Автобетононасос']]) {
        const tripCount = type === 'pump' ? (order.pumpEnabled ? 1 : 0) : order.pickup ? 0 : trips[type];
        if (!tripCount) continue;
        const tariff = config.delivery.rates[type];
        const dispatchFee = quantity(tariff.dispatchFee, 0, 100000, 'Плата за выезд');
        const perKm = quantity(tariff.perKm, 0, 10000, 'Цена за километр');
        // Both the displayed distance and billing use tenths of a kilometre.
        const amount = money((dispatchFee + billedKm * perKm) * tripCount);
        const fixedAmount = money(dispatchFee * tripCount);
        const distanceAmount = money(amount - fixedAmount);
        const tariffDetail = `${tripCount} × (выезд ${local(dispatchFee)} BYN + ${local(billedKm)} км × ${local(perKm)} BYN/км)`;
        const detail = type === 'concrete' ? `${mixerPlan.detail}\n${tariffDetail}` : `${tripText(tripCount)}: ${tariffDetail}`;
        if (type === 'pump') Object.assign(pumpRow, { detail, amount });
        else rows.push({ label, detail, amount });
        deliveryBreakdown.push({ type, trips: tripCount, billedKm, dispatchFee, perKm, fixedAmount, distanceAmount, amount });
        delivery += amount;
      }
      delivery = money(delivery);
    }
  }
  if (pumpRow) rows.push(pumpRow);
  return { rows, materials, pumpCost: pumpRow?.amount || 0, delivery, deliveryBreakdown, requiresRoute, total: money(materials + (delivery ?? pumpBase)), complete: delivery !== null, trips, mixerPlan, grade, distant: requiresRoute && order.distance > 100 };
}
export function slabVolume(length, width, height, reserve = false) {
  for (const n of [length, width, height]) quantity(n, 0.001, 1000, 'Размер');
  const volume = Math.ceil(length * width * height * (reserve ? 1.05 : 1) * 100) / 100;
  if (volume > 500) throw new Error('Объём больше 500 м³. Разделите расчёт на несколько поставок.');
  return volume;
}
