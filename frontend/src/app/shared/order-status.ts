export type OrderStatusValue =
  | 'pending'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | string;

export function orderStatusChipClass(status: OrderStatusValue): string {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    paid: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100',
    shipped: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
    delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
    cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
    refunded: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  };
  return styles[String(status)] || styles['refunded'];
}
