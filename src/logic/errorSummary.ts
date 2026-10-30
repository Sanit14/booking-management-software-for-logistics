// The LR form's refusals as one line for the form's head (the boxes turn red; their own messages are not drawn under them,
// because a line under a box would push the day's list below 8 rows). Display only.

// The order the boxes are on the form.
const ORDER = ['date', 'consignor', 'consignee', 'fromStation', 'toStation', 'particular', 'qty', 'toPay', 'paid', 'godownBhada', 'godownInsurance', 'deliveryCharges', 'hamali', 'wasuli', 'staxPercent'];

/** "Required: Consignor, Quantity" (one message on several boxes), or "Quantity: Enter a whole number" (one box). Empty when nothing is wrong. */
export function errorSummary(errors: Partial<Record<string, string | undefined>>, label: (field: string) => string): string {
  const byMessage = new Map<string, string[]>();
  const keys = Object.keys(errors).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  for (const k of keys) {
    const message = errors[k];
    if (message) byMessage.set(message, [...(byMessage.get(message) ?? []), label(k)]);
  }
  return [...byMessage].map(([message, labels]) => (labels.length > 1 ? `${message}: ${labels.join(', ')}` : `${labels[0]}: ${message}`)).join(' · ');
}
