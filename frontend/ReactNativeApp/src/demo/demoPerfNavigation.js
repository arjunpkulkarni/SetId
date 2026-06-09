import { createNavigationContainerRef } from '@react-navigation/native';
import { bills } from '../services/api';

export const demoPerfNavigationRef = createNavigationContainerRef();

/** Headless UI demo: create bill → scan bundled receipt → async parse. */
async function waitForNavigationReady(maxMs = 30000) {
  const start = Date.now();
  while (!demoPerfNavigationRef.isReady()) {
    if (Date.now() - start > maxMs) {
      throw new Error('Navigation not ready for demo perf flow');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function runDemoPerfUiFlow() {
  await waitForNavigationReady();
  const res = await bills.create({ title: 'Perf Demo Auto', merchant_name: 'Demo Cafe' });
  const billId = res?.data?.id;
  if (!billId) {
    throw new Error('Demo bill create: missing bill id');
  }
  demoPerfNavigationRef.navigate('ScanReceipt', { billId, autoRun: true });
}
