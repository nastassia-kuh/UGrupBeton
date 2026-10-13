const distanceFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatKm = km => distanceFormat.format(km);
export const roundKm = km => Math.round((km + Number.EPSILON) * 10) / 10;

export function kmFromMetres(metres) {
  if (!Number.isFinite(metres) || metres < 0 || metres > 2000000) throw new Error('Сервис не вернул корректную длину маршрута.');
  return roundKm(metres / 1000);
}

export function parseDistance(text) {
  const value = String(text).trim().replace(/[\s\u00a0\u202f]/g, '').toLowerCase();
  const match = value.match(/^(\d+(?:[.,]\d+)?)\s*(км|km|м|m)?$/);
  if (!match) throw new Error('Укажите расстояние от 0 до 2000 км. Например, 21,3.');
  const amount = Number(match[1].replace(',', '.'));
  const km = /^(м|m)$/.test(match[2] || '') ? amount / 1000 : amount;
  if (!Number.isFinite(km) || km > 2000) throw new Error('Укажите расстояние от 0 до 2000 км.');
  return roundKm(km);
}

export function readRoute(data) {
  const route = data?.routes?.[0];
  if (data?.code !== 'Ok' || !route || route.geometry?.type !== 'LineString') throw new Error('Не удалось построить автомобильный маршрут. Уточните точку на карте или введите километры вручную.');
  const coordinates = route.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some(c => !Array.isArray(c) || c.length < 2 || !c.slice(0, 2).every(Number.isFinite))) throw new Error('Сервис вернул неполный маршрут. Попробуйте ещё раз.');
  return { distance: kmFromMetres(route.distance), duration: route.duration, coordinates: coordinates.map(([lon, lat]) => [lat, lon]) };
}

function inRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inCountry(lat, lon, boundary) {
  const geometry = boundary.geometry || boundary;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) => inRing([lon, lat], outer) && !holes.some(hole => inRing([lon, lat], hole)));
}

// Cache in memory only: addresses are not saved to browser storage.
export function createRoutingClient(config, fetchImpl = fetch) {
  const cache = new Map();
  let queue = Promise.resolve(), lastRequest = 0;
  async function request(url, signal) {
    const key = url.toString();
    if (cache.has(key)) return cache.get(key);
    const slot = queue.then(async () => {
      const wait = 1100 - (Date.now() - lastRequest);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      lastRequest = Date.now();
    });
    queue = slot.catch(() => {});
    await slot;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
    let data;
    try {
      const response = await fetchImpl(key, { signal: controller.signal, referrerPolicy: 'strict-origin-when-cross-origin' });
      if (!response.ok) throw new Error('Сервис карты временно недоступен. Попробуйте ещё раз или укажите километраж вручную.');
      data = await response.json();
    } catch (error) {
      if (timedOut) throw new Error('Сервис карты долго не отвечает. Повторите поиск или укажите километраж вручную.');
      if (error.name === 'TypeError') throw new Error('Не удалось связаться с картой. Проверьте интернет или укажите километраж вручную.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    // Do not cache failures or empty matches; cap the session cache.
    if (data.code === 'Ok' || data.features?.length) {
      if (cache.size >= 40) cache.delete(cache.keys().next().value);
      cache.set(key, data);
    }
    return data;
  }
  return {
    async search(query, signal) {
      const parsed = addressParts(query);
      const url = new URL(parsed.street ? '/structured' : '/api/', config.maps.geocoderUrl);
      const params = { countrycode: 'BY', limit: '20', lang: 'default' };
      if (parsed.street) {
        params.street = parsed.street;
        if (parsed.city) params.city = parsed.city;
        if (parsed.house) params.housenumber = parsed.house;
      } else { params.q = query; params.layer = 'city'; }
      url.search = new URLSearchParams(params);
      let data = await request(url, signal);
      // Villages and settlements may not be indexed as cities.
      if (!parsed.street && !data.features?.length) {
        url.searchParams.delete('layer');
        data = await request(url, signal);
      }
      const convert = data => (data.features || []).filter(f => String(f.properties?.countrycode).toUpperCase() === 'BY' && f.geometry?.type === 'Point').map(f => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const city = p.type === 'city' || p.type === 'locality' ? p.name || p.city : p.city || p.town || p.village || p.locality || '';
        const street = p.street || (p.type === 'street' ? p.name : '');
        const address = [...new Set([street, p.housenumber, city || p.name, p.county, p.state].filter(Boolean))].join(', ');
        return { lat, lon, address, city, street, house: Boolean(p.housenumber), houseNumber: p.housenumber || '', approximate: Boolean(parsed.house && String(p.housenumber || '').toLowerCase() !== parsed.house.toLowerCase()) };
      }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (!parsed.city || sameCity(parsed.city, p.city)) && (!parsed.street || streetMatches(parsed.street, p.street)));
      let candidates = convert(data);
      if (parsed.street && !candidates.length) {
        const alternative = bilingualStreet(parsed.street);
        if (alternative !== parsed.street) {
          url.searchParams.set('street', alternative);
          candidates = convert(await request(url, signal));
        }
      }
      const exactHouse = parsed.house && candidates.some(p => String(p.houseNumber).toLowerCase() === parsed.house.toLowerCase());
      const matches = exactHouse ? candidates.filter(p => String(p.houseNumber).toLowerCase() === parsed.house.toLowerCase()) : candidates;
      const seen = new Set();
      return matches.filter(p => { const key = p.address.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
    },
    async route(point, signal) {
      const url = new URL(`/route/v1/driving/${config.origin.lon},${config.origin.lat};${point.lon},${point.lat}`, config.maps.routerUrl);
      url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson', alternatives: 'false', steps: 'false', radiuses: '3000;3000' });
      return readRoute(await request(url, signal));
    }
  };
}

// A late response from an old address must never replace a newer route or manual entry.
export function createLatestRequest() {
  let revision = 0, controller;
  return {
    start() { controller?.abort(); controller = new AbortController(); const id = ++revision; return { signal: controller.signal, current: () => id === revision }; },
    cancel() { revision++; controller?.abort(); }
  };
}

export function addressParts(query) {
  const value = query.trim().replace(/^Беларусь\s*,?\s*/i, '');
  const road = /^(?:ул\.?|улица|вул\.?|вуліца|проспект|пр-т|переулок|завулак|площадь|пл\.?)\s/i;
  const parts = value.split(',').map(x => x.trim()).filter(Boolean);
  let city = '', street = '', house = '';
  if (parts.length > 1 && !road.test(parts[0])) { city = parts.shift().replace(/^(?:г\.|город)\s*/i, ''); street = parts.join(' '); }
  else if (road.test(value)) {
    street = parts.shift();
    if (/^\d+[а-яa-z]?(?:[/-]\d+)?$/i.test(parts[0] || '')) house = parts.shift();
    if (parts.length) city = parts[0].replace(/^(?:г\.|город)\s*/i, '');
  }
  else {
    const match = value.match(/^(.+?)\s+((?:ул\.?|улица|вул\.?|вуліца|проспект|пр-т|переулок|площадь)\s.+)$/i);
    if (match) { city = match[1].replace(/^г\.\s*/i, ''); street = match[2]; }
  }
  if (street) {
    const match = street.match(/(?:\s|,)(\d+[а-яa-z]?(?:[/-]\d+)?)\s*$/i);
    if (match) { house = match[1]; street = street.slice(0, match.index).trim(); }
  }
  return { city, street, house };
}
export function sameCity(a, b) {
  const key = s => String(s).toLowerCase().replace(/дз/g, 'д').replace(/ц/g, 'т').replace(/[аеёиоуыэюяі\s.,ьъ-]/g, '');
  return Boolean(a && b && key(a) === key(b));
}
export function bilingualStreet(street) {
  return street.replace(/советская/ig, 'Савецкая').replace(/советский/ig, 'Савецкі').replace(/независимости/ig, 'Незалежнасці').replace(/октябрьская/ig, 'Кастрычніцкая').replace(/первомайская/ig, 'Першамайская');
}
export function streetMatches(requested, actual) {
  if (!actual) return false;
  const type = value => {
    if (/^(?:ул\.?|улица|вул\.?|вуліца)\s/i.test(value)) return 'street';
    if (/^(?:проспект|праспект|пр-т)\s/i.test(value)) return 'avenue';
    if (/^(?:переулок|завулак|пер\.?)\s/i.test(value)) return 'lane';
    if (/^(?:площадь|пл\.?)\s/i.test(value)) return 'square';
    return null;
  };
  if (type(requested) && type(actual) && type(requested) !== type(actual)) return false;
  const key = s => bilingualStreet(s).toLowerCase().replace(/(?:улица|вуліца|ул\.|вул\.|проспект|праспект|пр-т|переулок|завулак|площадь|пл\.)/g, '').replace(/ў/g, 'в').replace(/[аеёиоуыэюяі\s.,ьъ-]/g, '');
  let a = key(requested), b = key(actual);
  if (!/\d/.test(a)) b = b.replace(/^\d+/, '');
  return Boolean(a && b && a === b);
}
