import http from 'k6/http';
import { sleep, check } from 'k6';

export let options = {
  vus: __ENV.VU ? parseInt(__ENV.VU) : 10,
  duration: __ENV.DURATION || '30s',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/health`);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  const catalog = http.get(`${BASE_URL}/api/v1/catalog/products?limit=10`);
  check(catalog, {
    'catalog ok': (r) => r.status === 200,
  });
  sleep(1);
}
